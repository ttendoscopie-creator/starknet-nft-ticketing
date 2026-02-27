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
fn marketplace2() -> ContractAddress {
    contract_address_const::<'marketplace2'>()
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
        100, // max_supply: u64
        1000000, // primary_price: u128
        11000, // resale_cap_bps: u16
        1000, // royalty_bps: u16
        organizer().into(),
        marketplace().into(),
        0, // soulbound: false
        0 // max_transfers: 0 (unlimited)
    ];
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (
        IEventTicketDispatcher { contract_address: addr },
        IEventTicketSafeDispatcher { contract_address: addr },
    )
}

fn deploy_soulbound_ticket() -> (IEventTicketDispatcher, IEventTicketSafeDispatcher) {
    let contract = declare("EventTicket").unwrap().contract_class();

    let calldata = array![
        100, // max_supply
        1000000, // primary_price
        11000, // resale_cap_bps
        1000, // royalty_bps
        organizer().into(),
        marketplace().into(),
        1, // soulbound: true
        0 // max_transfers: 0
    ];
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (
        IEventTicketDispatcher { contract_address: addr },
        IEventTicketSafeDispatcher { contract_address: addr },
    )
}

fn deploy_transfer_limited_ticket() -> (IEventTicketDispatcher, IEventTicketSafeDispatcher) {
    let contract = declare("EventTicket").unwrap().contract_class();

    let calldata = array![
        100, // max_supply
        1000000, // primary_price
        11000, // resale_cap_bps
        1000, // royalty_bps
        organizer().into(),
        marketplace().into(),
        0, // soulbound: false
        2 // max_transfers: 2
    ];
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (
        IEventTicketDispatcher { contract_address: addr },
        IEventTicketSafeDispatcher { contract_address: addr },
    )
}

// ═══════════════════════════════════════════════════════
// EXISTING TESTS (updated for new types)
// ═══════════════════════════════════════════════════════

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

// TEST 4: Transfer without marketplace -> MARKETPLACE_NOT_ALLOWED
#[test]
#[feature("safe_dispatcher")]
fn test_transfer_bypass_marketplace_fails() {
    let (dispatcher, safe) = deploy_ticket();
    cheat_caller_address(dispatcher.contract_address, organizer(), CheatSpan::TargetCalls(1));
    dispatcher.mint(buyer(), 1_u256);

    cheat_caller_address(safe.contract_address, attacker(), CheatSpan::TargetCalls(1));
    match safe.transfer_ticket(buyer(), attacker(), 1_u256, 500000_u128) {
        Result::Ok(_) => panic!("Should have failed with MARKETPLACE_NOT_ALLOWED"),
        Result::Err(err) => assert(*err.at(0) == 'MARKETPLACE_NOT_ALLOWED', 'Wrong error code'),
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
    match safe.transfer_ticket(buyer(), other_buyer(), 1_u256, 2000000_u128) {
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
    let sale_price = 1000000_u128;
    let (recipient, amount) = dispatcher.get_royalty(sale_price);
    assert_eq!(amount, 100000_u128);
    assert_eq!(recipient, organizer());
}

// ═══════════════════════════════════════════════════════
// MODULE 6: SOULBOUND TESTS
// ═══════════════════════════════════════════════════════

// TEST 10: Soulbound transfer fails
#[test]
#[feature("safe_dispatcher")]
fn test_soulbound_transfer_fails() {
    let (dispatcher, safe) = deploy_soulbound_ticket();

    cheat_caller_address(dispatcher.contract_address, organizer(), CheatSpan::TargetCalls(1));
    dispatcher.mint(buyer(), 1_u256);

    cheat_caller_address(safe.contract_address, marketplace(), CheatSpan::TargetCalls(1));
    match safe.transfer_ticket(buyer(), other_buyer(), 1_u256, 500000_u128) {
        Result::Ok(_) => panic!("Should have failed with TICKET_SOULBOUND"),
        Result::Err(err) => assert(*err.at(0) == 'TICKET_SOULBOUND', 'Wrong error code'),
    }
}

// TEST 11: is_soulbound returns true for soulbound ticket
#[test]
fn test_soulbound_is_soulbound_returns_true() {
    let (dispatcher, _) = deploy_soulbound_ticket();
    assert_eq!(dispatcher.is_soulbound(), true);
}

// TEST 12: is_soulbound returns false for normal ticket
#[test]
fn test_non_soulbound_is_soulbound_returns_false() {
    let (dispatcher, _) = deploy_ticket();
    assert_eq!(dispatcher.is_soulbound(), false);
}

// TEST 13: Revoke ticket success
#[test]
fn test_revoke_ticket_success() {
    let (dispatcher, _) = deploy_ticket();

    start_cheat_caller_address(dispatcher.contract_address, organizer());
    dispatcher.mint(buyer(), 1_u256);
    dispatcher.revoke_ticket(1_u256);
    stop_cheat_caller_address(dispatcher.contract_address);

    assert_eq!(dispatcher.owner_of(1_u256), contract_address_const::<0>());
    assert_eq!(dispatcher.is_used(1_u256), true);
}

// TEST 14: Revoke ticket not organizer -> NOT_ORGANIZER
#[test]
#[feature("safe_dispatcher")]
fn test_revoke_ticket_not_organizer_fails() {
    let (dispatcher, safe) = deploy_ticket();
    cheat_caller_address(dispatcher.contract_address, organizer(), CheatSpan::TargetCalls(1));
    dispatcher.mint(buyer(), 1_u256);

    cheat_caller_address(safe.contract_address, attacker(), CheatSpan::TargetCalls(1));
    match safe.revoke_ticket(1_u256) {
        Result::Ok(_) => panic!("Should have failed with NOT_ORGANIZER"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_ORGANIZER', 'Wrong error code'),
    }
}

// TEST 15: Revoke unminted ticket -> TOKEN_NOT_MINTED
#[test]
#[feature("safe_dispatcher")]
fn test_revoke_unminted_ticket_fails() {
    let (_, safe) = deploy_ticket();

    cheat_caller_address(safe.contract_address, organizer(), CheatSpan::TargetCalls(1));
    match safe.revoke_ticket(1_u256) {
        Result::Ok(_) => panic!("Should have failed with TOKEN_NOT_MINTED"),
        Result::Err(err) => assert(*err.at(0) == 'TOKEN_NOT_MINTED', 'Wrong error code'),
    }
}

// ═══════════════════════════════════════════════════════
// MODULE 8: MARKETPLACE WHITELIST TESTS
// ═══════════════════════════════════════════════════════

// TEST 16: Transfer from unauthorized marketplace -> MARKETPLACE_NOT_ALLOWED
#[test]
#[feature("safe_dispatcher")]
fn test_transfer_unauthorized_marketplace_fails() {
    let (dispatcher, safe) = deploy_ticket();
    cheat_caller_address(dispatcher.contract_address, organizer(), CheatSpan::TargetCalls(1));
    dispatcher.mint(buyer(), 1_u256);

    // marketplace2 is not whitelisted
    cheat_caller_address(safe.contract_address, marketplace2(), CheatSpan::TargetCalls(1));
    match safe.transfer_ticket(buyer(), other_buyer(), 1_u256, 500000_u128) {
        Result::Ok(_) => panic!("Should have failed with MARKETPLACE_NOT_ALLOWED"),
        Result::Err(err) => assert(*err.at(0) == 'MARKETPLACE_NOT_ALLOWED', 'Wrong error code'),
    }
}

// TEST 17: Add and remove marketplace
#[test]
fn test_add_remove_marketplace() {
    let (dispatcher, _) = deploy_ticket();

    assert_eq!(dispatcher.is_marketplace_allowed(marketplace()), true);
    assert_eq!(dispatcher.is_marketplace_allowed(marketplace2()), false);

    start_cheat_caller_address(dispatcher.contract_address, organizer());
    dispatcher.add_marketplace(marketplace2());
    assert_eq!(dispatcher.is_marketplace_allowed(marketplace2()), true);

    dispatcher.remove_marketplace(marketplace2());
    assert_eq!(dispatcher.is_marketplace_allowed(marketplace2()), false);
    stop_cheat_caller_address(dispatcher.contract_address);
}

// TEST 18: Add marketplace not organizer -> NOT_ORGANIZER
#[test]
#[feature("safe_dispatcher")]
fn test_add_marketplace_not_organizer_fails() {
    let (_, safe) = deploy_ticket();

    cheat_caller_address(safe.contract_address, attacker(), CheatSpan::TargetCalls(1));
    match safe.add_marketplace(marketplace2()) {
        Result::Ok(_) => panic!("Should have failed with NOT_ORGANIZER"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_ORGANIZER', 'Wrong error code'),
    }
}

// ═══════════════════════════════════════════════════════
// MODULE 8: TRANSFER LIMIT TESTS
// ═══════════════════════════════════════════════════════

// TEST 19: Transfer count increments
#[test]
fn test_transfer_count_increments() {
    let (dispatcher, _) = deploy_transfer_limited_ticket();

    start_cheat_caller_address(dispatcher.contract_address, organizer());
    dispatcher.mint(buyer(), 1_u256);
    stop_cheat_caller_address(dispatcher.contract_address);

    assert_eq!(dispatcher.get_transfer_count(1_u256), 0_u32);
    assert_eq!(dispatcher.get_max_transfers(), 2_u32);

    // First transfer
    start_cheat_caller_address(dispatcher.contract_address, marketplace());
    dispatcher.transfer_ticket(buyer(), other_buyer(), 1_u256, 500000_u128);
    stop_cheat_caller_address(dispatcher.contract_address);

    assert_eq!(dispatcher.get_transfer_count(1_u256), 1_u32);

    // Second transfer
    start_cheat_caller_address(dispatcher.contract_address, marketplace());
    dispatcher.transfer_ticket(other_buyer(), buyer(), 1_u256, 500000_u128);
    stop_cheat_caller_address(dispatcher.contract_address);

    assert_eq!(dispatcher.get_transfer_count(1_u256), 2_u32);
}

// TEST 20: Max transfers reached -> MAX_TRANSFERS_REACHED
#[test]
#[feature("safe_dispatcher")]
fn test_max_transfers_reached_fails() {
    let (dispatcher, safe) = deploy_transfer_limited_ticket();

    cheat_caller_address(dispatcher.contract_address, organizer(), CheatSpan::TargetCalls(1));
    dispatcher.mint(buyer(), 1_u256);

    // Transfer 1
    cheat_caller_address(dispatcher.contract_address, marketplace(), CheatSpan::TargetCalls(1));
    dispatcher.transfer_ticket(buyer(), other_buyer(), 1_u256, 500000_u128);

    // Transfer 2
    cheat_caller_address(dispatcher.contract_address, marketplace(), CheatSpan::TargetCalls(1));
    dispatcher.transfer_ticket(other_buyer(), buyer(), 1_u256, 500000_u128);

    // Transfer 3 should fail (max_transfers = 2)
    cheat_caller_address(safe.contract_address, marketplace(), CheatSpan::TargetCalls(1));
    match safe.transfer_ticket(buyer(), other_buyer(), 1_u256, 500000_u128) {
        Result::Ok(_) => panic!("Should have failed with MAX_TRANSFERS_REACHED"),
        Result::Err(err) => assert(*err.at(0) == 'MAX_TRANSFERS_REACHED', 'Wrong error code'),
    }
}

// TEST 21: Unlimited transfers when max_transfers = 0
#[test]
fn test_unlimited_transfers_when_zero() {
    let (dispatcher, _) = deploy_ticket(); // max_transfers = 0

    start_cheat_caller_address(dispatcher.contract_address, organizer());
    dispatcher.mint(buyer(), 1_u256);
    stop_cheat_caller_address(dispatcher.contract_address);

    // Multiple transfers should all succeed
    start_cheat_caller_address(dispatcher.contract_address, marketplace());
    dispatcher.transfer_ticket(buyer(), other_buyer(), 1_u256, 500000_u128);
    dispatcher.transfer_ticket(other_buyer(), buyer(), 1_u256, 500000_u128);
    dispatcher.transfer_ticket(buyer(), other_buyer(), 1_u256, 500000_u128);
    stop_cheat_caller_address(dispatcher.contract_address);

    // transfer_count stays 0 when max_transfers=0 (no tracking needed)
    assert_eq!(dispatcher.get_transfer_count(1_u256), 0_u32);
}

// ═══════════════════════════════════════════════════════
// CONSTRUCTOR VALIDATION TESTS
// ═══════════════════════════════════════════════════════

// TEST 22: Constructor rejects zero organizer
#[test]
fn test_constructor_rejects_zero_organizer() {
    let contract = declare("EventTicket").unwrap().contract_class();
    let calldata = array![
        100, 1000000, 11000, 1000,
        0, // organizer = zero
        marketplace().into(),
        0, 0
    ];
    match contract.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with INVALID_ORGANIZER"),
        Result::Err(_) => (),
    }
}

// TEST 23: Constructor rejects zero marketplace
#[test]
fn test_constructor_rejects_zero_marketplace() {
    let contract = declare("EventTicket").unwrap().contract_class();
    let calldata = array![
        100, 1000000, 11000, 1000,
        organizer().into(),
        0, // marketplace = zero
        0, 0
    ];
    match contract.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with INVALID_MARKETPLACE"),
        Result::Err(_) => (),
    }
}

// TEST 24: Constructor rejects resale_cap > 50000
#[test]
fn test_constructor_rejects_cap_too_high() {
    let contract = declare("EventTicket").unwrap().contract_class();
    let calldata = array![
        100, 1000000, 50001, 1000, // resale_cap_bps = 50001 (> 500%)
        organizer().into(),
        marketplace().into(),
        0, 0
    ];
    match contract.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with CAP_MAX_500_PCT"),
        Result::Err(_) => (),
    }
}

// TEST 25: Constructor rejects resale_cap < 10000
#[test]
fn test_constructor_rejects_cap_too_low() {
    let contract = declare("EventTicket").unwrap().contract_class();
    let calldata = array![
        100, 1000000, 9999, 1000, // resale_cap_bps = 9999 (< 100%)
        organizer().into(),
        marketplace().into(),
        0, 0
    ];
    match contract.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with CAP_MIN_100_PCT"),
        Result::Err(_) => (),
    }
}

// TEST 26: Constructor rejects royalty_bps > 2000
#[test]
fn test_constructor_rejects_royalty_too_high() {
    let contract = declare("EventTicket").unwrap().contract_class();
    let calldata = array![
        100, 1000000, 11000, 2001, // royalty_bps = 2001 (> 20%)
        organizer().into(),
        marketplace().into(),
        0, 0
    ];
    match contract.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with ROYALTY_MAX_20_PCT"),
        Result::Err(_) => (),
    }
}
