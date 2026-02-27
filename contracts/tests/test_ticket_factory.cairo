use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, cheat_caller_address, CheatSpan, spy_events, EventSpyAssertionsTrait,
};
use starknet::{ContractAddress, contract_address_const, ClassHash};
use core::num::traits::Zero;

use starknet_nft_ticketing::TicketFactory::{
    ITicketFactoryDispatcher, ITicketFactoryDispatcherTrait, ITicketFactorySafeDispatcher,
    ITicketFactorySafeDispatcherTrait,
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
        .create_event(100_u64, 1000000_u128, 11000_u16, 1000_u16, marketplace_addr(), false, 0_u32);
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
        .create_event(50_u64, 500000_u128, 11000_u16, 500_u16, marketplace_addr(), false, 0_u32);
    let addr2 = factory
        .create_event(200_u64, 2000000_u128, 12000_u16, 1000_u16, marketplace_addr(), false, 0_u32);
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
        .create_event(100_u64, 1000000_u128, 11000_u16, 1000_u16, marketplace_addr(), false, 0_u32);
    stop_cheat_caller_address(factory.contract_address);

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
        .create_event(100_u64, 1000000_u128, 11000_u16, 1000_u16, marketplace_addr(), false, 0_u32);
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

// ═══════════════════════════════════════════════════════
// NEW TESTS: SOULBOUND + TRANSFER LIMITS VIA FACTORY
// ═══════════════════════════════════════════════════════

// TEST 6: Create soulbound event
#[test]
fn test_create_soulbound_event() {
    let factory = deploy_factory();

    start_cheat_caller_address(factory.contract_address, organizer());
    let event_addr = factory
        .create_event(100_u64, 1000000_u128, 11000_u16, 1000_u16, marketplace_addr(), true, 0_u32);
    stop_cheat_caller_address(factory.contract_address);

    let ticket = IEventTicketDispatcher { contract_address: event_addr };
    assert_eq!(ticket.is_soulbound(), true);
}

// TEST 7: Create event with transfer limit
#[test]
fn test_create_event_with_transfer_limit() {
    let factory = deploy_factory();

    start_cheat_caller_address(factory.contract_address, organizer());
    let event_addr = factory
        .create_event(100_u64, 1000000_u128, 11000_u16, 1000_u16, marketplace_addr(), false, 3_u32);
    stop_cheat_caller_address(factory.contract_address);

    let ticket = IEventTicketDispatcher { contract_address: event_addr };
    assert_eq!(ticket.is_soulbound(), false);
    assert_eq!(ticket.get_max_transfers(), 3_u32);
}

// ═══════════════════════════════════════════════════════
// NEW TESTS: update_ticket_class_hash
// ═══════════════════════════════════════════════════════

// TEST 8: update_ticket_class_hash success by owner
#[test]
fn test_update_ticket_class_hash_success() {
    let factory = deploy_factory();
    // Declare Marketplace as a different class hash to use
    let new_class = declare("Marketplace").unwrap().contract_class();
    let new_hash: ClassHash = *new_class.class_hash;

    start_cheat_caller_address(factory.contract_address, owner());
    factory.update_ticket_class_hash(new_hash);
    stop_cheat_caller_address(factory.contract_address);
    // No revert means success
}

// TEST 9: update_ticket_class_hash by non-owner -> NOT_OWNER
#[test]
#[feature("safe_dispatcher")]
fn test_update_ticket_class_hash_not_owner_fails() {
    let factory = deploy_factory();
    let safe = ITicketFactorySafeDispatcher { contract_address: factory.contract_address };
    let new_class = declare("Marketplace").unwrap().contract_class();
    let new_hash: ClassHash = *new_class.class_hash;

    cheat_caller_address(safe.contract_address, organizer(), CheatSpan::TargetCalls(1));
    match safe.update_ticket_class_hash(new_hash) {
        Result::Ok(_) => panic!("Should have failed with NOT_OWNER"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_OWNER', 'Wrong error code'),
    }
}

// TEST 10: update_ticket_class_hash with zero hash -> INVALID_CLASS_HASH
#[test]
#[feature("safe_dispatcher")]
fn test_update_ticket_class_hash_zero_fails() {
    let factory = deploy_factory();
    let safe = ITicketFactorySafeDispatcher { contract_address: factory.contract_address };
    let zero_hash: ClassHash = Zero::zero();

    cheat_caller_address(safe.contract_address, owner(), CheatSpan::TargetCalls(1));
    match safe.update_ticket_class_hash(zero_hash) {
        Result::Ok(_) => panic!("Should have failed with INVALID_CLASS_HASH"),
        Result::Err(err) => assert(*err.at(0) == 'INVALID_CLASS_HASH', 'Wrong error code'),
    }
}
