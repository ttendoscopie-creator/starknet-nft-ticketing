use starknet::storage::{
    Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
    StoragePointerWriteAccess,
};
use starknet::{ContractAddress, get_caller_address};

#[starknet::interface]
pub trait IEventTicket<TContractState> {
    fn mint(ref self: TContractState, to: ContractAddress, token_id: u256);
    fn transfer_ticket(
        ref self: TContractState,
        from: ContractAddress,
        to: ContractAddress,
        token_id: u256,
        sale_price: u128,
    );
    fn mark_used(ref self: TContractState, token_id: u256);
    fn add_staff(ref self: TContractState, account: ContractAddress);
    fn remove_staff(ref self: TContractState, account: ContractAddress);
    fn owner_of(self: @TContractState, token_id: u256) -> ContractAddress;
    fn is_used(self: @TContractState, token_id: u256) -> bool;
    fn get_royalty(self: @TContractState, sale_price: u128) -> (ContractAddress, u128);

    // Module 6: Soulbound
    fn is_soulbound(self: @TContractState) -> bool;
    fn revoke_ticket(ref self: TContractState, token_id: u256);

    // Module 8: Marketplace whitelist + transfer limits
    fn add_marketplace(ref self: TContractState, marketplace: ContractAddress);
    fn remove_marketplace(ref self: TContractState, marketplace: ContractAddress);
    fn is_marketplace_allowed(self: @TContractState, marketplace: ContractAddress) -> bool;
    fn get_transfer_count(self: @TContractState, token_id: u256) -> u32;
    fn get_max_transfers(self: @TContractState) -> u32;
}

#[starknet::contract]
pub mod EventTicket {
    use super::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess, ContractAddress, get_caller_address,
    };
    use core::num::traits::Zero;

    #[storage]
    struct Storage {
        // Per-token maps
        owner_of: Map<u256, ContractAddress>,
        used: Map<u256, bool>,
        transfer_count: Map<u256, u32>,
        // Event config (gas-optimized types)
        total_supply: u64,
        max_supply: u64,
        primary_price: u128,
        resale_cap_bps: u16,
        royalty_bps: u16,
        max_transfers: u32,
        soulbound: bool,
        // Addresses
        organizer: ContractAddress,
        // Marketplace whitelist (replaces single marketplace address)
        allowed_marketplaces: Map<ContractAddress, bool>,
        // Staff
        staff_roles: Map<ContractAddress, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        TicketMinted: TicketMinted,
        TicketTransferred: TicketTransferred,
        TicketUsed: TicketUsed,
        StaffAdded: StaffAdded,
        StaffRemoved: StaffRemoved,
        TicketRevoked: TicketRevoked,
        MarketplaceAdded: MarketplaceAdded,
        MarketplaceRemoved: MarketplaceRemoved,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TicketMinted {
        pub to: ContractAddress,
        pub token_id: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TicketTransferred {
        pub from: ContractAddress,
        pub to: ContractAddress,
        pub token_id: u256,
        pub price: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TicketUsed {
        pub token_id: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct StaffAdded {
        pub account: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct StaffRemoved {
        pub account: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TicketRevoked {
        pub token_id: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MarketplaceAdded {
        pub marketplace: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MarketplaceRemoved {
        pub marketplace: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        max_supply: u64,
        primary_price: u128,
        resale_cap_bps: u16,
        royalty_bps: u16,
        organizer: ContractAddress,
        marketplace: ContractAddress,
        soulbound: bool,
        max_transfers: u32,
    ) {
        assert(!organizer.is_zero(), 'INVALID_ORGANIZER');
        assert(!marketplace.is_zero(), 'INVALID_MARKETPLACE');
        assert(royalty_bps <= 2000_u16, 'ROYALTY_MAX_20_PCT');
        assert(resale_cap_bps >= 10000_u16, 'CAP_MIN_100_PCT');
        assert(resale_cap_bps <= 50000_u16, 'CAP_MAX_500_PCT');
        self.max_supply.write(max_supply);
        self.primary_price.write(primary_price);
        self.resale_cap_bps.write(resale_cap_bps);
        self.royalty_bps.write(royalty_bps);
        self.organizer.write(organizer);
        self.soulbound.write(soulbound);
        self.max_transfers.write(max_transfers);
        self.allowed_marketplaces.write(marketplace, true);
    }

    #[abi(embed_v0)]
    impl EventTicketImpl of super::IEventTicket<ContractState> {
        fn mint(ref self: ContractState, to: ContractAddress, token_id: u256) {
            assert(get_caller_address() == self.organizer.read(), 'NOT_ORGANIZER');
            assert(self.owner_of.read(token_id).is_zero(), 'ALREADY_MINTED');
            assert(self.total_supply.read() < self.max_supply.read(), 'MAX_SUPPLY');
            self.owner_of.write(token_id, to);
            self.total_supply.write(self.total_supply.read() + 1_u64);
            self.emit(Event::TicketMinted(TicketMinted { to, token_id }));
        }

        fn transfer_ticket(
            ref self: ContractState,
            from: ContractAddress,
            to: ContractAddress,
            token_id: u256,
            sale_price: u128,
        ) {
            // Module 6: Soulbound check
            assert(!self.soulbound.read(), 'TICKET_SOULBOUND');

            // Module 8: Marketplace whitelist check
            assert(self.allowed_marketplaces.read(get_caller_address()), 'MARKETPLACE_NOT_ALLOWED');

            assert(self.owner_of.read(token_id) == from, 'NOT_OWNER');
            assert(!self.used.read(token_id), 'ALREADY_USED');

            // Price cap check (gas-optimized types)
            let cap: u128 = self.primary_price.read()
                * Into::<u16, u128>::into(self.resale_cap_bps.read())
                / 10000_u128;
            assert(sale_price <= cap, 'PRICE_EXCEEDS_CAP');

            // Module 8: Transfer count check
            let max_t = self.max_transfers.read();
            if max_t > 0_u32 {
                let current_count = self.transfer_count.read(token_id);
                assert(current_count < max_t, 'MAX_TRANSFERS_REACHED');
                self.transfer_count.write(token_id, current_count + 1_u32);
            }

            self.owner_of.write(token_id, to);
            self
                .emit(
                    Event::TicketTransferred(
                        TicketTransferred { from, to, token_id, price: sale_price },
                    ),
                );
        }

        fn mark_used(ref self: ContractState, token_id: u256) {
            assert(self.staff_roles.read(get_caller_address()), 'NOT_STAFF');
            assert(!self.used.read(token_id), 'ALREADY_USED');
            self.used.write(token_id, true);
            self.emit(Event::TicketUsed(TicketUsed { token_id }));
        }

        fn add_staff(ref self: ContractState, account: ContractAddress) {
            assert(get_caller_address() == self.organizer.read(), 'NOT_ORGANIZER');
            self.staff_roles.write(account, true);
            self.emit(Event::StaffAdded(StaffAdded { account }));
        }

        fn remove_staff(ref self: ContractState, account: ContractAddress) {
            assert(get_caller_address() == self.organizer.read(), 'NOT_ORGANIZER');
            self.staff_roles.write(account, false);
            self.emit(Event::StaffRemoved(StaffRemoved { account }));
        }

        fn owner_of(self: @ContractState, token_id: u256) -> ContractAddress {
            self.owner_of.read(token_id)
        }

        fn is_used(self: @ContractState, token_id: u256) -> bool {
            self.used.read(token_id)
        }

        fn get_royalty(self: @ContractState, sale_price: u128) -> (ContractAddress, u128) {
            let amount: u128 = sale_price
                * Into::<u16, u128>::into(self.royalty_bps.read())
                / 10000_u128;
            (self.organizer.read(), amount)
        }

        // Module 6: Soulbound
        fn is_soulbound(self: @ContractState) -> bool {
            self.soulbound.read()
        }

        fn revoke_ticket(ref self: ContractState, token_id: u256) {
            assert(get_caller_address() == self.organizer.read(), 'NOT_ORGANIZER');
            assert(!self.owner_of.read(token_id).is_zero(), 'TOKEN_NOT_MINTED');
            self.owner_of.write(token_id, Zero::zero());
            self.used.write(token_id, true);
            self.emit(Event::TicketRevoked(TicketRevoked { token_id }));
        }

        // Module 8: Marketplace whitelist
        fn add_marketplace(ref self: ContractState, marketplace: ContractAddress) {
            assert(get_caller_address() == self.organizer.read(), 'NOT_ORGANIZER');
            self.allowed_marketplaces.write(marketplace, true);
            self.emit(Event::MarketplaceAdded(MarketplaceAdded { marketplace }));
        }

        fn remove_marketplace(ref self: ContractState, marketplace: ContractAddress) {
            assert(get_caller_address() == self.organizer.read(), 'NOT_ORGANIZER');
            self.allowed_marketplaces.write(marketplace, false);
            self.emit(Event::MarketplaceRemoved(MarketplaceRemoved { marketplace }));
        }

        fn is_marketplace_allowed(self: @ContractState, marketplace: ContractAddress) -> bool {
            self.allowed_marketplaces.read(marketplace)
        }

        fn get_transfer_count(self: @ContractState, token_id: u256) -> u32 {
            self.transfer_count.read(token_id)
        }

        fn get_max_transfers(self: @ContractState) -> u32 {
            self.max_transfers.read()
        }
    }
}
