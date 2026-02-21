use starknet::storage::{
    Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
    StoragePointerWriteAccess,
};
use starknet::{ContractAddress, get_caller_address, get_block_timestamp};

#[starknet::interface]
pub trait IPaymaster<TContractState> {
    fn validate_and_pay(ref self: TContractState, user: ContractAddress, gas_estimate: u256);
    fn whitelist_account(ref self: TContractState, account: ContractAddress);
    fn remove_account(ref self: TContractState, account: ContractAddress);
    fn set_limits(ref self: TContractState, max_gas_per_tx: u256, daily_limit: u256);
    fn withdraw(ref self: TContractState, amount: u256);
}

#[starknet::contract]
pub mod Paymaster {
    use super::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess, ContractAddress, get_caller_address, get_block_timestamp,
    };

    #[storage]
    struct Storage {
        owner: ContractAddress,
        allowed_accounts: Map<ContractAddress, bool>,
        max_gas_per_tx: u256,
        daily_limit: u256,
        spent_today: u256,
        last_reset_day: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, owner: ContractAddress, max_gas_per_tx: u256, daily_limit: u256,
    ) {
        self.owner.write(owner);
        self.max_gas_per_tx.write(max_gas_per_tx);
        self.daily_limit.write(daily_limit);
    }

    #[abi(embed_v0)]
    impl PaymasterImpl of super::IPaymaster<ContractState> {
        fn validate_and_pay(ref self: ContractState, user: ContractAddress, gas_estimate: u256) {
            assert(self.allowed_accounts.read(user), 'NOT_WHITELISTED');
            assert(gas_estimate <= self.max_gas_per_tx.read(), 'GAS_TOO_HIGH');
            self._check_and_update_daily_limit(gas_estimate);
        }

        fn whitelist_account(ref self: ContractState, account: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            self.allowed_accounts.write(account, true);
        }

        fn remove_account(ref self: ContractState, account: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            self.allowed_accounts.write(account, false);
        }

        fn set_limits(ref self: ContractState, max_gas_per_tx: u256, daily_limit: u256) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            self.max_gas_per_tx.write(max_gas_per_tx);
            self.daily_limit.write(daily_limit);
        }

        fn withdraw(ref self: ContractState, amount: u256) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            // TODO: Implement STRK transfer to owner
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _check_and_update_daily_limit(ref self: ContractState, amount: u256) {
            let today: u64 = (get_block_timestamp() / 86400).try_into().unwrap();
            if today > self.last_reset_day.read() {
                self.spent_today.write(0);
                self.last_reset_day.write(today);
            }
            let new_spent = self.spent_today.read() + amount;
            assert(new_spent <= self.daily_limit.read(), 'DAILY_LIMIT_REACHED');
            self.spent_today.write(new_spent);
        }
    }
}
