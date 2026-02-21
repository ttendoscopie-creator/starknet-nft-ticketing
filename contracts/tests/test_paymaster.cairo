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

fn deploy_paymaster() -> (IPaymasterDispatcher, IPaymasterSafeDispatcher) {
    let contract = declare("Paymaster").unwrap().contract_class();
    let calldata = array![
        owner().into(), // owner
        100000, 0, // max_gas_per_tx = 100_000
        500000, 0, // daily_limit = 500_000
    ];
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (
        IPaymasterDispatcher { contract_address: addr },
        IPaymasterSafeDispatcher { contract_address: addr },
    )
}

// TEST 1: Whitelist + validate_and_pay success
#[test]
fn test_whitelist_and_validate_success() {
    let (dispatcher, _) = deploy_paymaster();

    start_cheat_block_timestamp(dispatcher.contract_address, 86400);
    start_cheat_caller_address(dispatcher.contract_address, owner());
    dispatcher.whitelist_account(user());
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, user());
    dispatcher.validate_and_pay(user(), 50000_u256);
    stop_cheat_caller_address(dispatcher.contract_address);
    stop_cheat_block_timestamp(dispatcher.contract_address);
}

// TEST 2: validate_and_pay not whitelisted -> NOT_WHITELISTED
#[test]
#[feature("safe_dispatcher")]
fn test_validate_not_whitelisted_fails() {
    let (_, safe) = deploy_paymaster();
    start_cheat_block_timestamp(safe.contract_address, 86400);
    cheat_caller_address(safe.contract_address, user(), CheatSpan::TargetCalls(1));
    match safe.validate_and_pay(user(), 50000_u256) {
        Result::Ok(_) => panic!("Should have failed with NOT_WHITELISTED"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_WHITELISTED', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(safe.contract_address);
}

// TEST 3: Gas too high -> GAS_TOO_HIGH
#[test]
#[feature("safe_dispatcher")]
fn test_validate_gas_too_high_fails() {
    let (dispatcher, safe) = deploy_paymaster();

    start_cheat_block_timestamp(dispatcher.contract_address, 86400);
    start_cheat_caller_address(dispatcher.contract_address, owner());
    dispatcher.whitelist_account(user());
    stop_cheat_caller_address(dispatcher.contract_address);

    cheat_caller_address(safe.contract_address, user(), CheatSpan::TargetCalls(1));
    match safe.validate_and_pay(user(), 200000_u256) {
        Result::Ok(_) => panic!("Should have failed with GAS_TOO_HIGH"),
        Result::Err(err) => assert(*err.at(0) == 'GAS_TOO_HIGH', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(dispatcher.contract_address);
}

// TEST 4: Daily limit reached -> DAILY_LIMIT_REACHED
#[test]
#[feature("safe_dispatcher")]
fn test_validate_daily_limit_reached_fails() {
    let (dispatcher, safe) = deploy_paymaster();

    start_cheat_block_timestamp(dispatcher.contract_address, 86400);
    start_cheat_caller_address(dispatcher.contract_address, owner());
    dispatcher.whitelist_account(user());
    stop_cheat_caller_address(dispatcher.contract_address);

    // Use up 500_000 daily limit (5 x 100_000)
    start_cheat_caller_address(dispatcher.contract_address, user());
    dispatcher.validate_and_pay(user(), 100000_u256);
    dispatcher.validate_and_pay(user(), 100000_u256);
    dispatcher.validate_and_pay(user(), 100000_u256);
    dispatcher.validate_and_pay(user(), 100000_u256);
    dispatcher.validate_and_pay(user(), 100000_u256);
    stop_cheat_caller_address(dispatcher.contract_address);

    // Next call should fail
    cheat_caller_address(safe.contract_address, user(), CheatSpan::TargetCalls(1));
    match safe.validate_and_pay(user(), 1_u256) {
        Result::Ok(_) => panic!("Should have failed with DAILY_LIMIT_REACHED"),
        Result::Err(err) => assert(*err.at(0) == 'DAILY_LIMIT_REACHED', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(dispatcher.contract_address);
}

// TEST 5: Daily limit resets next day
#[test]
fn test_daily_limit_resets_next_day() {
    let (dispatcher, _) = deploy_paymaster();

    start_cheat_block_timestamp(dispatcher.contract_address, 86400);
    start_cheat_caller_address(dispatcher.contract_address, owner());
    dispatcher.whitelist_account(user());
    stop_cheat_caller_address(dispatcher.contract_address);

    // Use up daily limit
    start_cheat_caller_address(dispatcher.contract_address, user());
    dispatcher.validate_and_pay(user(), 100000_u256);
    dispatcher.validate_and_pay(user(), 100000_u256);
    dispatcher.validate_and_pay(user(), 100000_u256);
    dispatcher.validate_and_pay(user(), 100000_u256);
    dispatcher.validate_and_pay(user(), 100000_u256);
    stop_cheat_caller_address(dispatcher.contract_address);

    // Advance to next day
    stop_cheat_block_timestamp(dispatcher.contract_address);
    start_cheat_block_timestamp(dispatcher.contract_address, 86400 * 2);

    // Should succeed now
    start_cheat_caller_address(dispatcher.contract_address, user());
    dispatcher.validate_and_pay(user(), 50000_u256);
    stop_cheat_caller_address(dispatcher.contract_address);
    stop_cheat_block_timestamp(dispatcher.contract_address);
}

// TEST 6: Remove account then validate fails
#[test]
#[feature("safe_dispatcher")]
fn test_remove_account_then_validate_fails() {
    let (dispatcher, safe) = deploy_paymaster();

    start_cheat_block_timestamp(dispatcher.contract_address, 86400);
    start_cheat_caller_address(dispatcher.contract_address, owner());
    dispatcher.whitelist_account(user());
    dispatcher.remove_account(user());
    stop_cheat_caller_address(dispatcher.contract_address);

    cheat_caller_address(safe.contract_address, user(), CheatSpan::TargetCalls(1));
    match safe.validate_and_pay(user(), 50000_u256) {
        Result::Ok(_) => panic!("Should have failed with NOT_WHITELISTED"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_WHITELISTED', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(dispatcher.contract_address);
}

// TEST 7: set_limits by owner changes enforcement
#[test]
#[feature("safe_dispatcher")]
fn test_set_limits_by_owner_success() {
    let (dispatcher, safe) = deploy_paymaster();

    start_cheat_block_timestamp(dispatcher.contract_address, 86400);
    start_cheat_caller_address(dispatcher.contract_address, owner());
    dispatcher.whitelist_account(user());
    // Lower max_gas_per_tx to 10_000
    dispatcher.set_limits(10000_u256, 500000_u256);
    stop_cheat_caller_address(dispatcher.contract_address);

    // 50_000 gas should now fail (was valid before, now > 10_000 max)
    cheat_caller_address(safe.contract_address, user(), CheatSpan::TargetCalls(1));
    match safe.validate_and_pay(user(), 50000_u256) {
        Result::Ok(_) => panic!("Should have failed with GAS_TOO_HIGH"),
        Result::Err(err) => assert(*err.at(0) == 'GAS_TOO_HIGH', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(dispatcher.contract_address);
}

// TEST 8: Whitelist by non-owner -> NOT_OWNER
#[test]
#[feature("safe_dispatcher")]
fn test_whitelist_by_non_owner_fails() {
    let (_, safe) = deploy_paymaster();
    cheat_caller_address(safe.contract_address, attacker(), CheatSpan::TargetCalls(1));
    match safe.whitelist_account(user()) {
        Result::Ok(_) => panic!("Should have failed with NOT_OWNER"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_OWNER', 'Wrong error code'),
    }
}
