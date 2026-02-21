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
        max_supply: u256,
        primary_price: u256,
        resale_cap_bps: u256,
        royalty_bps: u256,
        marketplace: ContractAddress,
    ) -> ContractAddress;
    fn get_event_contract(self: @TContractState, event_id: u256) -> ContractAddress;
    fn get_event_count(self: @TContractState) -> u256;
}

#[starknet::contract]
pub mod TicketFactory {
    use super::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess, ClassHash, ContractAddress, get_caller_address, deploy_syscall,
        SyscallResultTrait,
    };

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
        self.ticket_class_hash.write(ticket_class_hash);
        self.owner.write(owner);
    }

    #[abi(embed_v0)]
    impl TicketFactoryImpl of super::ITicketFactory<ContractState> {
        fn create_event(
            ref self: ContractState,
            max_supply: u256,
            primary_price: u256,
            resale_cap_bps: u256,
            royalty_bps: u256,
            marketplace: ContractAddress,
        ) -> ContractAddress {
            let organizer = get_caller_address();
            let event_id = self.event_count.read();

            // Build calldata for EventTicket constructor
            let mut calldata: Array<felt252> = array![];
            calldata.append(max_supply.low.into());
            calldata.append(max_supply.high.into());
            calldata.append(primary_price.low.into());
            calldata.append(primary_price.high.into());
            calldata.append(resale_cap_bps.low.into());
            calldata.append(resale_cap_bps.high.into());
            calldata.append(royalty_bps.low.into());
            calldata.append(royalty_bps.high.into());
            calldata.append(organizer.into());
            calldata.append(marketplace.into());

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
    }
}
