use starknet::storage::{
    Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
    StoragePointerWriteAccess,
};
use starknet::{ContractAddress, get_caller_address, get_block_timestamp};

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

#[starknet::interface]
pub trait IPaymaster<TContractState> {
    // Admin (owner)
    fn setup_organizer(
        ref self: TContractState, organizer: ContractAddress, budget: u256, daily_limit: u256,
    );
    fn deactivate_organizer(ref self: TContractState, organizer: ContractAddress);
    fn set_global_limits(
        ref self: TContractState, max_gas_per_tx: u256, max_txs_per_day: u64, min_interval: u64,
    );
    fn withdraw(ref self: TContractState, amount: u256);
    // Organizer self-service
    fn top_up_organizer(ref self: TContractState, amount: u256);
    // Sponsoring
    fn sponsor_account(
        ref self: TContractState, account: ContractAddress, organizer: ContractAddress,
    );
    fn unsponsor_account(ref self: TContractState, account: ContractAddress);
    fn validate_and_pay(ref self: TContractState, user: ContractAddress, gas_estimate: u256);
    // Views
    fn get_organizer_budget(self: @TContractState, organizer: ContractAddress) -> (u256, u256);
    fn get_account_organizer(self: @TContractState, account: ContractAddress) -> ContractAddress;
    fn is_organizer_active(self: @TContractState, organizer: ContractAddress) -> bool;
}

#[starknet::contract]
pub mod Paymaster {
    use super::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess, ContractAddress, get_caller_address, get_block_timestamp,
        IERC20Dispatcher, IERC20DispatcherTrait,
    };
    use core::num::traits::Zero;

    #[storage]
    struct Storage {
        owner: ContractAddress,
        strk_token: ContractAddress,
        max_gas_per_tx: u256,
        max_txs_per_day: u64,
        min_interval: u64,
        // Per-organizer maps
        organizer_budget: Map<ContractAddress, u256>,
        organizer_spent: Map<ContractAddress, u256>,
        organizer_daily_limit: Map<ContractAddress, u256>,
        organizer_spent_today: Map<ContractAddress, u256>,
        organizer_last_reset_day: Map<ContractAddress, u64>,
        organizer_active: Map<ContractAddress, bool>,
        // Account → organizer mapping
        account_organizer: Map<ContractAddress, ContractAddress>,
        // Anti-spam per account
        last_tx_time: Map<ContractAddress, u64>,
        daily_tx_count: Map<ContractAddress, u64>,
        daily_tx_count_reset_day: Map<ContractAddress, u64>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        OrganizerSetup: OrganizerSetup,
        OrganizerDeactivated: OrganizerDeactivated,
        OrganizerTopUp: OrganizerTopUp,
        AccountSponsored: AccountSponsored,
        AccountUnsponsored: AccountUnsponsored,
        GasSponsored: GasSponsored,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrganizerSetup {
        #[key]
        pub organizer: ContractAddress,
        pub budget: u256,
        pub daily_limit: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrganizerDeactivated {
        #[key]
        pub organizer: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OrganizerTopUp {
        #[key]
        pub organizer: ContractAddress,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AccountSponsored {
        #[key]
        pub account: ContractAddress,
        pub organizer: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AccountUnsponsored {
        #[key]
        pub account: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct GasSponsored {
        #[key]
        pub user: ContractAddress,
        pub organizer: ContractAddress,
        pub gas_amount: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        strk_token: ContractAddress,
        max_gas_per_tx: u256,
        max_txs_per_day: u64,
        min_interval: u64,
    ) {
        assert(!owner.is_zero(), 'INVALID_OWNER');
        assert(!strk_token.is_zero(), 'INVALID_TOKEN');
        assert(max_gas_per_tx > 0, 'MAX_GAS_MUST_BE_POSITIVE');
        assert(max_txs_per_day > 0, 'MAX_TXS_MUST_BE_POSITIVE');
        self.owner.write(owner);
        self.strk_token.write(strk_token);
        self.max_gas_per_tx.write(max_gas_per_tx);
        self.max_txs_per_day.write(max_txs_per_day);
        self.min_interval.write(min_interval);
    }

    #[abi(embed_v0)]
    impl PaymasterImpl of super::IPaymaster<ContractState> {
        fn setup_organizer(
            ref self: ContractState, organizer: ContractAddress, budget: u256, daily_limit: u256,
        ) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            self.organizer_budget.write(organizer, budget);
            self.organizer_daily_limit.write(organizer, daily_limit);
            self.organizer_spent.write(organizer, 0);
            self.organizer_spent_today.write(organizer, 0);
            self.organizer_active.write(organizer, true);
            self.emit(Event::OrganizerSetup(OrganizerSetup { organizer, budget, daily_limit }));
        }

        fn deactivate_organizer(ref self: ContractState, organizer: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            self.organizer_active.write(organizer, false);
            self.emit(Event::OrganizerDeactivated(OrganizerDeactivated { organizer }));
        }

        fn set_global_limits(
            ref self: ContractState, max_gas_per_tx: u256, max_txs_per_day: u64, min_interval: u64,
        ) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            self.max_gas_per_tx.write(max_gas_per_tx);
            self.max_txs_per_day.write(max_txs_per_day);
            self.min_interval.write(min_interval);
        }

        fn withdraw(ref self: ContractState, amount: u256) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            assert(amount > 0, 'ZERO_AMOUNT');
            let strk = IERC20Dispatcher { contract_address: self.strk_token.read() };
            assert(strk.transfer(self.owner.read(), amount), 'TRANSFER_FAILED');
        }

        fn top_up_organizer(ref self: ContractState, amount: u256) {
            let caller = get_caller_address();
            assert(self.organizer_active.read(caller), 'NOT_ACTIVE_ORGANIZER');
            let current_budget = self.organizer_budget.read(caller);
            self.organizer_budget.write(caller, current_budget + amount);
            self.emit(Event::OrganizerTopUp(OrganizerTopUp { organizer: caller, amount }));
        }

        fn sponsor_account(
            ref self: ContractState, account: ContractAddress, organizer: ContractAddress,
        ) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            assert(self.organizer_active.read(organizer), 'ORGANIZER_NOT_ACTIVE');
            self.account_organizer.write(account, organizer);
            self.emit(Event::AccountSponsored(AccountSponsored { account, organizer }));
        }

        fn unsponsor_account(ref self: ContractState, account: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            let zero: ContractAddress = Zero::zero();
            self.account_organizer.write(account, zero);
            self.emit(Event::AccountUnsponsored(AccountUnsponsored { account }));
        }

        fn validate_and_pay(ref self: ContractState, user: ContractAddress, gas_estimate: u256) {
            // 1. Lookup organizer
            let organizer = self.account_organizer.read(user);
            assert(!organizer.is_zero(), 'NOT_SPONSORED');

            // 2. Check organizer active
            assert(self.organizer_active.read(organizer), 'ORGANIZER_INACTIVE');

            // 3. Check gas per tx limit
            assert(gas_estimate <= self.max_gas_per_tx.read(), 'GAS_TOO_HIGH');

            let now = get_block_timestamp();
            let today: u64 = now / 86400;

            // 4. Anti-spam interval
            let last_time = self.last_tx_time.read(user);
            if last_time > 0 {
                assert(now - last_time >= self.min_interval.read(), 'TOO_FREQUENT');
            }

            // 5. Anti-spam daily count
            let count_reset_day = self.daily_tx_count_reset_day.read(user);
            let mut daily_count = self.daily_tx_count.read(user);
            if today > count_reset_day {
                daily_count = 0;
                self.daily_tx_count_reset_day.write(user, today);
            }
            assert(daily_count < self.max_txs_per_day.read(), 'DAILY_TX_LIMIT');

            // 6. Per-organizer daily limit
            let org_reset_day = self.organizer_last_reset_day.read(organizer);
            let mut org_spent_today = self.organizer_spent_today.read(organizer);
            if today > org_reset_day {
                org_spent_today = 0;
                self.organizer_last_reset_day.write(organizer, today);
            }
            assert(
                org_spent_today + gas_estimate <= self.organizer_daily_limit.read(organizer),
                'ORG_DAILY_LIMIT',
            );

            // 7. Budget check
            let org_spent = self.organizer_spent.read(organizer);
            assert(
                org_spent + gas_estimate <= self.organizer_budget.read(organizer),
                'BUDGET_EXCEEDED',
            );

            // 8. Update all counters
            self.organizer_spent.write(organizer, org_spent + gas_estimate);
            self.organizer_spent_today.write(organizer, org_spent_today + gas_estimate);
            self.last_tx_time.write(user, now);
            self.daily_tx_count.write(user, daily_count + 1);

            self
                .emit(
                    Event::GasSponsored(GasSponsored { user, organizer, gas_amount: gas_estimate }),
                );
        }

        fn get_organizer_budget(self: @ContractState, organizer: ContractAddress) -> (u256, u256) {
            (self.organizer_budget.read(organizer), self.organizer_spent.read(organizer))
        }

        fn get_account_organizer(
            self: @ContractState, account: ContractAddress,
        ) -> ContractAddress {
            self.account_organizer.read(account)
        }

        fn is_organizer_active(self: @ContractState, organizer: ContractAddress) -> bool {
            self.organizer_active.read(organizer)
        }
    }
}
