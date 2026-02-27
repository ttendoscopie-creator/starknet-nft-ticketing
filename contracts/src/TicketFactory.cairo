use starknet::storage::{
    Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
    StoragePointerWriteAccess,
};
use starknet::{ClassHash, ContractAddress, get_caller_address, SyscallResultTrait};
use starknet::syscalls::deploy_syscall;

#[starknet::interface]
pub trait ITicketFactory<TContractState> {
    fn create_event(
        ref self: TContractState,
        max_supply: u64,
        primary_price: u128,
        resale_cap_bps: u16,
        royalty_bps: u16,
        marketplace: ContractAddress,
        soulbound: bool,
        max_transfers: u32,
    ) -> ContractAddress;
    fn get_event_contract(self: @TContractState, event_id: u256) -> ContractAddress;
    fn get_event_count(self: @TContractState) -> u256;
    fn update_ticket_class_hash(ref self: TContractState, new_hash: ClassHash);
}

#[starknet::contract]
pub mod TicketFactory {
    use super::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess, ClassHash, ContractAddress, get_caller_address, deploy_syscall,
        SyscallResultTrait,
    };
    use core::num::traits::Zero;

    #[storage]
    struct Storage {
        ticket_class_hash: ClassHash,
        owner: ContractAddress,
        event_contracts: Map<u256, ContractAddress>,
        event_count: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        EventCreated: EventCreated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EventCreated {
        pub event_id: u256,
        pub contract_address: ContractAddress,
        pub organizer: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, ticket_class_hash: ClassHash, owner: ContractAddress) {
        assert(!ticket_class_hash.is_zero(), 'INVALID_CLASS_HASH');
        assert(!owner.is_zero(), 'INVALID_OWNER');
        self.ticket_class_hash.write(ticket_class_hash);
        self.owner.write(owner);
    }

    #[abi(embed_v0)]
    impl TicketFactoryImpl of super::ITicketFactory<ContractState> {
        fn create_event(
            ref self: ContractState,
            max_supply: u64,
            primary_price: u128,
            resale_cap_bps: u16,
            royalty_bps: u16,
            marketplace: ContractAddress,
            soulbound: bool,
            max_transfers: u32,
        ) -> ContractAddress {
            let organizer = get_caller_address();
            let event_id = self.event_count.read();

            // Build calldata for EventTicket constructor
            let mut calldata: Array<felt252> = array![];
            calldata.append(max_supply.into()); // u64 -> 1 felt252
            calldata.append(primary_price.into()); // u128 -> 1 felt252
            calldata.append(resale_cap_bps.into()); // u16 -> 1 felt252
            calldata.append(royalty_bps.into()); // u16 -> 1 felt252
            calldata.append(organizer.into()); // ContractAddress -> 1 felt252
            calldata.append(marketplace.into()); // ContractAddress -> 1 felt252
            calldata.append(if soulbound {
                1
            } else {
                0
            }); // bool -> 1 felt252
            calldata.append(max_transfers.into()); // u32 -> 1 felt252

            let (contract_address, _) = deploy_syscall(
                self.ticket_class_hash.read(), event_id.low.into(), calldata.span(), false,
            )
                .unwrap_syscall();

            self.event_contracts.write(event_id, contract_address);
            self.event_count.write(event_id + 1);

            self.emit(Event::EventCreated(EventCreated { event_id, contract_address, organizer }));

            contract_address
        }

        fn get_event_contract(self: @ContractState, event_id: u256) -> ContractAddress {
            self.event_contracts.read(event_id)
        }

        fn get_event_count(self: @ContractState) -> u256 {
            self.event_count.read()
        }

        fn update_ticket_class_hash(ref self: ContractState, new_hash: ClassHash) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            assert(!new_hash.is_zero(), 'INVALID_CLASS_HASH');
            self.ticket_class_hash.write(new_hash);
        }
    }
}
