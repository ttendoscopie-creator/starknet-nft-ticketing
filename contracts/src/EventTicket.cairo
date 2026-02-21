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
        sale_price: u256,
    );
    fn mark_used(ref self: TContractState, token_id: u256);
    fn add_staff(ref self: TContractState, account: ContractAddress);
    fn remove_staff(ref self: TContractState, account: ContractAddress);
    fn owner_of(self: @TContractState, token_id: u256) -> ContractAddress;
    fn is_used(self: @TContractState, token_id: u256) -> bool;
    fn get_royalty(self: @TContractState, sale_price: u256) -> (ContractAddress, u256);
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
        owner_of: Map<u256, ContractAddress>,
        used: Map<u256, bool>,
        total_supply: u256,
        max_supply: u256,
        primary_price: u256,
        resale_cap_bps: u256,
        royalty_bps: u256,
        organizer: ContractAddress,
        marketplace: ContractAddress,
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
        pub price: u256,
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

    #[constructor]
    fn constructor(
        ref self: ContractState,
        max_supply: u256,
        primary_price: u256,
        resale_cap_bps: u256,
        royalty_bps: u256,
        organizer: ContractAddress,
        marketplace: ContractAddress,
    ) {
        assert(royalty_bps <= 2000, 'ROYALTY_MAX_20_PCT');
        assert(resale_cap_bps >= 10000, 'CAP_MIN_100_PCT');
        self.max_supply.write(max_supply);
        self.primary_price.write(primary_price);
        self.resale_cap_bps.write(resale_cap_bps);
        self.royalty_bps.write(royalty_bps);
        self.organizer.write(organizer);
        self.marketplace.write(marketplace);
    }

    #[abi(embed_v0)]
    impl EventTicketImpl of super::IEventTicket<ContractState> {
        fn mint(ref self: ContractState, to: ContractAddress, token_id: u256) {
            assert(get_caller_address() == self.organizer.read(), 'NOT_ORGANIZER');
            assert(self.owner_of.read(token_id).is_zero(), 'ALREADY_MINTED');
            assert(self.total_supply.read() < self.max_supply.read(), 'MAX_SUPPLY');
            self.owner_of.write(token_id, to);
            self.total_supply.write(self.total_supply.read() + 1);
            self.emit(Event::TicketMinted(TicketMinted { to, token_id }));
        }

        fn transfer_ticket(
            ref self: ContractState,
            from: ContractAddress,
            to: ContractAddress,
            token_id: u256,
            sale_price: u256,
        ) {
            assert(get_caller_address() == self.marketplace.read(), 'ONLY_MARKETPLACE');
            assert(self.owner_of.read(token_id) == from, 'NOT_OWNER');
            assert(!self.used.read(token_id), 'ALREADY_USED');
            let cap = self.primary_price.read() * self.resale_cap_bps.read() / 10000;
            assert(sale_price <= cap, 'PRICE_EXCEEDS_CAP');
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

        fn get_royalty(self: @ContractState, sale_price: u256) -> (ContractAddress, u256) {
            let amount = sale_price * self.royalty_bps.read() / 10000;
            (self.organizer.read(), amount)
        }
    }
}
