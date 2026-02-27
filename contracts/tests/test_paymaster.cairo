use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, cheat_caller_address, CheatSpan, start_cheat_block_timestamp,
    stop_cheat_block_timestamp,
};
use starknet::{ContractAddress, contract_address_const};

use starknet_nft_ticketing::Paymaster::{
    IPaymasterDispatcher, IPaymasterDispatcherTrait, IPaymasterSafeDispatcher,
    IPaymasterSafeDispatcherTrait,
};

fn owner() -> ContractAddress {
    contract_address_const::<'owner'>()
}
fn user() -> ContractAddress {
    contract_address_const::<'user'>()
}
fn attacker() -> ContractAddress {
    contract_address_const::<'attacker'>()
}
fn organizer1() -> ContractAddress {
    contract_address_const::<'organizer1'>()
}
fn strk_token() -> ContractAddress {
    contract_address_const::<0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d>()
}

const MAX_GAS_PER_TX: u256 = 100000;
const MAX_TXS_PER_DAY: u64 = 10;
const MIN_INTERVAL: u64 = 60; // 60 seconds

fn deploy_paymaster() -> (IPaymasterDispatcher, IPaymasterSafeDispatcher) {
    let contract = declare("Paymaster").unwrap().contract_class();
    let calldata = array![
        owner().into(), // owner
        strk_token().into(), // strk_token
        100000,
        0, // max_gas_per_tx = 100_000 (u256 low, high)
        MAX_TXS_PER_DAY.into(), // max_txs_per_day
        MIN_INTERVAL.into() // min_interval
    ];
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (
        IPaymasterDispatcher { contract_address: addr },
        IPaymasterSafeDispatcher { contract_address: addr },
    )
}

/// Helper: set up organizer and sponsor user, returns dispatcher
fn setup_sponsored_user() -> (IPaymasterDispatcher, IPaymasterSafeDispatcher) {
    let (dispatcher, safe) = deploy_paymaster();
    let addr = dispatcher.contract_address;

    start_cheat_caller_address(addr, owner());
    dispatcher.setup_organizer(organizer1(), 500000, 200000); // budget=500k, daily=200k
    dispatcher.sponsor_account(user(), organizer1());
    stop_cheat_caller_address(addr);

    (dispatcher, safe)
}

// TEST 1: Setup organizer + sponsor + validate_and_pay success (happy path)
#[test]
fn test_setup_organizer_and_sponsor_success() {
    let (dispatcher, _) = setup_sponsored_user();
    let addr = dispatcher.contract_address;

    start_cheat_block_timestamp(addr, 86400);
    dispatcher.validate_and_pay(user(), 50000_u256);
    stop_cheat_block_timestamp(addr);

    // Verify budget tracking
    let (budget, spent) = dispatcher.get_organizer_budget(organizer1());
    assert_eq!(budget, 500000);
    assert_eq!(spent, 50000);
}

// TEST 2: validate_and_pay when account not sponsored -> NOT_SPONSORED
#[test]
#[feature("safe_dispatcher")]
fn test_validate_not_sponsored_fails() {
    let (_, safe) = deploy_paymaster();
    let addr = safe.contract_address;

    start_cheat_block_timestamp(addr, 86400);
    match safe.validate_and_pay(user(), 50000_u256) {
        Result::Ok(_) => panic!("Should have failed with NOT_SPONSORED"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_SPONSORED', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(addr);
}

// TEST 3: validate_and_pay when organizer inactive -> ORGANIZER_INACTIVE
#[test]
#[feature("safe_dispatcher")]
fn test_validate_organizer_inactive_fails() {
    let (dispatcher, safe) = setup_sponsored_user();
    let addr = dispatcher.contract_address;

    // Deactivate organizer
    start_cheat_caller_address(addr, owner());
    dispatcher.deactivate_organizer(organizer1());
    stop_cheat_caller_address(addr);

    start_cheat_block_timestamp(addr, 86400);
    match safe.validate_and_pay(user(), 50000_u256) {
        Result::Ok(_) => panic!("Should have failed with ORGANIZER_INACTIVE"),
        Result::Err(err) => assert(*err.at(0) == 'ORGANIZER_INACTIVE', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(addr);
}

// TEST 4: Gas too high -> GAS_TOO_HIGH
#[test]
#[feature("safe_dispatcher")]
fn test_validate_gas_too_high_fails() {
    let (_, safe) = setup_sponsored_user();
    let addr = safe.contract_address;

    start_cheat_block_timestamp(addr, 86400);
    match safe.validate_and_pay(user(), 200000_u256) {
        Result::Ok(_) => panic!("Should have failed with GAS_TOO_HIGH"),
        Result::Err(err) => assert(*err.at(0) == 'GAS_TOO_HIGH', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(addr);
}

// TEST 5: Anti-spam interval -> TOO_FREQUENT
#[test]
#[feature("safe_dispatcher")]
fn test_validate_anti_spam_interval_fails() {
    let (dispatcher, safe) = setup_sponsored_user();
    let addr = dispatcher.contract_address;

    // First call at t=86400
    start_cheat_block_timestamp(addr, 86400);
    dispatcher.validate_and_pay(user(), 10000_u256);
    stop_cheat_block_timestamp(addr);

    // Second call too soon (86400 + 30 < 86400 + 60)
    start_cheat_block_timestamp(addr, 86430);
    match safe.validate_and_pay(user(), 10000_u256) {
        Result::Ok(_) => panic!("Should have failed with TOO_FREQUENT"),
        Result::Err(err) => assert(*err.at(0) == 'TOO_FREQUENT', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(addr);
}

// TEST 6: Anti-spam daily tx count -> DAILY_TX_LIMIT
#[test]
#[feature("safe_dispatcher")]
fn test_validate_anti_spam_daily_count_fails() {
    let (dispatcher, safe) = deploy_paymaster();
    let addr = dispatcher.contract_address;

    // Setup with large budget so budget isn't the bottleneck
    start_cheat_caller_address(addr, owner());
    dispatcher.setup_organizer(organizer1(), 10000000, 10000000);
    dispatcher.sponsor_account(user(), organizer1());
    stop_cheat_caller_address(addr);

    // Exhaust daily tx count (10 txs, each MIN_INTERVAL apart)
    let base_time: u64 = 86400;
    let mut i: u64 = 0;
    loop {
        if i >= MAX_TXS_PER_DAY {
            break;
        }
        start_cheat_block_timestamp(addr, base_time + (i * MIN_INTERVAL));
        dispatcher.validate_and_pay(user(), 1000_u256);
        stop_cheat_block_timestamp(addr);
        i += 1;
    };

    // 11th call should fail (still same day, enough interval)
    start_cheat_block_timestamp(addr, base_time + (MAX_TXS_PER_DAY * MIN_INTERVAL));
    match safe.validate_and_pay(user(), 1000_u256) {
        Result::Ok(_) => panic!("Should have failed with DAILY_TX_LIMIT"),
        Result::Err(err) => assert(*err.at(0) == 'DAILY_TX_LIMIT', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(addr);
}

// TEST 7: Per-organizer daily limit -> ORG_DAILY_LIMIT
#[test]
#[feature("safe_dispatcher")]
fn test_validate_organizer_daily_limit_fails() {
    let (dispatcher, safe) = setup_sponsored_user();
    let addr = dispatcher.contract_address;

    // daily_limit = 200000, spend 200000 in two calls
    start_cheat_block_timestamp(addr, 86400);
    dispatcher.validate_and_pay(user(), 100000_u256);
    stop_cheat_block_timestamp(addr);

    start_cheat_block_timestamp(addr, 86400 + MIN_INTERVAL);
    dispatcher.validate_and_pay(user(), 100000_u256);
    stop_cheat_block_timestamp(addr);

    // Third call exceeds daily limit
    start_cheat_block_timestamp(addr, 86400 + MIN_INTERVAL * 2);
    match safe.validate_and_pay(user(), 1_u256) {
        Result::Ok(_) => panic!("Should have failed with ORG_DAILY_LIMIT"),
        Result::Err(err) => assert(*err.at(0) == 'ORG_DAILY_LIMIT', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(addr);
}

// TEST 8: Budget exceeded -> BUDGET_EXCEEDED
#[test]
#[feature("safe_dispatcher")]
fn test_validate_budget_exceeded_fails() {
    let (dispatcher, safe) = deploy_paymaster();
    let addr = dispatcher.contract_address;

    // Small budget, large daily limit
    start_cheat_caller_address(addr, owner());
    dispatcher.setup_organizer(organizer1(), 50000, 10000000); // budget=50k only
    dispatcher.sponsor_account(user(), organizer1());
    stop_cheat_caller_address(addr);

    // First call uses up 50k
    start_cheat_block_timestamp(addr, 86400);
    dispatcher.validate_and_pay(user(), 50000_u256);
    stop_cheat_block_timestamp(addr);

    // Second call exceeds budget
    start_cheat_block_timestamp(addr, 86400 + MIN_INTERVAL);
    match safe.validate_and_pay(user(), 1_u256) {
        Result::Ok(_) => panic!("Should have failed with BUDGET_EXCEEDED"),
        Result::Err(err) => assert(*err.at(0) == 'BUDGET_EXCEEDED', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(addr);
}

// TEST 9: Organizer daily limit resets next day
#[test]
fn test_organizer_daily_limit_resets() {
    let (dispatcher, _) = setup_sponsored_user();
    let addr = dispatcher.contract_address;

    // Use up daily limit on day 1
    start_cheat_block_timestamp(addr, 86400);
    dispatcher.validate_and_pay(user(), 100000_u256);
    stop_cheat_block_timestamp(addr);

    start_cheat_block_timestamp(addr, 86400 + MIN_INTERVAL);
    dispatcher.validate_and_pay(user(), 100000_u256);
    stop_cheat_block_timestamp(addr);
    // daily_limit = 200000, spent = 200000

    // Advance to day 2 (86400 * 2 = 172800)
    start_cheat_block_timestamp(addr, 172800);
    // Should succeed — daily limit reset
    dispatcher.validate_and_pay(user(), 50000_u256);
    stop_cheat_block_timestamp(addr);
}

// TEST 10: Deactivate organizer blocks validate_and_pay
#[test]
fn test_deactivate_organizer_success() {
    let (dispatcher, _) = setup_sponsored_user();
    let addr = dispatcher.contract_address;

    assert!(dispatcher.is_organizer_active(organizer1()));

    start_cheat_caller_address(addr, owner());
    dispatcher.deactivate_organizer(organizer1());
    stop_cheat_caller_address(addr);

    assert!(!dispatcher.is_organizer_active(organizer1()));
}

// TEST 11: setup_organizer by non-owner fails
#[test]
#[feature("safe_dispatcher")]
fn test_setup_organizer_not_owner_fails() {
    let (_, safe) = deploy_paymaster();
    let addr = safe.contract_address;

    cheat_caller_address(addr, attacker(), CheatSpan::TargetCalls(1));
    match safe.setup_organizer(organizer1(), 500000, 200000) {
        Result::Ok(_) => panic!("Should have failed with NOT_OWNER"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_OWNER', 'Wrong error code'),
    }
}

// TEST 12: unsponsor_account success
#[test]
#[feature("safe_dispatcher")]
fn test_unsponsor_account_success() {
    let (dispatcher, safe) = setup_sponsored_user();
    let addr = dispatcher.contract_address;

    // Verify account is sponsored
    assert_eq!(dispatcher.get_account_organizer(user()), organizer1());

    // Unsponsor
    start_cheat_caller_address(addr, owner());
    dispatcher.unsponsor_account(user());
    stop_cheat_caller_address(addr);

    // Now validate should fail
    start_cheat_block_timestamp(addr, 86400);
    match safe.validate_and_pay(user(), 50000_u256) {
        Result::Ok(_) => panic!("Should have failed with NOT_SPONSORED"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_SPONSORED', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(addr);
}

// ═══════════════════════════════════════════════════════
// CONSTRUCTOR VALIDATION TESTS
// ═══════════════════════════════════════════════════════

// TEST 13: Constructor rejects zero owner
#[test]
fn test_paymaster_constructor_rejects_zero_owner() {
    let contract = declare("Paymaster").unwrap().contract_class();
    let calldata = array![0, // owner = zero
    strk_token().into(), 100000, 0, 10, 60];
    match contract.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with INVALID_OWNER"),
        Result::Err(_) => (),
    }
}

// TEST 14: Constructor rejects zero strk_token
#[test]
fn test_paymaster_constructor_rejects_zero_token() {
    let contract = declare("Paymaster").unwrap().contract_class();
    let calldata = array![owner().into(), 0, // strk_token = zero
    100000, 0, 10, 60];
    match contract.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with INVALID_TOKEN"),
        Result::Err(_) => (),
    }
}

// TEST 15: Constructor rejects zero max_gas_per_tx
#[test]
fn test_paymaster_constructor_rejects_zero_gas() {
    let contract = declare("Paymaster").unwrap().contract_class();
    let calldata = array![owner().into(), strk_token().into(), 0, 0, // max_gas_per_tx = 0
    10, 60];
    match contract.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with MAX_GAS_MUST_BE_POSITIVE"),
        Result::Err(_) => (),
    }
}

// TEST 16: Constructor rejects zero max_txs_per_day
#[test]
fn test_paymaster_constructor_rejects_zero_txs() {
    let contract = declare("Paymaster").unwrap().contract_class();
    let calldata = array![
        owner().into(), strk_token().into(), 100000, 0, 0, // max_txs_per_day = 0
        60,
    ];
    match contract.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with MAX_TXS_MUST_BE_POSITIVE"),
        Result::Err(_) => (),
    }
}
