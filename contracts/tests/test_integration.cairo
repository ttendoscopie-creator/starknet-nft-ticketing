use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::{ContractAddress, contract_address_const};

use starknet_nft_ticketing::TicketFactory::{
    ITicketFactoryDispatcher, ITicketFactoryDispatcherTrait,
};
use starknet_nft_ticketing::EventTicket::{IEventTicketDispatcher, IEventTicketDispatcherTrait};
use starknet_nft_ticketing::Marketplace::{
    IMarketplaceDispatcher, IMarketplaceDispatcherTrait, IMarketplaceSafeDispatcher,
    IMarketplaceSafeDispatcherTrait,
};
use starknet_nft_ticketing::MockERC20::{IMockERC20Dispatcher, IMockERC20DispatcherTrait};

fn owner() -> ContractAddress {
    contract_address_const::<'owner'>()
}
fn buyer() -> ContractAddress {
    contract_address_const::<'buyer'>()
}
fn seller() -> ContractAddress {
    contract_address_const::<'seller'>()
}
fn treasury() -> ContractAddress {
    contract_address_const::<'treasury'>()
}

/// Full end-to-end: Factory deploys EventTicket -> Mint -> Marketplace list -> Buy
#[test]
fn test_full_lifecycle_factory_mint_marketplace_buy() {
    // 1. Deploy MockERC20 with buyer holding tokens
    let erc20_class = declare("MockERC20").unwrap().contract_class();
    let erc20_calldata = array![buyer().into(), 10000000, 0];
    let (erc20_addr, _) = erc20_class.deploy(@erc20_calldata).unwrap();
    let erc20 = IMockERC20Dispatcher { contract_address: erc20_addr };

    // 2. Deploy Marketplace (5% fee)
    let mkt_class = declare("Marketplace").unwrap().contract_class();
    let mkt_calldata = array![owner().into(), erc20_addr.into(), 500, 0, treasury().into()];
    let (mkt_addr, _) = mkt_class.deploy(@mkt_calldata).unwrap();
    let mkt = IMarketplaceDispatcher { contract_address: mkt_addr };

    // 3. Deploy TicketFactory
    let ticket_class = declare("EventTicket").unwrap().contract_class();
    let factory_class = declare("TicketFactory").unwrap().contract_class();
    let factory_calldata = array![(*ticket_class.class_hash).into(), owner().into()];
    let (factory_addr, _) = factory_class.deploy(@factory_calldata).unwrap();
    let factory = ITicketFactoryDispatcher { contract_address: factory_addr };

    // 4. Create event via Factory
    start_cheat_caller_address(factory_addr, owner());
    let event_addr = factory
        .create_event(
            100_u64, // max_supply
            1000000_u128, // primary_price
            11000_u16, // resale_cap_bps (110%)
            1000_u16, // royalty_bps (10%)
            mkt_addr, // marketplace
            false, // soulbound
            0_u32 // max_transfers (unlimited)
        );
    stop_cheat_caller_address(factory_addr);

    let ticket = IEventTicketDispatcher { contract_address: event_addr };

    // 5. Verify event was created
    assert_eq!(factory.get_event_count(), 1_u256);
    assert_eq!(factory.get_event_contract(0_u256), event_addr);
    assert_eq!(ticket.get_max_supply(), 100_u64);
    assert_eq!(ticket.get_total_supply(), 0_u64);

    // 6. Mint ticket to seller (organizer = owner since Factory uses caller as organizer)
    start_cheat_caller_address(event_addr, owner());
    ticket.mint(seller(), 1_u256);
    stop_cheat_caller_address(event_addr);

    assert_eq!(ticket.owner_of(1_u256), seller());
    assert_eq!(ticket.get_total_supply(), 1_u64);

    // 7. Seller lists ticket on Marketplace at price 1,000,000
    start_cheat_caller_address(mkt_addr, seller());
    let listing_id = mkt.create_listing(event_addr, 1_u256, 1000000_u256);
    stop_cheat_caller_address(mkt_addr);

    assert_eq!(mkt.is_listing_active(listing_id), true);
    assert_eq!(mkt.get_listing_count(), 1_u256);

    // 8. Buyer buys the listing
    start_cheat_caller_address(mkt_addr, buyer());
    mkt.buy_listing(listing_id);
    stop_cheat_caller_address(mkt_addr);

    // 9. Verify final state
    // Ticket ownership transferred
    assert_eq!(ticket.owner_of(1_u256), buyer());
    // Listing deactivated
    assert_eq!(mkt.is_listing_active(listing_id), false);
    // Payment distribution:
    // royalty = 1,000,000 * 10% = 100,000 -> owner (organizer)
    // platform_fee = 1,000,000 * 5% = 50,000 -> treasury
    // seller_amount = 1,000,000 - 100,000 - 50,000 = 850,000 -> seller
    assert_eq!(erc20.balance_of(owner()), 100000_u256);
    assert_eq!(erc20.balance_of(treasury()), 50000_u256);
    assert_eq!(erc20.balance_of(seller()), 850000_u256);
    assert_eq!(erc20.balance_of(buyer()), 10000000_u256 - 1000000_u256);
}

/// Factory deploys -> batch mint -> verify supply
#[test]
fn test_factory_batch_mint_integration() {
    let ticket_class = declare("EventTicket").unwrap().contract_class();
    let factory_class = declare("TicketFactory").unwrap().contract_class();
    let factory_calldata = array![(*ticket_class.class_hash).into(), owner().into()];
    let (factory_addr, _) = factory_class.deploy(@factory_calldata).unwrap();
    let factory = ITicketFactoryDispatcher { contract_address: factory_addr };

    let mkt_addr = contract_address_const::<'marketplace'>();

    start_cheat_caller_address(factory_addr, owner());
    let event_addr = factory
        .create_event(1000_u64, 500000_u128, 11000_u16, 500_u16, mkt_addr, false, 0_u32);
    stop_cheat_caller_address(factory_addr);

    let ticket = IEventTicketDispatcher { contract_address: event_addr };

    // Batch mint 5 tickets
    start_cheat_caller_address(event_addr, owner());
    ticket
        .batch_mint(
            array![buyer(), seller(), buyer(), seller(), buyer()].span(),
            array![1_u256, 2_u256, 3_u256, 4_u256, 5_u256].span(),
        );
    stop_cheat_caller_address(event_addr);

    assert_eq!(ticket.get_total_supply(), 5_u64);
    assert_eq!(ticket.owner_of(1_u256), buyer());
    assert_eq!(ticket.owner_of(2_u256), seller());
    assert_eq!(ticket.owner_of(5_u256), buyer());
}

/// Soulbound ticket: mint works, but marketplace listing fails
#[test]
#[feature("safe_dispatcher")]
fn test_soulbound_ticket_blocks_marketplace() {
    let erc20_class = declare("MockERC20").unwrap().contract_class();
    let (erc20_addr, _) = erc20_class.deploy(@array![buyer().into(), 10000000, 0]).unwrap();

    let mkt_class = declare("Marketplace").unwrap().contract_class();
    let mkt_calldata = array![owner().into(), erc20_addr.into(), 500, 0, treasury().into()];
    let (mkt_addr, _) = mkt_class.deploy(@mkt_calldata).unwrap();

    let ticket_class = declare("EventTicket").unwrap().contract_class();
    let factory_class = declare("TicketFactory").unwrap().contract_class();
    let factory_calldata = array![(*ticket_class.class_hash).into(), owner().into()];
    let (factory_addr, _) = factory_class.deploy(@factory_calldata).unwrap();
    let factory = ITicketFactoryDispatcher { contract_address: factory_addr };

    // Create soulbound event
    start_cheat_caller_address(factory_addr, owner());
    let event_addr = factory
        .create_event(100_u64, 1000000_u128, 11000_u16, 1000_u16, mkt_addr, true, 0_u32);
    stop_cheat_caller_address(factory_addr);

    let ticket = IEventTicketDispatcher { contract_address: event_addr };
    assert_eq!(ticket.is_soulbound(), true);

    // Mint works
    start_cheat_caller_address(event_addr, owner());
    ticket.mint(seller(), 1_u256);
    stop_cheat_caller_address(event_addr);
    assert_eq!(ticket.owner_of(1_u256), seller());

    // Listing fails (soulbound check in Marketplace.create_listing)
    let safe_mkt = IMarketplaceSafeDispatcher { contract_address: mkt_addr };
    start_cheat_caller_address(mkt_addr, seller());
    match safe_mkt.create_listing(event_addr, 1_u256, 500000_u256) {
        Result::Ok(_) => panic!("Should have failed with TICKET_SOULBOUND"),
        Result::Err(err) => assert(*err.at(0) == 'TICKET_SOULBOUND', 'Wrong error code'),
    }
    stop_cheat_caller_address(mkt_addr);
}
