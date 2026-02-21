use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, cheat_caller_address, CheatSpan,
};
use starknet::{ContractAddress, contract_address_const};

use starknet_nft_ticketing::EventTicket::{
    IEventTicketDispatcher, IEventTicketDispatcherTrait, IEventTicketSafeDispatcher,
    IEventTicketSafeDispatcherTrait,
};

fn organizer() -> ContractAddress {
    contract_address_const::<'organizer'>()
}
fn buyer() -> ContractAddress {
    contract_address_const::<'buyer'>()
}
fn other_buyer() -> ContractAddress {
    contract_address_const::<'other_buyer'>()
}
fn marketplace() -> ContractAddress {
    contract_address_const::<'marketplace'>()
}
fn attacker() -> ContractAddress {
    contract_address_const::<'attacker'>()
}
fn staff() -> ContractAddress {
    contract_address_const::<'staff'>()
}

fn deploy_ticket() -> (IEventTicketDispatcher, IEventTicketSafeDispatcher) {
    let contract = declare("EventTicket").unwrap().contract_class();

    let calldata = array![
        100,
        0, // max_supply = 100
        1000000,
        0, // primary_price = 1_000_000
        11000,
        0, // resale_cap_bps = 11000 (+10% max)
        1000,
        0, // royalty_bps = 1000 (10%)
        organizer().into(),
        marketplace().into(),
    ];
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (
        IEventTicketDispatcher { contract_address: addr },
        IEventTicketSafeDispatcher { contract_address: addr },
    )
}

// TEST 1: Mint nominal
#[test]
fn test_mint_success() {
    let (dispatcher, _) = deploy_ticket();

    start_cheat_caller_address(dispatcher.contract_address, organizer());
    dispatcher.mint(buyer(), 1_u256);
    stop_cheat_caller_address(dispatcher.contract_address);

    assert_eq!(dispatcher.owner_of(1_u256), buyer());
    assert_eq!(dispatcher.is_used(1_u256), false);
}

// TEST 2: Double mint -> ALREADY_MINTED
#[test]
#[feature("safe_dispatcher")]
fn test_mint_double_fails() {
    let (_, safe) = deploy_ticket();
    cheat_caller_address(safe.contract_address, organizer(), CheatSpan::TargetCalls(2));
    safe.mint(buyer(), 1_u256).unwrap();
    match safe.mint(buyer(), 1_u256) {
        Result::Ok(_) => panic!("Should have failed with ALREADY_MINTED"),
        Result::Err(err) => assert(*err.at(0) == 'ALREADY_MINTED', 'Wrong error code'),
    }
}

// TEST 3: Mint unauthorized -> NOT_ORGANIZER
#[test]
#[feature("safe_dispatcher")]
fn test_mint_unauthorized_fails() {
    let (_, safe) = deploy_ticket();
    cheat_caller_address(safe.contract_address, attacker(), CheatSpan::TargetCalls(1));
    match safe.mint(attacker(), 1_u256) {
        Result::Ok(_) => panic!("Should have failed with NOT_ORGANIZER"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_ORGANIZER', 'Wrong error code'),
    }
}

// TEST 4: Transfer without marketplace -> ONLY_MARKETPLACE
#[test]
#[feature("safe_dispatcher")]
fn test_transfer_bypass_marketplace_fails() {
    let (dispatcher, safe) = deploy_ticket();
    cheat_caller_address(dispatcher.contract_address, organizer(), CheatSpan::TargetCalls(1));
    dispatcher.mint(buyer(), 1_u256);

    cheat_caller_address(safe.contract_address, attacker(), CheatSpan::TargetCalls(1));
    match safe.transfer_ticket(buyer(), attacker(), 1_u256, 500000_u256) {
        Result::Ok(_) => panic!("Should have failed with ONLY_MARKETPLACE"),
        Result::Err(err) => assert(*err.at(0) == 'ONLY_MARKETPLACE', 'Wrong error code'),
    }
}

// TEST 5: Resale price above cap -> PRICE_EXCEEDS_CAP
#[test]
#[feature("safe_dispatcher")]
fn test_transfer_above_cap_fails() {
    let (dispatcher, safe) = deploy_ticket();
    cheat_caller_address(dispatcher.contract_address, organizer(), CheatSpan::TargetCalls(1));
    dispatcher.mint(buyer(), 1_u256);

    cheat_caller_address(safe.contract_address, marketplace(), CheatSpan::TargetCalls(1));
    match safe.transfer_ticket(buyer(), other_buyer(), 1_u256, 2000000_u256) {
        Result::Ok(_) => panic!("Should have failed with PRICE_EXCEEDS_CAP"),
        Result::Err(err) => assert(*err.at(0) == 'PRICE_EXCEEDS_CAP', 'Wrong error code'),
    }
}

// TEST 6: mark_used by staff -> success
#[test]
fn test_mark_used_by_staff_success() {
    let (dispatcher, _) = deploy_ticket();
    start_cheat_caller_address(dispatcher.contract_address, organizer());
    dispatcher.mint(buyer(), 1_u256);
    dispatcher.add_staff(staff());
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, staff());
    dispatcher.mark_used(1_u256);
    stop_cheat_caller_address(dispatcher.contract_address);

    assert_eq!(dispatcher.is_used(1_u256), true);
}

// TEST 7: mark_used without staff role -> NOT_STAFF
#[test]
#[feature("safe_dispatcher")]
fn test_mark_used_unauthorized_fails() {
    let (dispatcher, safe) = deploy_ticket();
    cheat_caller_address(dispatcher.contract_address, organizer(), CheatSpan::TargetCalls(1));
    dispatcher.mint(buyer(), 1_u256);

    cheat_caller_address(safe.contract_address, buyer(), CheatSpan::TargetCalls(1));
    match safe.mark_used(1_u256) {
        Result::Ok(_) => panic!("Should have failed with NOT_STAFF"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_STAFF', 'Wrong error code'),
    }
}

// TEST 8: Double mark_used -> ALREADY_USED
#[test]
#[feature("safe_dispatcher")]
fn test_mark_used_twice_fails() {
    let (dispatcher, safe) = deploy_ticket();
    start_cheat_caller_address(dispatcher.contract_address, organizer());
    dispatcher.mint(buyer(), 1_u256);
    dispatcher.add_staff(staff());
    stop_cheat_caller_address(dispatcher.contract_address);

    cheat_caller_address(dispatcher.contract_address, staff(), CheatSpan::TargetCalls(1));
    dispatcher.mark_used(1_u256);

    cheat_caller_address(safe.contract_address, staff(), CheatSpan::TargetCalls(1));
    match safe.mark_used(1_u256) {
        Result::Ok(_) => panic!("Should have failed with ALREADY_USED"),
        Result::Err(err) => assert(*err.at(0) == 'ALREADY_USED', 'Wrong error code'),
    }
}

// TEST 9: Royalty calculation correct
#[test]
fn test_royalty_calculation_correct() {
    let (dispatcher, _) = deploy_ticket();
    let sale_price = 1000000_u256;
    let (recipient, amount) = dispatcher.get_royalty(sale_price);
    assert_eq!(amount, 100000_u256);
    assert_eq!(recipient, organizer());
}
