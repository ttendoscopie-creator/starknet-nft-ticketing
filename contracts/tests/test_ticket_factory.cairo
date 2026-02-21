use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, spy_events, EventSpyAssertionsTrait,
};
use starknet::{ContractAddress, contract_address_const};
use core::num::traits::Zero;

use starknet_nft_ticketing::TicketFactory::{
    ITicketFactoryDispatcher, ITicketFactoryDispatcherTrait,
};
use starknet_nft_ticketing::EventTicket::{IEventTicketDispatcher, IEventTicketDispatcherTrait};

fn owner() -> ContractAddress {
    contract_address_const::<'owner'>()
}
fn organizer() -> ContractAddress {
    contract_address_const::<'organizer'>()
}
fn buyer() -> ContractAddress {
    contract_address_const::<'buyer'>()
}
fn marketplace_addr() -> ContractAddress {
    contract_address_const::<'marketplace'>()
}

fn deploy_factory() -> ITicketFactoryDispatcher {
    let ticket_class = declare("EventTicket").unwrap().contract_class();
    let factory_class = declare("TicketFactory").unwrap().contract_class();
    let calldata = array![(*ticket_class.class_hash).into(), owner().into()];
    let (addr, _) = factory_class.deploy(@calldata).unwrap();
    ITicketFactoryDispatcher { contract_address: addr }
}

// TEST 1: Create event success
#[test]
fn test_create_event_success() {
    let factory = deploy_factory();

    start_cheat_caller_address(factory.contract_address, organizer());
    let event_addr = factory
        .create_event(100_u256, 1000000_u256, 11000_u256, 1000_u256, marketplace_addr());
    stop_cheat_caller_address(factory.contract_address);

    assert(!event_addr.is_zero(), 'Event address should not be 0');
    assert_eq!(factory.get_event_count(), 1_u256);
    assert_eq!(factory.get_event_contract(0_u256), event_addr);
}

// TEST 2: Create multiple events
#[test]
fn test_create_multiple_events() {
    let factory = deploy_factory();

    start_cheat_caller_address(factory.contract_address, organizer());
    let addr1 = factory
        .create_event(50_u256, 500000_u256, 11000_u256, 500_u256, marketplace_addr());
    let addr2 = factory
        .create_event(200_u256, 2000000_u256, 12000_u256, 1000_u256, marketplace_addr());
    stop_cheat_caller_address(factory.contract_address);

    assert_eq!(factory.get_event_count(), 2_u256);
    assert(addr1 != addr2, 'Addresses should be distinct');
    assert_eq!(factory.get_event_contract(0_u256), addr1);
    assert_eq!(factory.get_event_contract(1_u256), addr2);
}

// TEST 3: Deployed ticket is functional (can mint)
#[test]
fn test_deployed_ticket_is_functional() {
    let factory = deploy_factory();

    start_cheat_caller_address(factory.contract_address, organizer());
    let event_addr = factory
        .create_event(100_u256, 1000000_u256, 11000_u256, 1000_u256, marketplace_addr());
    stop_cheat_caller_address(factory.contract_address);

    // The organizer of the deployed ticket is whoever called create_event
    let ticket = IEventTicketDispatcher { contract_address: event_addr };
    start_cheat_caller_address(event_addr, organizer());
    ticket.mint(buyer(), 1_u256);
    stop_cheat_caller_address(event_addr);

    assert_eq!(ticket.owner_of(1_u256), buyer());
    assert_eq!(ticket.is_used(1_u256), false);
}

// TEST 4: Create event emits EventCreated
#[test]
fn test_create_event_emits_event() {
    let factory = deploy_factory();
    let mut spy = spy_events();

    start_cheat_caller_address(factory.contract_address, organizer());
    let event_addr = factory
        .create_event(100_u256, 1000000_u256, 11000_u256, 1000_u256, marketplace_addr());
    stop_cheat_caller_address(factory.contract_address);

    spy
        .assert_emitted(
            @array![
                (
                    factory.contract_address,
                    starknet_nft_ticketing::TicketFactory::TicketFactory::Event::EventCreated(
                        starknet_nft_ticketing::TicketFactory::TicketFactory::EventCreated {
                            event_id: 0_u256, contract_address: event_addr, organizer: organizer(),
                        },
                    ),
                ),
            ],
        );
}

// TEST 5: Event count starts at zero
#[test]
fn test_event_count_starts_at_zero() {
    let factory = deploy_factory();
    assert_eq!(factory.get_event_count(), 0_u256);
}
