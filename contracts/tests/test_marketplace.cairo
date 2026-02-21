use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, cheat_caller_address, CheatSpan,
};
use starknet::{ContractAddress, contract_address_const};

use starknet_nft_ticketing::Marketplace::{
    IMarketplaceDispatcher, IMarketplaceDispatcherTrait, IMarketplaceSafeDispatcher,
    IMarketplaceSafeDispatcherTrait,
};
use starknet_nft_ticketing::EventTicket::{
    IEventTicketDispatcher, IEventTicketDispatcherTrait,
};
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
        500, 0, // platform_fee_bps = 500
        treasury().into(), // platform_treasury
    ];
    let (mkt_addr, _) = mkt_class.deploy(@mkt_calldata).unwrap();

    // 3. Deploy EventTicket with marketplace = mkt_addr
    let ticket_class = declare("EventTicket").unwrap().contract_class();
    let ticket_calldata = array![
        100, 0, // max_supply = 100
        1000000, 0, // primary_price = 1_000_000
        11000, 0, // resale_cap_bps = 11000 (110%)
        1000, 0, // royalty_bps = 1000 (10%)
        organizer().into(),
        mkt_addr.into(), // marketplace
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
