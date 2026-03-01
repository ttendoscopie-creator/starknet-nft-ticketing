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
    ISessionAccountSafeDispatcherTrait, IRecoverableAccountDispatcher,
    IRecoverableAccountDispatcherTrait, IRecoverableAccountSafeDispatcher,
    IRecoverableAccountSafeDispatcherTrait,
};

fn zero_address() -> ContractAddress {
    contract_address_const::<0>()
}

fn guardian_address() -> ContractAddress {
    contract_address_const::<'guardian'>()
}

const RECOVERY_DELAY: u64 = 86400; // 24h

fn deploy_account() -> (
    ISRC6Dispatcher,
    ISRC6SafeDispatcher,
    ISessionAccountDispatcher,
    ISessionAccountSafeDispatcher,
    IRecoverableAccountDispatcher,
    IRecoverableAccountSafeDispatcher,
    felt252, // owner secret key
    felt252 // owner public key
) {
    let key_pair = StarkCurveKeyPairImpl::generate();
    let contract = declare("AccountContract").unwrap().contract_class();
    let calldata = array![key_pair.public_key, guardian_address().into(), RECOVERY_DELAY.into()];
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (
        ISRC6Dispatcher { contract_address: addr },
        ISRC6SafeDispatcher { contract_address: addr },
        ISessionAccountDispatcher { contract_address: addr },
        ISessionAccountSafeDispatcher { contract_address: addr },
        IRecoverableAccountDispatcher { contract_address: addr },
        IRecoverableAccountSafeDispatcher { contract_address: addr },
        key_pair.secret_key,
        key_pair.public_key,
    )
}

fn sign_hash(secret_key: felt252, hash: felt252) -> (felt252, felt252) {
    let key_pair = StarkCurveKeyPairImpl::from_secret_key(secret_key);
    let result = key_pair.sign(hash);
    match result {
        Result::Ok((r, s)) => (r, s),
        Result::Err(_) => panic!("Sign failed"),
    }
}

// ===== EXISTING TESTS (updated for new deploy_account signature) =====

// TEST 1: get_owner_pubkey returns correct key
#[test]
fn test_get_owner_pubkey() {
    let (_, _, session, _, _, _, _, pubkey) = deploy_account();
    assert_eq!(session.get_owner_pubkey(), pubkey);
}

// TEST 2: is_valid_signature with correct owner key -> VALIDATED
#[test]
fn test_is_valid_signature_success() {
    let (src6, _, _, _, _, _, secret_key, _) = deploy_account();

    let hash: felt252 = 0x1234abcd;
    let (r, s) = sign_hash(secret_key, hash);

    let result = src6.is_valid_signature(hash, array![r, s]);
    assert_eq!(result, VALIDATED);
}

// TEST 3: is_valid_signature with wrong key -> returns 0
#[test]
fn test_is_valid_signature_wrong_key_returns_zero() {
    let (src6, _, _, _, _, _, _, _) = deploy_account();

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
    let (src6, _, _, _, _, _, secret_key, _) = deploy_account();
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
    let (_, safe_src6, _, _, _, _, _, _) = deploy_account();
    let addr = safe_src6.contract_address;

    let tx_hash: felt252 = 0xdeadbeef;

    start_cheat_caller_address(addr, zero_address());
    start_cheat_transaction_hash(addr, tx_hash);
    start_cheat_signature(addr, array![0x111, 0x222].span());

    match safe_src6.__validate__(array![]) {
        Result::Ok(_) => panic!("Should have failed with INVALID_SIGNATURE"),
        Result::Err(err) => assert(*err.at(0) == 'INVALID_SIGNATURE', 'Wrong error code'),
    }

    stop_cheat_signature(addr);
    stop_cheat_transaction_hash(addr);
    stop_cheat_caller_address(addr);
}

// TEST 6: set_session_key success + validate with session key
#[test]
fn test_set_session_key_success() {
    let (src6, _, session, _, _, _, _secret_key, _) = deploy_account();
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
    let (_, _, _, safe_session, _, _, _, _) = deploy_account();
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
    let (_, _, _, safe_session, _, _, _, _) = deploy_account();
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

// ===== NEW RECOVERY TESTS =====

// TEST 9: set_guardian by owner succeeds
#[test]
fn test_set_guardian_by_owner() {
    let (_, _, _, _, recovery, _, _, _) = deploy_account();
    let addr = recovery.contract_address;

    // Verify initial guardian
    assert_eq!(recovery.get_guardian(), guardian_address());

    // Change guardian (owner-only = caller is zero)
    let new_guardian = contract_address_const::<'new_guardian'>();
    start_cheat_caller_address(addr, zero_address());
    recovery.set_guardian(new_guardian);
    stop_cheat_caller_address(addr);

    assert_eq!(recovery.get_guardian(), new_guardian);
}

// TEST 10: set_guardian by non-owner fails
#[test]
#[feature("safe_dispatcher")]
fn test_set_guardian_not_owner_fails() {
    let (_, _, _, _, _, safe_recovery, _, _) = deploy_account();
    let addr = safe_recovery.contract_address;

    let attacker = contract_address_const::<'attacker'>();
    let new_guardian = contract_address_const::<'new_guardian'>();

    start_cheat_caller_address(addr, attacker);
    match safe_recovery.set_guardian(new_guardian) {
        Result::Ok(_) => panic!("Should have failed with INVALID_CALLER"),
        Result::Err(err) => assert(*err.at(0) == 'INVALID_CALLER', 'Wrong error code'),
    }
    stop_cheat_caller_address(addr);
}

// TEST 11: initiate_recovery by guardian succeeds
#[test]
fn test_initiate_recovery_by_guardian() {
    let (_, _, _, _, recovery, _, _, _) = deploy_account();
    let addr = recovery.contract_address;

    let new_pubkey: felt252 = 0xBEEF;

    start_cheat_caller_address(addr, guardian_address());
    start_cheat_block_timestamp(addr, 100000);
    recovery.initiate_recovery(new_pubkey);
    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);

    let (pending, initiated_at) = recovery.get_recovery_status();
    assert_eq!(pending, new_pubkey);
    assert_eq!(initiated_at, 100000);
}

// TEST 12: initiate_recovery by non-guardian fails
#[test]
#[feature("safe_dispatcher")]
fn test_initiate_recovery_not_guardian_fails() {
    let (_, _, _, _, _, safe_recovery, _, _) = deploy_account();
    let addr = safe_recovery.contract_address;

    let attacker = contract_address_const::<'attacker'>();

    start_cheat_caller_address(addr, attacker);
    match safe_recovery.initiate_recovery(0xBEEF) {
        Result::Ok(_) => panic!("Should have failed with NOT_GUARDIAN"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_GUARDIAN', 'Wrong error code'),
    }
    stop_cheat_caller_address(addr);
}

// TEST 13: execute_recovery after timelock succeeds
#[test]
fn test_execute_recovery_success() {
    let (_, _, session, _, recovery, _, _, _) = deploy_account();
    let addr = recovery.contract_address;

    let new_pubkey: felt252 = 0xBEEF;

    // Guardian initiates recovery
    start_cheat_caller_address(addr, guardian_address());
    start_cheat_block_timestamp(addr, 100000);
    recovery.initiate_recovery(new_pubkey);
    stop_cheat_block_timestamp(addr);

    // Guardian executes after timelock (100000 + 86400 = 186400)
    start_cheat_block_timestamp(addr, 186400);
    recovery.execute_recovery();
    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);

    // Verify owner key changed
    assert_eq!(session.get_owner_pubkey(), new_pubkey);

    // Verify recovery state reset
    let (pending, initiated_at) = recovery.get_recovery_status();
    assert_eq!(pending, 0);
    assert_eq!(initiated_at, 0);
}

// TEST 14: execute_recovery too early fails
#[test]
#[feature("safe_dispatcher")]
fn test_execute_recovery_too_early_fails() {
    let (_, _, _, _, recovery, safe_recovery, _, _) = deploy_account();
    let addr = recovery.contract_address;

    // Guardian initiates recovery
    start_cheat_caller_address(addr, guardian_address());
    start_cheat_block_timestamp(addr, 100000);
    recovery.initiate_recovery(0xBEEF);
    stop_cheat_block_timestamp(addr);

    // Try to execute before timelock expires (100000 + 86400 - 1 = 186399)
    start_cheat_block_timestamp(addr, 186399);
    match safe_recovery.execute_recovery() {
        Result::Ok(_) => panic!("Should have failed with RECOVERY_TOO_EARLY"),
        Result::Err(err) => assert(*err.at(0) == 'RECOVERY_TOO_EARLY', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);
}

// TEST 15: cancel_recovery by owner succeeds
#[test]
fn test_cancel_recovery_by_owner() {
    let (_, _, _, _, recovery, _, _, _) = deploy_account();
    let addr = recovery.contract_address;

    // Guardian initiates recovery
    start_cheat_caller_address(addr, guardian_address());
    start_cheat_block_timestamp(addr, 100000);
    recovery.initiate_recovery(0xBEEF);
    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);

    // Owner cancels (caller == 0)
    start_cheat_caller_address(addr, zero_address());
    recovery.cancel_recovery();
    stop_cheat_caller_address(addr);

    let (pending, initiated_at) = recovery.get_recovery_status();
    assert_eq!(pending, 0);
    assert_eq!(initiated_at, 0);
}

// TEST 16: cancel_recovery by non-owner fails
#[test]
#[feature("safe_dispatcher")]
fn test_cancel_recovery_not_owner_fails() {
    let (_, _, _, _, recovery, safe_recovery, _, _) = deploy_account();
    let addr = recovery.contract_address;

    // Guardian initiates recovery
    start_cheat_caller_address(addr, guardian_address());
    start_cheat_block_timestamp(addr, 100000);
    recovery.initiate_recovery(0xBEEF);
    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);

    // Attacker tries to cancel
    let attacker = contract_address_const::<'attacker'>();
    start_cheat_caller_address(addr, attacker);
    match safe_recovery.cancel_recovery() {
        Result::Ok(_) => panic!("Should have failed with INVALID_CALLER"),
        Result::Err(err) => assert(*err.at(0) == 'INVALID_CALLER', 'Wrong error code'),
    }
    stop_cheat_caller_address(addr);
}

// TEST 17: rotate_owner_key by owner succeeds
#[test]
fn test_rotate_owner_key_success() {
    let (_, _, session, _, recovery, _, _, _) = deploy_account();
    let addr = recovery.contract_address;

    let new_pubkey: felt252 = 0xCAFE;

    start_cheat_caller_address(addr, zero_address());
    recovery.rotate_owner_key(new_pubkey);
    stop_cheat_caller_address(addr);

    assert_eq!(session.get_owner_pubkey(), new_pubkey);
}

// TEST 18: recovery revokes session key
#[test]
fn test_recovery_revokes_session_key() {
    let (src6, _, session, _, recovery, _, _secret_key, _) = deploy_account();
    let addr = src6.contract_address;

    // Set up a session key
    let session_kp = StarkCurveKeyPairImpl::generate();
    start_cheat_caller_address(addr, zero_address());
    start_cheat_block_timestamp(addr, 1000);
    session.set_session_key(session_kp.public_key, 2000, 1);
    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);

    // Guardian initiates recovery
    start_cheat_caller_address(addr, guardian_address());
    start_cheat_block_timestamp(addr, 1000);
    recovery.initiate_recovery(0xBEEF);
    stop_cheat_block_timestamp(addr);

    // Guardian executes recovery after timelock
    start_cheat_block_timestamp(addr, 1000 + RECOVERY_DELAY);
    recovery.execute_recovery();
    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);

    // Try to validate with old session key — should fail since session was revoked
    let tx_hash: felt252 = 0xabcdef;
    let (r, s) = match session_kp.sign(tx_hash) {
        Result::Ok((r, s)) => (r, s),
        Result::Err(_) => panic!("Sign failed"),
    };

    start_cheat_caller_address(addr, zero_address());
    start_cheat_block_timestamp(addr, 1500); // still within old expiry window
    start_cheat_transaction_hash(addr, tx_hash);
    start_cheat_signature(addr, array![r, s].span());

    // Signature should not be valid (session revoked, owner key changed)
    let result = src6.is_valid_signature(tx_hash, array![r, s]);
    // Session key was zeroed and owner key changed, so this should return 0
    assert_eq!(result, 0);

    stop_cheat_signature(addr);
    stop_cheat_transaction_hash(addr);
    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);
}

// ═══════════════════════════════════════════════════════
// CONSTRUCTOR + RECOVERY GUARD VALIDATION TESTS
// ═══════════════════════════════════════════════════════

// TEST 19: initiate_recovery when already pending -> RECOVERY_ALREADY_PENDING
#[test]
#[feature("safe_dispatcher")]
fn test_initiate_recovery_already_pending_fails() {
    let (_, _, _, _, recovery, safe_recovery, _, _) = deploy_account();
    let addr = recovery.contract_address;

    // Guardian initiates first recovery
    start_cheat_caller_address(addr, guardian_address());
    start_cheat_block_timestamp(addr, 100000);
    recovery.initiate_recovery(0xBEEF);
    stop_cheat_block_timestamp(addr);

    // Guardian tries to initiate another recovery
    start_cheat_block_timestamp(addr, 100100);
    match safe_recovery.initiate_recovery(0xCAFE) {
        Result::Ok(_) => panic!("Should have failed with RECOVERY_ALREADY_PENDING"),
        Result::Err(err) => assert(*err.at(0) == 'RECOVERY_ALREADY_PENDING', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);
}

// TEST 20: Constructor rejects zero guardian
#[test]
fn test_account_constructor_rejects_zero_guardian() {
    let key_pair = StarkCurveKeyPairImpl::generate();
    let contract = declare("AccountContract").unwrap().contract_class();
    let calldata = array![key_pair.public_key, 0, // guardian = zero
    86400];
    match contract.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with INVALID_GUARDIAN"),
        Result::Err(_) => (),
    }
}

// TEST 21: Constructor rejects zero recovery_delay
#[test]
fn test_account_constructor_rejects_zero_delay() {
    let key_pair = StarkCurveKeyPairImpl::generate();
    let contract = declare("AccountContract").unwrap().contract_class();
    let calldata = array![key_pair.public_key, guardian_address().into(), 0 // recovery_delay = 0
    ];
    match contract.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with DELAY_MUST_BE_POSITIVE"),
        Result::Err(_) => (),
    }
}

// TEST 22: Constructor rejects zero pubkey
#[test]
fn test_account_constructor_rejects_zero_pubkey() {
    let contract = declare("AccountContract").unwrap().contract_class();
    let calldata = array![0, // owner_pubkey = zero
    guardian_address().into(), 86400];
    match contract.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with INVALID_PUBKEY"),
        Result::Err(_) => (),
    }
}

// ═══════════════════════════════════════════════════════
// RECOVERY LIFECYCLE EDGE CASES
// ═══════════════════════════════════════════════════════

// TEST 23: Full recovery lifecycle: initiate -> cancel -> initiate again -> execute
#[test]
fn test_recovery_cancel_then_reinitiate() {
    let (_, _, session, _, recovery, _, _, _) = deploy_account();
    let addr = recovery.contract_address;

    // Guardian initiates recovery
    start_cheat_caller_address(addr, guardian_address());
    start_cheat_block_timestamp(addr, 100000);
    recovery.initiate_recovery(0xBEEF);
    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);

    // Owner cancels
    start_cheat_caller_address(addr, zero_address());
    recovery.cancel_recovery();
    stop_cheat_caller_address(addr);

    // Verify reset
    let (pending, _) = recovery.get_recovery_status();
    assert_eq!(pending, 0);

    // Guardian initiates again with different key
    start_cheat_caller_address(addr, guardian_address());
    start_cheat_block_timestamp(addr, 200000);
    recovery.initiate_recovery(0xCAFE);
    stop_cheat_block_timestamp(addr);

    // Execute after timelock
    start_cheat_block_timestamp(addr, 200000 + RECOVERY_DELAY);
    recovery.execute_recovery();
    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);

    assert_eq!(session.get_owner_pubkey(), 0xCAFE);
}

// TEST 24: Execute recovery with no pending -> NO_PENDING_RECOVERY
#[test]
#[feature("safe_dispatcher")]
fn test_execute_recovery_no_pending_fails() {
    let (_, _, _, _, _, safe_recovery, _, _) = deploy_account();
    let addr = safe_recovery.contract_address;

    start_cheat_caller_address(addr, guardian_address());
    match safe_recovery.execute_recovery() {
        Result::Ok(_) => panic!("Should have failed with NO_PENDING_RECOVERY"),
        Result::Err(err) => assert(*err.at(0) == 'NO_PENDING_RECOVERY', 'Wrong error code'),
    }
    stop_cheat_caller_address(addr);
}

// TEST 25: Initiate recovery with zero pubkey -> INVALID_PUBKEY
#[test]
#[feature("safe_dispatcher")]
fn test_initiate_recovery_zero_pubkey_fails() {
    let (_, _, _, _, _, safe_recovery, _, _) = deploy_account();
    let addr = safe_recovery.contract_address;

    start_cheat_caller_address(addr, guardian_address());
    match safe_recovery.initiate_recovery(0) {
        Result::Ok(_) => panic!("Should have failed with INVALID_PUBKEY"),
        Result::Err(err) => assert(*err.at(0) == 'INVALID_PUBKEY', 'Wrong error code'),
    }
    stop_cheat_caller_address(addr);
}

// TEST 26: rotate_owner_key revokes session keys
#[test]
fn test_rotate_owner_key_revokes_session() {
    let (src6, _, session, _, recovery, _, secret_key, _) = deploy_account();
    let addr = src6.contract_address;

    // Set session key
    let session_kp = StarkCurveKeyPairImpl::generate();
    start_cheat_caller_address(addr, zero_address());
    start_cheat_block_timestamp(addr, 1000);
    session.set_session_key(session_kp.public_key, 2000, 1);
    stop_cheat_block_timestamp(addr);

    // Rotate owner key
    let new_pubkey: felt252 = 0xDEAD;
    recovery.rotate_owner_key(new_pubkey);
    stop_cheat_caller_address(addr);

    // Verify new owner key
    assert_eq!(session.get_owner_pubkey(), new_pubkey);

    // Session key signature should fail (session was revoked)
    let tx_hash: felt252 = 0xabcdef;
    let (r, s) = match session_kp.sign(tx_hash) {
        Result::Ok((r, s)) => (r, s),
        Result::Err(_) => panic!("Sign failed"),
    };
    let result = src6.is_valid_signature(tx_hash, array![r, s]);
    assert_eq!(result, 0);
}

// TEST 27: rotate_owner_key with zero pubkey -> INVALID_PUBKEY
#[test]
#[feature("safe_dispatcher")]
fn test_rotate_owner_key_zero_pubkey_fails() {
    let (_, _, _, _, _, safe_recovery, _, _) = deploy_account();
    let addr = safe_recovery.contract_address;

    start_cheat_caller_address(addr, zero_address());
    match safe_recovery.rotate_owner_key(0) {
        Result::Ok(_) => panic!("Should have failed with INVALID_PUBKEY"),
        Result::Err(err) => assert(*err.at(0) == 'INVALID_PUBKEY', 'Wrong error code'),
    }
    stop_cheat_caller_address(addr);
}

// TEST 28: Execute recovery by non-guardian -> NOT_GUARDIAN
#[test]
#[feature("safe_dispatcher")]
fn test_execute_recovery_not_guardian_fails() {
    let (_, _, _, _, recovery, safe_recovery, _, _) = deploy_account();
    let addr = recovery.contract_address;

    // Guardian initiates
    start_cheat_caller_address(addr, guardian_address());
    start_cheat_block_timestamp(addr, 100000);
    recovery.initiate_recovery(0xBEEF);
    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);

    // Attacker tries to execute
    let attacker = contract_address_const::<'attacker'>();
    start_cheat_caller_address(addr, attacker);
    start_cheat_block_timestamp(addr, 100000 + RECOVERY_DELAY);
    match safe_recovery.execute_recovery() {
        Result::Ok(_) => panic!("Should have failed with NOT_GUARDIAN"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_GUARDIAN', 'Wrong error code'),
    }
    stop_cheat_block_timestamp(addr);
    stop_cheat_caller_address(addr);
}
