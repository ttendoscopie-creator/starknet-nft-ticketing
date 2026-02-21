use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, cheat_caller_address, CheatSpan, start_cheat_block_timestamp,
    stop_cheat_block_timestamp, start_cheat_transaction_hash, stop_cheat_transaction_hash,
    start_cheat_signature, stop_cheat_signature,
};
use snforge_std::signature::stark_curve::{StarkCurveKeyPairImpl, StarkCurveSignerImpl};
use snforge_std::signature::KeyPairTrait;
use starknet::{ContractAddress, contract_address_const, VALIDATED};

use starknet_nft_ticketing::AccountContract::{
    ISRC6Dispatcher, ISRC6DispatcherTrait, ISRC6SafeDispatcher, ISRC6SafeDispatcherTrait,
    ISessionAccountDispatcher, ISessionAccountDispatcherTrait, ISessionAccountSafeDispatcher,
    ISessionAccountSafeDispatcherTrait,
};

fn zero_address() -> ContractAddress {
    contract_address_const::<0>()
}

fn deploy_account() -> (
    ISRC6Dispatcher,
    ISRC6SafeDispatcher,
    ISessionAccountDispatcher,
    ISessionAccountSafeDispatcher,
    felt252, // owner secret key
    felt252, // owner public key
) {
    let key_pair = StarkCurveKeyPairImpl::generate();
    let contract = declare("AccountContract").unwrap().contract_class();
    let calldata = array![key_pair.public_key];
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (
        ISRC6Dispatcher { contract_address: addr },
        ISRC6SafeDispatcher { contract_address: addr },
        ISessionAccountDispatcher { contract_address: addr },
        ISessionAccountSafeDispatcher { contract_address: addr },
        key_pair.secret_key,
        key_pair.public_key,
    )
}

fn sign_hash(
    secret_key: felt252, hash: felt252,
) -> (felt252, felt252) {
    let key_pair = StarkCurveKeyPairImpl::from_secret_key(secret_key);
    let result = key_pair.sign(hash);
    match result {
        Result::Ok((r, s)) => (r, s),
        Result::Err(_) => panic!("Sign failed"),
    }
}

// TEST 1: get_owner_pubkey returns correct key
#[test]
fn test_get_owner_pubkey() {
    let (_, _, session, _, _, pubkey) = deploy_account();
    assert_eq!(session.get_owner_pubkey(), pubkey);
}

// TEST 2: is_valid_signature with correct owner key -> VALIDATED
#[test]
fn test_is_valid_signature_success() {
    let (src6, _, _, _, secret_key, _) = deploy_account();

    let hash: felt252 = 0x1234abcd;
    let (r, s) = sign_hash(secret_key, hash);

    let result = src6.is_valid_signature(hash, array![r, s]);
    assert_eq!(result, VALIDATED);
}

// TEST 3: is_valid_signature with wrong key -> returns 0
#[test]
fn test_is_valid_signature_wrong_key_returns_zero() {
    let (src6, _, _, _, _, _) = deploy_account();

    // Sign with a different keypair
    let other_key = StarkCurveKeyPairImpl::generate();
    let hash: felt252 = 0x1234abcd;
    let (r, s) = match other_key.sign(hash) {
        Result::Ok((r, s)) => (r, s),
        Result::Err(_) => panic!("Sign failed"),
    };

    let result = src6.is_valid_signature(hash, array![r, s]);
    assert_eq!(result, 0);
}

// TEST 4: __validate__ with correct owner signature -> VALIDATED
#[test]
fn test_validate_with_owner_key_success() {
    let (src6, _, _, _, secret_key, _) = deploy_account();
    let addr = src6.contract_address;

    let tx_hash: felt252 = 0xdeadbeef;
    let (r, s) = sign_hash(secret_key, tx_hash);

    start_cheat_caller_address(addr, zero_address());
    start_cheat_transaction_hash(addr, tx_hash);
    start_cheat_signature(addr, array![r, s].span());

    let result = src6.__validate__(array![]);
    assert_eq!(result, VALIDATED);

    stop_cheat_signature(addr);
    stop_cheat_transaction_hash(addr);
    stop_cheat_caller_address(addr);
}

// TEST 5: __validate__ with wrong signature -> INVALID_SIGNATURE
#[test]
#[feature("safe_dispatcher")]
fn test_validate_with_wrong_signature_fails() {
    let (_, safe_src6, _, _, _, _) = deploy_account();
    let addr = safe_src6.contract_address;

    let tx_hash: felt252 = 0xdeadbeef;

    start_cheat_caller_address(addr, zero_address());
    start_cheat_transaction_hash(addr, tx_hash);
    start_cheat_signature(addr, array![0x111, 0x222].span());

    match safe_src6.__validate__(array![]) {
        Result::Ok(_) => panic!("Should have failed with INVALID_SIGNATURE"),
        Result::Err(_) => (), // panic!("INVALID_SIGNATURE") uses ByteArray format
    }

    stop_cheat_signature(addr);
    stop_cheat_transaction_hash(addr);
    stop_cheat_caller_address(addr);
}

// TEST 6: set_session_key success + validate with session key
#[test]
fn test_set_session_key_success() {
    let (src6, _, session, _, _secret_key, _) = deploy_account();
    let addr = src6.contract_address;

    // Generate session keypair
    let session_kp = StarkCurveKeyPairImpl::generate();

    // Set session key (caller must be zero, like from __execute__)
    start_cheat_caller_address(addr, zero_address());
    start_cheat_block_timestamp(addr, 1000);
    session.set_session_key(session_kp.public_key, 2000, 1); // scope=1
    stop_cheat_block_timestamp(addr);

    // Now validate with session key signature
    let tx_hash: felt252 = 0xabcdef;
    let (r, s) = match session_kp.sign(tx_hash) {
        Result::Ok((r, s)) => (r, s),
        Result::Err(_) => panic!("Sign failed"),
    };

    start_cheat_block_timestamp(addr, 1500); // still before expiry
    start_cheat_transaction_hash(addr, tx_hash);
    start_cheat_signature(addr, array![r, s].span());

    let result = src6.__validate__(array![]);
    assert_eq!(result, VALIDATED);

    stop_cheat_signature(addr);
    stop_cheat_transaction_hash(addr);
    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);
}

// TEST 7: set_session_key with expiry in past -> EXPIRY_IN_PAST
#[test]
#[feature("safe_dispatcher")]
fn test_set_session_key_expiry_in_past_fails() {
    let (_, _, _, safe_session, _, _) = deploy_account();
    let addr = safe_session.contract_address;

    start_cheat_caller_address(addr, zero_address());
    start_cheat_block_timestamp(addr, 5000);

    match safe_session.set_session_key(0x123, 4000, 1) {
        Result::Ok(_) => panic!("Should have failed with EXPIRY_IN_PAST"),
        Result::Err(err) => assert(*err.at(0) == 'EXPIRY_IN_PAST', 'Wrong error code'),
    }

    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);
}

// TEST 8: set_session_key with expiry too long -> EXPIRY_TOO_LONG
#[test]
#[feature("safe_dispatcher")]
fn test_set_session_key_expiry_too_long_fails() {
    let (_, _, _, safe_session, _, _) = deploy_account();
    let addr = safe_session.contract_address;

    start_cheat_caller_address(addr, zero_address());
    start_cheat_block_timestamp(addr, 1000);

    // 1000 + 86401 = 87401 > 1000 + 86400
    match safe_session.set_session_key(0x123, 87401, 1) {
        Result::Ok(_) => panic!("Should have failed with EXPIRY_TOO_LONG"),
        Result::Err(err) => assert(*err.at(0) == 'EXPIRY_TOO_LONG', 'Wrong error code'),
    }

    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);
}
