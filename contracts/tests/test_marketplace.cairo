use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, cheat_caller_address, CheatSpan,
};
use starknet::{ContractAddress, contract_address_const};

use starknet_nft_ticketing::Marketplace::{
    IMarketplaceDispatcher, IMarketplaceDispatcherTrait, IMarketplaceSafeDispatcher,
    IMarketplaceSafeDispatcherTrait,
};
use starknet_nft_ticketing::EventTicket::{IEventTicketDispatcher, IEventTicketDispatcherTrait};
use starknet_nft_ticketing::MockERC20::{IMockERC20Dispatcher, IMockERC20DispatcherTrait};

fn owner() -> ContractAddress {
    contract_address_const::<'owner'>()
}
fn seller() -> ContractAddress {
    contract_address_const::<'seller'>()
}
fn buyer_addr() -> ContractAddress {
    contract_address_const::<'buyer'>()
}
fn organizer() -> ContractAddress {
    contract_address_const::<'organizer'>()
}
fn treasury() -> ContractAddress {
    contract_address_const::<'treasury'>()
}
fn attacker() -> ContractAddress {
    contract_address_const::<'attacker'>()
}
fn staff() -> ContractAddress {
    contract_address_const::<'staff'>()
}

fn deploy_marketplace_with_ticket() -> (
    IMarketplaceDispatcher,
    IMarketplaceSafeDispatcher,
    IEventTicketDispatcher,
    IMockERC20Dispatcher,
) {
    // 1. Deploy MockERC20 with buyer holding 10_000_000 tokens
    let erc20_class = declare("MockERC20").unwrap().contract_class();
    let erc20_calldata = array![buyer_addr().into(), 10000000, 0];
    let (erc20_addr, _) = erc20_class.deploy(@erc20_calldata).unwrap();

    // 2. Deploy Marketplace (platform_fee = 500 bps = 5%)
    let mkt_class = declare("Marketplace").unwrap().contract_class();
    let mkt_calldata = array![
        owner().into(), // owner
        erc20_addr.into(), // payment_token
        500,
        0, // platform_fee_bps = 500
        treasury().into() // platform_treasury
    ];
    let (mkt_addr, _) = mkt_class.deploy(@mkt_calldata).unwrap();

    // 3. Deploy EventTicket with marketplace = mkt_addr (non-soulbound, unlimited transfers)
    let ticket_class = declare("EventTicket").unwrap().contract_class();
    let ticket_calldata = array![
        100, // max_supply: u64
        1000000, // primary_price: u128
        11000, // resale_cap_bps: u16 (110%)
        1000, // royalty_bps: u16 (10%)
        organizer().into(),
        mkt_addr.into(), // marketplace (added to whitelist)
        0, // soulbound: false
        0 // max_transfers: 0 (unlimited)
    ];
    let (ticket_addr, _) = ticket_class.deploy(@ticket_calldata).unwrap();

    (
        IMarketplaceDispatcher { contract_address: mkt_addr },
        IMarketplaceSafeDispatcher { contract_address: mkt_addr },
        IEventTicketDispatcher { contract_address: ticket_addr },
        IMockERC20Dispatcher { contract_address: erc20_addr },
    )
}

fn deploy_marketplace_with_soulbound_ticket() -> (
    IMarketplaceSafeDispatcher, IEventTicketDispatcher,
) {
    let erc20_class = declare("MockERC20").unwrap().contract_class();
    let erc20_calldata = array![buyer_addr().into(), 10000000, 0];
    let (erc20_addr, _) = erc20_class.deploy(@erc20_calldata).unwrap();

    let mkt_class = declare("Marketplace").unwrap().contract_class();
    let mkt_calldata = array![owner().into(), erc20_addr.into(), 500, 0, treasury().into()];
    let (mkt_addr, _) = mkt_class.deploy(@mkt_calldata).unwrap();

    // Soulbound ticket
    let ticket_class = declare("EventTicket").unwrap().contract_class();
    let ticket_calldata = array![
        100, 1000000, 11000, 1000, organizer().into(), mkt_addr.into(), 1, // soulbound: true
        0,
    ];
    let (ticket_addr, _) = ticket_class.deploy(@ticket_calldata).unwrap();

    (
        IMarketplaceSafeDispatcher { contract_address: mkt_addr },
        IEventTicketDispatcher { contract_address: ticket_addr },
    )
}

fn deploy_marketplace_with_transfer_limited_ticket() -> (
    IMarketplaceDispatcher,
    IMarketplaceSafeDispatcher,
    IEventTicketDispatcher,
    IMockERC20Dispatcher,
) {
    let erc20_class = declare("MockERC20").unwrap().contract_class();
    let erc20_calldata = array![buyer_addr().into(), 10000000, 0];
    let (erc20_addr, _) = erc20_class.deploy(@erc20_calldata).unwrap();

    let mkt_class = declare("Marketplace").unwrap().contract_class();
    let mkt_calldata = array![owner().into(), erc20_addr.into(), 500, 0, treasury().into()];
    let (mkt_addr, _) = mkt_class.deploy(@mkt_calldata).unwrap();

    // Transfer-limited ticket (max 1 transfer)
    let ticket_class = declare("EventTicket").unwrap().contract_class();
    let ticket_calldata = array![
        100,
        1000000,
        11000,
        1000,
        organizer().into(),
        mkt_addr.into(),
        0, // soulbound: false
        1 // max_transfers: 1
    ];
    let (ticket_addr, _) = ticket_class.deploy(@ticket_calldata).unwrap();

    (
        IMarketplaceDispatcher { contract_address: mkt_addr },
        IMarketplaceSafeDispatcher { contract_address: mkt_addr },
        IEventTicketDispatcher { contract_address: ticket_addr },
        IMockERC20Dispatcher { contract_address: erc20_addr },
    )
}

fn mint_ticket_to_seller(ticket: IEventTicketDispatcher, token_id: u256) {
    start_cheat_caller_address(ticket.contract_address, organizer());
    ticket.mint(seller(), token_id);
    stop_cheat_caller_address(ticket.contract_address);
}

// ═══════════════════════════════════════════════════════
// EXISTING TESTS
// ═══════════════════════════════════════════════════════

// TEST 1: Create listing success
#[test]
fn test_create_listing_success() {
    let (mkt, _, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    start_cheat_caller_address(mkt.contract_address, seller());
    let listing_id = mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    stop_cheat_caller_address(mkt.contract_address);

    assert_eq!(listing_id, 0_u256);
}

// TEST 2: Create listing not owner -> NOT_OWNER
#[test]
#[feature("safe_dispatcher")]
fn test_create_listing_not_owner_fails() {
    let (_, safe_mkt, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    cheat_caller_address(safe_mkt.contract_address, attacker(), CheatSpan::TargetCalls(1));
    match safe_mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256) {
        Result::Ok(_) => panic!("Should have failed with NOT_OWNER"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_OWNER', 'Wrong error code'),
    }
}

// TEST 3: Create listing used ticket -> TICKET_USED
#[test]
#[feature("safe_dispatcher")]
fn test_create_listing_used_ticket_fails() {
    let (_, safe_mkt, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    // Add staff and mark used
    start_cheat_caller_address(ticket.contract_address, organizer());
    ticket.add_staff(staff());
    stop_cheat_caller_address(ticket.contract_address);
    start_cheat_caller_address(ticket.contract_address, staff());
    ticket.mark_used(1_u256);
    stop_cheat_caller_address(ticket.contract_address);

    cheat_caller_address(safe_mkt.contract_address, seller(), CheatSpan::TargetCalls(1));
    match safe_mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256) {
        Result::Ok(_) => panic!("Should have failed with TICKET_USED"),
        Result::Err(err) => assert(*err.at(0) == 'TICKET_USED', 'Wrong error code'),
    }
}

// TEST 4: Create listing zero price -> PRICE_ZERO
#[test]
#[feature("safe_dispatcher")]
fn test_create_listing_zero_price_fails() {
    let (_, safe_mkt, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    cheat_caller_address(safe_mkt.contract_address, seller(), CheatSpan::TargetCalls(1));
    match safe_mkt.create_listing(ticket.contract_address, 1_u256, 0_u256) {
        Result::Ok(_) => panic!("Should have failed with PRICE_ZERO"),
        Result::Err(err) => assert(*err.at(0) == 'PRICE_ZERO', 'Wrong error code'),
    }
}

// TEST 5: Cancel listing success
#[test]
#[feature("safe_dispatcher")]
fn test_cancel_listing_success() {
    let (mkt, safe_mkt, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    start_cheat_caller_address(mkt.contract_address, seller());
    let listing_id = mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    mkt.cancel_listing(listing_id);
    stop_cheat_caller_address(mkt.contract_address);

    // Buying cancelled listing should fail
    cheat_caller_address(safe_mkt.contract_address, buyer_addr(), CheatSpan::TargetCalls(1));
    match safe_mkt.buy_listing(listing_id) {
        Result::Ok(_) => panic!("Should have failed with NOT_ACTIVE"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_ACTIVE', 'Wrong error code'),
    }
}

// TEST 6: Cancel listing not seller -> NOT_SELLER
#[test]
#[feature("safe_dispatcher")]
fn test_cancel_listing_not_seller_fails() {
    let (mkt, safe_mkt, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    start_cheat_caller_address(mkt.contract_address, seller());
    let listing_id = mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    stop_cheat_caller_address(mkt.contract_address);

    cheat_caller_address(safe_mkt.contract_address, attacker(), CheatSpan::TargetCalls(1));
    match safe_mkt.cancel_listing(listing_id) {
        Result::Ok(_) => panic!("Should have failed with NOT_SELLER"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_SELLER', 'Wrong error code'),
    }
}

// TEST 7: Cancel already inactive listing -> NOT_ACTIVE
#[test]
#[feature("safe_dispatcher")]
fn test_cancel_listing_already_inactive_fails() {
    let (mkt, safe_mkt, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    start_cheat_caller_address(mkt.contract_address, seller());
    let listing_id = mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    mkt.cancel_listing(listing_id);
    stop_cheat_caller_address(mkt.contract_address);

    cheat_caller_address(safe_mkt.contract_address, seller(), CheatSpan::TargetCalls(1));
    match safe_mkt.cancel_listing(listing_id) {
        Result::Ok(_) => panic!("Should have failed with NOT_ACTIVE"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_ACTIVE', 'Wrong error code'),
    }
}

// TEST 8: Buy listing success — ticket ownership transferred
#[test]
fn test_buy_listing_success() {
    let (mkt, _, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    // Seller creates listing at 1_000_000
    start_cheat_caller_address(mkt.contract_address, seller());
    let listing_id = mkt.create_listing(ticket.contract_address, 1_u256, 1000000_u256);
    stop_cheat_caller_address(mkt.contract_address);

    // Buyer buys
    start_cheat_caller_address(mkt.contract_address, buyer_addr());
    mkt.buy_listing(listing_id);
    stop_cheat_caller_address(mkt.contract_address);

    // Ticket now owned by buyer
    assert_eq!(ticket.owner_of(1_u256), buyer_addr());
}

// TEST 9: Buy inactive listing -> NOT_ACTIVE
#[test]
#[feature("safe_dispatcher")]
fn test_buy_listing_inactive_fails() {
    let (mkt, safe_mkt, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    start_cheat_caller_address(mkt.contract_address, seller());
    let listing_id = mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    mkt.cancel_listing(listing_id);
    stop_cheat_caller_address(mkt.contract_address);

    cheat_caller_address(safe_mkt.contract_address, buyer_addr(), CheatSpan::TargetCalls(1));
    match safe_mkt.buy_listing(listing_id) {
        Result::Ok(_) => panic!("Should have failed with NOT_ACTIVE"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_ACTIVE', 'Wrong error code'),
    }
}

// TEST 10: Buy listing with used ticket -> TICKET_USED
#[test]
#[feature("safe_dispatcher")]
fn test_buy_listing_used_ticket_fails() {
    let (mkt, safe_mkt, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    // Create listing
    start_cheat_caller_address(mkt.contract_address, seller());
    let listing_id = mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    stop_cheat_caller_address(mkt.contract_address);

    // Mark ticket used after listing
    start_cheat_caller_address(ticket.contract_address, organizer());
    ticket.add_staff(staff());
    stop_cheat_caller_address(ticket.contract_address);
    start_cheat_caller_address(ticket.contract_address, staff());
    ticket.mark_used(1_u256);
    stop_cheat_caller_address(ticket.contract_address);

    // Buy should fail
    cheat_caller_address(safe_mkt.contract_address, buyer_addr(), CheatSpan::TargetCalls(1));
    match safe_mkt.buy_listing(listing_id) {
        Result::Ok(_) => panic!("Should have failed with TICKET_USED"),
        Result::Err(err) => assert(*err.at(0) == 'TICKET_USED', 'Wrong error code'),
    }
}

// TEST 11: Buy listing payment distribution — verify royalties, fee, seller amount
#[test]
fn test_buy_listing_payment_distribution_correct() {
    let (mkt, _, ticket, erc20) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    let price = 1000000_u256; // 1_000_000

    // Seller lists
    start_cheat_caller_address(mkt.contract_address, seller());
    let listing_id = mkt.create_listing(ticket.contract_address, 1_u256, price);
    stop_cheat_caller_address(mkt.contract_address);

    // Record balances before
    let buyer_before = erc20.balance_of(buyer_addr());

    // Buyer buys
    start_cheat_caller_address(mkt.contract_address, buyer_addr());
    mkt.buy_listing(listing_id);
    stop_cheat_caller_address(mkt.contract_address);

    // Expected distribution:
    // royalty = 1_000_000 * 1000 / 10000 = 100_000 -> organizer
    // platform_fee = 1_000_000 * 500 / 10000 = 50_000 -> treasury
    // seller_amount = 1_000_000 - 100_000 - 50_000 = 850_000 -> seller
    let buyer_after = erc20.balance_of(buyer_addr());
    assert_eq!(buyer_before - buyer_after, price);
    assert_eq!(erc20.balance_of(organizer()), 100000_u256);
    assert_eq!(erc20.balance_of(treasury()), 50000_u256);
    assert_eq!(erc20.balance_of(seller()), 850000_u256);
    assert_eq!(ticket.owner_of(1_u256), buyer_addr());
}

// ═══════════════════════════════════════════════════════
// MODULE 6: SOULBOUND MARKETPLACE TESTS
// ═══════════════════════════════════════════════════════

// TEST 12: Create listing for soulbound ticket -> TICKET_SOULBOUND
#[test]
#[feature("safe_dispatcher")]
fn test_create_listing_soulbound_ticket_fails() {
    let (safe_mkt, ticket) = deploy_marketplace_with_soulbound_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    cheat_caller_address(safe_mkt.contract_address, seller(), CheatSpan::TargetCalls(1));
    match safe_mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256) {
        Result::Ok(_) => panic!("Should have failed with TICKET_SOULBOUND"),
        Result::Err(err) => assert(*err.at(0) == 'TICKET_SOULBOUND', 'Wrong error code'),
    }
}

// ═══════════════════════════════════════════════════════
// MODULE 8: TRANSFER LIMIT MARKETPLACE TESTS
// ═══════════════════════════════════════════════════════

// TEST 13: Buy listing respects transfer limit
#[test]
#[feature("safe_dispatcher")]
fn test_buy_listing_respects_transfer_limit() {
    let (mkt, safe_mkt, ticket, _) = deploy_marketplace_with_transfer_limited_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    // First sale: seller -> buyer at 500_000 (transfer 1/1)
    start_cheat_caller_address(mkt.contract_address, seller());
    let listing_id = mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    stop_cheat_caller_address(mkt.contract_address);

    start_cheat_caller_address(mkt.contract_address, buyer_addr());
    mkt.buy_listing(listing_id);
    stop_cheat_caller_address(mkt.contract_address);

    assert_eq!(ticket.owner_of(1_u256), buyer_addr());

    // Second sale: buyer -> seller at 100_000 (seller has 425_000 from first sale, enough)
    // max_transfers=1, so this should fail with MAX_TRANSFERS_REACHED
    start_cheat_caller_address(mkt.contract_address, buyer_addr());
    let listing_id2 = mkt.create_listing(ticket.contract_address, 1_u256, 100000_u256);
    stop_cheat_caller_address(mkt.contract_address);

    cheat_caller_address(safe_mkt.contract_address, seller(), CheatSpan::TargetCalls(1));
    match safe_mkt.buy_listing(listing_id2) {
        Result::Ok(_) => panic!("Should have failed with MAX_TRANSFERS_REACHED"),
        Result::Err(err) => assert(*err.at(0) == 'MAX_TRANSFERS_REACHED', 'Wrong error code'),
    }
}

// ═══════════════════════════════════════════════════════
// CONSTRUCTOR VALIDATION TESTS
// ═══════════════════════════════════════════════════════

// TEST 14: Constructor rejects zero owner
#[test]
fn test_marketplace_constructor_rejects_zero_owner() {
    let mkt_class = declare("Marketplace").unwrap().contract_class();
    let erc20 = contract_address_const::<'erc20'>();
    let calldata = array![0, // owner = zero
    erc20.into(), 500, 0, treasury().into()];
    match mkt_class.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with INVALID_OWNER"),
        Result::Err(_) => (),
    }
}

// TEST 15: Constructor rejects fee > 5000
#[test]
fn test_marketplace_constructor_rejects_fee_too_high() {
    let mkt_class = declare("Marketplace").unwrap().contract_class();
    let erc20 = contract_address_const::<'erc20'>();
    let calldata = array![
        owner().into(), erc20.into(), 5001, 0, // fee_bps = 5001 (> 50%)
        treasury().into(),
    ];
    match mkt_class.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with FEE_TOO_HIGH"),
        Result::Err(_) => (),
    }
}

// TEST 16: Constructor rejects zero payment_token
#[test]
fn test_marketplace_constructor_rejects_zero_token() {
    let mkt_class = declare("Marketplace").unwrap().contract_class();
    let calldata = array![owner().into(), 0, // payment_token = zero
    500, 0, treasury().into()];
    match mkt_class.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with INVALID_TOKEN"),
        Result::Err(_) => (),
    }
}

// TEST 17: Constructor rejects zero treasury
#[test]
fn test_marketplace_constructor_rejects_zero_treasury() {
    let mkt_class = declare("Marketplace").unwrap().contract_class();
    let erc20 = contract_address_const::<'erc20'>();
    let calldata = array![owner().into(), erc20.into(), 500, 0, 0 // treasury = zero
    ];
    match mkt_class.deploy(@calldata) {
        Result::Ok(_) => panic!("Should have failed with INVALID_TREASURY"),
        Result::Err(_) => (),
    }
}

// ═══════════════════════════════════════════════════════
// VIEW FUNCTION TESTS
// ═══════════════════════════════════════════════════════

// TEST 18: get_listing returns correct data
#[test]
fn test_get_listing_returns_data() {
    let (mkt, _, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    start_cheat_caller_address(mkt.contract_address, seller());
    let listing_id = mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    stop_cheat_caller_address(mkt.contract_address);

    let (s, tc, tid, price, active) = mkt.get_listing(listing_id);
    assert_eq!(s, seller());
    assert_eq!(tc, ticket.contract_address);
    assert_eq!(tid, 1_u256);
    assert_eq!(price, 500000_u256);
    assert_eq!(active, true);
}

// TEST 19: get_listing_count increments
#[test]
fn test_get_listing_count() {
    let (mkt, _, ticket, _) = deploy_marketplace_with_ticket();

    assert_eq!(mkt.get_listing_count(), 0_u256);

    mint_ticket_to_seller(ticket, 1_u256);
    start_cheat_caller_address(mkt.contract_address, seller());
    mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    stop_cheat_caller_address(mkt.contract_address);

    assert_eq!(mkt.get_listing_count(), 1_u256);
}

// TEST 20: get_platform_fee, get_payment_token, get_treasury
#[test]
fn test_marketplace_config_views() {
    let (mkt, _, _, erc20) = deploy_marketplace_with_ticket();

    assert_eq!(mkt.get_platform_fee(), 500_u256); // 500 bps = 5%
    assert_eq!(mkt.get_payment_token(), erc20.contract_address);
    assert_eq!(mkt.get_treasury(), treasury());
}

// TEST 21: is_listing_active
#[test]
fn test_is_listing_active() {
    let (mkt, _, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    start_cheat_caller_address(mkt.contract_address, seller());
    let listing_id = mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    assert_eq!(mkt.is_listing_active(listing_id), true);

    mkt.cancel_listing(listing_id);
    assert_eq!(mkt.is_listing_active(listing_id), false);
    stop_cheat_caller_address(mkt.contract_address);
}

// ═══════════════════════════════════════════════════════
// PAUSE MECHANISM TESTS
// ═══════════════════════════════════════════════════════

// TEST 22: Pause and unpause success
#[test]
fn test_marketplace_pause_unpause() {
    let (mkt, _, _, _) = deploy_marketplace_with_ticket();

    assert_eq!(mkt.is_paused(), false);

    start_cheat_caller_address(mkt.contract_address, owner());
    mkt.pause();
    assert_eq!(mkt.is_paused(), true);

    mkt.unpause();
    assert_eq!(mkt.is_paused(), false);
    stop_cheat_caller_address(mkt.contract_address);
}

// TEST 23: Pause by non-owner -> NOT_OWNER
#[test]
#[feature("safe_dispatcher")]
fn test_marketplace_pause_not_owner_fails() {
    let (_, safe_mkt, _, _) = deploy_marketplace_with_ticket();

    cheat_caller_address(safe_mkt.contract_address, attacker(), CheatSpan::TargetCalls(1));
    match safe_mkt.pause() {
        Result::Ok(_) => panic!("Should have failed with NOT_OWNER"),
        Result::Err(err) => assert(*err.at(0) == 'NOT_OWNER', 'Wrong error code'),
    }
}

// TEST 24: Create listing while paused -> CONTRACT_PAUSED
#[test]
#[feature("safe_dispatcher")]
fn test_create_listing_while_paused_fails() {
    let (mkt, safe_mkt, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    start_cheat_caller_address(mkt.contract_address, owner());
    mkt.pause();
    stop_cheat_caller_address(mkt.contract_address);

    cheat_caller_address(safe_mkt.contract_address, seller(), CheatSpan::TargetCalls(1));
    match safe_mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256) {
        Result::Ok(_) => panic!("Should have failed with CONTRACT_PAUSED"),
        Result::Err(err) => assert(*err.at(0) == 'CONTRACT_PAUSED', 'Wrong error code'),
    }
}

// TEST 25: Buy listing while paused -> CONTRACT_PAUSED
#[test]
#[feature("safe_dispatcher")]
fn test_buy_listing_while_paused_fails() {
    let (mkt, safe_mkt, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    start_cheat_caller_address(mkt.contract_address, seller());
    let listing_id = mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    stop_cheat_caller_address(mkt.contract_address);

    start_cheat_caller_address(mkt.contract_address, owner());
    mkt.pause();
    stop_cheat_caller_address(mkt.contract_address);

    cheat_caller_address(safe_mkt.contract_address, buyer_addr(), CheatSpan::TargetCalls(1));
    match safe_mkt.buy_listing(listing_id) {
        Result::Ok(_) => panic!("Should have failed with CONTRACT_PAUSED"),
        Result::Err(err) => assert(*err.at(0) == 'CONTRACT_PAUSED', 'Wrong error code'),
    }
}

// TEST 26: Operations resume after unpause
#[test]
fn test_marketplace_operations_resume_after_unpause() {
    let (mkt, _, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    start_cheat_caller_address(mkt.contract_address, owner());
    mkt.pause();
    mkt.unpause();
    stop_cheat_caller_address(mkt.contract_address);

    start_cheat_caller_address(mkt.contract_address, seller());
    let listing_id = mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    stop_cheat_caller_address(mkt.contract_address);

    assert_eq!(mkt.is_listing_active(listing_id), true);
}

// ═══════════════════════════════════════════════════════
// CONCURRENCE + EDGE CASE TESTS
// ═══════════════════════════════════════════════════════

// TEST 27: Double listing same ticket — second listing creates separate ID
// (on-chain doesn't prevent multiple listings for same token, the buy_listing checks ownership)
#[test]
fn test_double_listing_same_ticket() {
    let (mkt, _, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    start_cheat_caller_address(mkt.contract_address, seller());
    let listing1 = mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    let listing2 = mkt.create_listing(ticket.contract_address, 1_u256, 600000_u256);
    stop_cheat_caller_address(mkt.contract_address);

    // Both listings created with different IDs
    assert!(listing1 != listing2);
    assert_eq!(mkt.get_listing_count(), 2_u256);
    assert_eq!(mkt.is_listing_active(listing1), true);
    assert_eq!(mkt.is_listing_active(listing2), true);
}

// TEST 28: Buy first listing, second listing for same token fails on buy (ownership changed)
#[test]
#[feature("safe_dispatcher")]
fn test_buy_after_ownership_transfer_fails() {
    let (mkt, safe_mkt, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    // Seller creates two listings for the same ticket
    start_cheat_caller_address(mkt.contract_address, seller());
    let listing1 = mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    let listing2 = mkt.create_listing(ticket.contract_address, 1_u256, 600000_u256);
    stop_cheat_caller_address(mkt.contract_address);

    // Buyer buys listing1 — ticket transfers to buyer
    start_cheat_caller_address(mkt.contract_address, buyer_addr());
    mkt.buy_listing(listing1);
    stop_cheat_caller_address(mkt.contract_address);

    assert_eq!(ticket.owner_of(1_u256), buyer_addr());

    // Another buyer tries to buy listing2 — should fail (seller no longer owns the ticket)
    let buyer2 = contract_address_const::<'buyer2'>();
    cheat_caller_address(safe_mkt.contract_address, buyer2, CheatSpan::TargetCalls(1));
    match safe_mkt.buy_listing(listing2) {
        Result::Ok(_) => panic!("Should have failed - seller no longer owns ticket"),
        Result::Err(_) => () // Fails because transfer_ticket checks ownership
    }
}

// TEST 29: Cancel listing while paused -> CONTRACT_PAUSED
#[test]
#[feature("safe_dispatcher")]
fn test_cancel_listing_while_paused_fails() {
    let (mkt, safe_mkt, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);

    start_cheat_caller_address(mkt.contract_address, seller());
    let listing_id = mkt.create_listing(ticket.contract_address, 1_u256, 500000_u256);
    stop_cheat_caller_address(mkt.contract_address);

    start_cheat_caller_address(mkt.contract_address, owner());
    mkt.pause();
    stop_cheat_caller_address(mkt.contract_address);

    cheat_caller_address(safe_mkt.contract_address, seller(), CheatSpan::TargetCalls(1));
    match safe_mkt.cancel_listing(listing_id) {
        Result::Ok(_) => panic!("Should have failed with CONTRACT_PAUSED"),
        Result::Err(err) => assert(*err.at(0) == 'CONTRACT_PAUSED', 'Wrong error code'),
    }
}

// TEST 30: Listing and buying multiple tickets in sequence
#[test]
fn test_multiple_tickets_list_and_buy() {
    let (mkt, _, ticket, _) = deploy_marketplace_with_ticket();
    mint_ticket_to_seller(ticket, 1_u256);
    mint_ticket_to_seller(ticket, 2_u256);

    start_cheat_caller_address(mkt.contract_address, seller());
    let listing1 = mkt.create_listing(ticket.contract_address, 1_u256, 300000_u256);
    let listing2 = mkt.create_listing(ticket.contract_address, 2_u256, 400000_u256);
    stop_cheat_caller_address(mkt.contract_address);

    // Buy both
    start_cheat_caller_address(mkt.contract_address, buyer_addr());
    mkt.buy_listing(listing1);
    mkt.buy_listing(listing2);
    stop_cheat_caller_address(mkt.contract_address);

    assert_eq!(ticket.owner_of(1_u256), buyer_addr());
    assert_eq!(ticket.owner_of(2_u256), buyer_addr());
    assert_eq!(mkt.is_listing_active(listing1), false);
    assert_eq!(mkt.is_listing_active(listing2), false);
}
