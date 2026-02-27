use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
use starknet::account::Call;
use starknet::{VALIDATED, get_caller_address, get_block_timestamp, get_tx_info, ContractAddress};
use core::ecdsa::check_ecdsa_signature;
use core::num::traits::Zero;

#[starknet::interface]
pub trait ISRC6<TContractState> {
    fn __execute__(ref self: TContractState, calls: Array<Call>) -> Array<Span<felt252>>;
    fn __validate__(ref self: TContractState, calls: Array<Call>) -> felt252;
    fn is_valid_signature(
        self: @TContractState, hash: felt252, signature: Array<felt252>,
    ) -> felt252;
}

#[starknet::interface]
pub trait ISessionAccount<TContractState> {
    fn set_session_key(
        ref self: TContractState, session_pubkey: felt252, expiry: u64, scope: felt252,
    );
    fn revoke_session(ref self: TContractState);
    fn get_owner_pubkey(self: @TContractState) -> felt252;
}

#[starknet::interface]
pub trait IRecoverableAccount<TContractState> {
    fn set_guardian(ref self: TContractState, new_guardian: ContractAddress);
    fn get_guardian(self: @TContractState) -> ContractAddress;
    fn initiate_recovery(ref self: TContractState, new_owner_pubkey: felt252);
    fn execute_recovery(ref self: TContractState);
    fn cancel_recovery(ref self: TContractState);
    fn rotate_owner_key(ref self: TContractState, new_pubkey: felt252);
    fn get_recovery_status(self: @TContractState) -> (felt252, u64);
}

#[starknet::contract(account)]
pub mod AccountContract {
    use super::{
        StoragePointerReadAccess, StoragePointerWriteAccess, Call, VALIDATED, get_caller_address,
        get_block_timestamp, get_tx_info, check_ecdsa_signature, Zero, ContractAddress,
    };
    use starknet::syscalls::call_contract_syscall;
    use starknet::SyscallResultTrait;

    #[storage]
    struct Storage {
        owner_pubkey: felt252,
        session_pubkey: felt252,
        session_expiry: u64,
        session_scope: felt252,
        nonce: felt252,
        guardian: ContractAddress,
        pending_new_owner: felt252,
        recovery_initiated_at: u64,
        recovery_delay: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        GuardianSet: GuardianSet,
        RecoveryInitiated: RecoveryInitiated,
        RecoveryExecuted: RecoveryExecuted,
        RecoveryCancelled: RecoveryCancelled,
        OwnerKeyRotated: OwnerKeyRotated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct GuardianSet {
        #[key]
        pub new_guardian: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RecoveryInitiated {
        #[key]
        pub new_owner_pubkey: felt252,
        pub initiated_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RecoveryExecuted {
        pub new_owner_pubkey: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RecoveryCancelled {}

    #[derive(Drop, starknet::Event)]
    pub struct OwnerKeyRotated {
        pub new_pubkey: felt252,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner_pubkey: felt252,
        guardian: ContractAddress,
        recovery_delay: u64,
    ) {
        assert(!owner_pubkey.is_zero(), 'INVALID_PUBKEY');
        assert(!guardian.is_zero(), 'INVALID_GUARDIAN');
        assert(recovery_delay > 0, 'DELAY_MUST_BE_POSITIVE');
        self.owner_pubkey.write(owner_pubkey);
        self.guardian.write(guardian);
        self.recovery_delay.write(recovery_delay);
    }

    #[abi(embed_v0)]
    impl SRC6Impl of super::ISRC6<ContractState> {
        fn __execute__(ref self: ContractState, calls: Array<Call>) -> Array<Span<felt252>> {
            assert(get_caller_address().is_zero(), 'INVALID_CALLER');
            let mut results: Array<Span<felt252>> = array![];
            let mut calls_span = calls.span();
            loop {
                match calls_span.pop_front() {
                    Option::Some(call) => {
                        let result = call_contract_syscall(*call.to, *call.selector, *call.calldata)
                            .unwrap_syscall();
                        results.append(result);
                    },
                    Option::None => { break; },
                }
            };
            results
        }

        fn __validate__(ref self: ContractState, calls: Array<Call>) -> felt252 {
            self._validate_transaction()
        }

        fn is_valid_signature(
            self: @ContractState, hash: felt252, signature: Array<felt252>,
        ) -> felt252 {
            assert(signature.len() == 2, 'INVALID_SIGNATURE_LEN');
            if check_ecdsa_signature(hash, self.owner_pubkey.read(), *signature[0], *signature[1]) {
                return VALIDATED;
            }
            0
        }
    }

    #[abi(embed_v0)]
    impl SessionAccountImpl of super::ISessionAccount<ContractState> {
        fn set_session_key(
            ref self: ContractState, session_pubkey: felt252, expiry: u64, scope: felt252,
        ) {
            assert(get_caller_address().is_zero(), 'INVALID_CALLER');
            let now = get_block_timestamp();
            assert(expiry > now, 'EXPIRY_IN_PAST');
            assert(expiry < now + 86400, 'EXPIRY_TOO_LONG');
            self.session_pubkey.write(session_pubkey);
            self.session_expiry.write(expiry);
            self.session_scope.write(scope);
        }

        fn revoke_session(ref self: ContractState) {
            assert(get_caller_address().is_zero(), 'INVALID_CALLER');
            self.session_expiry.write(0);
            self.session_pubkey.write(0);
        }

        fn get_owner_pubkey(self: @ContractState) -> felt252 {
            self.owner_pubkey.read()
        }
    }

    #[abi(embed_v0)]
    impl RecoverableAccountImpl of super::IRecoverableAccount<ContractState> {
        fn set_guardian(ref self: ContractState, new_guardian: ContractAddress) {
            assert(get_caller_address().is_zero(), 'INVALID_CALLER');
            self.guardian.write(new_guardian);
            self.emit(Event::GuardianSet(GuardianSet { new_guardian }));
        }

        fn get_guardian(self: @ContractState) -> ContractAddress {
            self.guardian.read()
        }

        fn initiate_recovery(ref self: ContractState, new_owner_pubkey: felt252) {
            let caller = get_caller_address();
            assert(caller == self.guardian.read(), 'NOT_GUARDIAN');
            assert(!new_owner_pubkey.is_zero(), 'INVALID_PUBKEY');
            assert(self.pending_new_owner.read().is_zero(), 'RECOVERY_ALREADY_PENDING');
            let now = get_block_timestamp();
            self.pending_new_owner.write(new_owner_pubkey);
            self.recovery_initiated_at.write(now);
            self
                .emit(
                    Event::RecoveryInitiated(
                        RecoveryInitiated { new_owner_pubkey, initiated_at: now },
                    ),
                );
        }

        fn execute_recovery(ref self: ContractState) {
            let caller = get_caller_address();
            assert(caller == self.guardian.read(), 'NOT_GUARDIAN');
            let pending = self.pending_new_owner.read();
            assert(!pending.is_zero(), 'NO_PENDING_RECOVERY');
            let now = get_block_timestamp();
            let initiated_at = self.recovery_initiated_at.read();
            let delay = self.recovery_delay.read();
            assert(now >= initiated_at + delay, 'RECOVERY_TOO_EARLY');
            // Apply recovery
            self.owner_pubkey.write(pending);
            // Reset recovery state
            self.pending_new_owner.write(0);
            self.recovery_initiated_at.write(0);
            // Revoke session key
            self.session_pubkey.write(0);
            self.session_expiry.write(0);
            self.session_scope.write(0);
            self.emit(Event::RecoveryExecuted(RecoveryExecuted { new_owner_pubkey: pending }));
        }

        fn cancel_recovery(ref self: ContractState) {
            assert(get_caller_address().is_zero(), 'INVALID_CALLER');
            self.pending_new_owner.write(0);
            self.recovery_initiated_at.write(0);
            self.emit(Event::RecoveryCancelled(RecoveryCancelled {}));
        }

        fn rotate_owner_key(ref self: ContractState, new_pubkey: felt252) {
            assert(get_caller_address().is_zero(), 'INVALID_CALLER');
            assert(!new_pubkey.is_zero(), 'INVALID_PUBKEY');
            self.owner_pubkey.write(new_pubkey);
            self.emit(Event::OwnerKeyRotated(OwnerKeyRotated { new_pubkey }));
        }

        fn get_recovery_status(self: @ContractState) -> (felt252, u64) {
            (self.pending_new_owner.read(), self.recovery_initiated_at.read())
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _validate_transaction(self: @ContractState) -> felt252 {
            let tx_info = get_tx_info().unbox();
            let tx_hash = tx_info.transaction_hash;
            let sig = tx_info.signature;
            assert(sig.len() == 2, 'INVALID_SIG_LEN');

            // Try owner key first
            if check_ecdsa_signature(tx_hash, self.owner_pubkey.read(), *sig[0], *sig[1]) {
                return VALIDATED;
            }

            // Try session key with scope + expiry checks
            let now = get_block_timestamp();
            if !self.session_pubkey.read().is_zero()
                && now < self.session_expiry.read()
                && self.session_scope.read() == 1
                && check_ecdsa_signature(tx_hash, self.session_pubkey.read(), *sig[0], *sig[1]) {
                return VALIDATED;
            }

            assert(false, 'INVALID_SIGNATURE');
            0
        }
    }

    #[external(v0)]
    fn __validate_declare__(ref self: ContractState, class_hash: felt252) -> felt252 {
        self._validate_transaction()
    }

    #[external(v0)]
    fn __validate_deploy__(
        ref self: ContractState,
        class_hash: felt252,
        salt: felt252,
        owner_pubkey: felt252,
        guardian: ContractAddress,
        recovery_delay: u64,
    ) -> felt252 {
        self._validate_transaction()
    }
}
