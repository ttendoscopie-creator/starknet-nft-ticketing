use starknet::storage::{
    Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
    StoragePointerWriteAccess,
};
use starknet::{ContractAddress, get_caller_address};

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

#[starknet::interface]
pub trait IEventTicketExternal<TContractState> {
    fn transfer_ticket(
        ref self: TContractState,
        from: ContractAddress,
        to: ContractAddress,
        token_id: u256,
        sale_price: u256,
    );
    fn owner_of(self: @TContractState, token_id: u256) -> ContractAddress;
    fn is_used(self: @TContractState, token_id: u256) -> bool;
    fn get_royalty(self: @TContractState, sale_price: u256) -> (ContractAddress, u256);
}

#[starknet::interface]
pub trait IMarketplace<TContractState> {
    fn create_listing(
        ref self: TContractState, ticket_contract: ContractAddress, token_id: u256, price: u256,
    ) -> u256;
    fn cancel_listing(ref self: TContractState, listing_id: u256);
    fn buy_listing(ref self: TContractState, listing_id: u256);
}

#[starknet::contract]
pub mod Marketplace {
    use super::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess, ContractAddress, get_caller_address, IERC20Dispatcher,
        IERC20DispatcherTrait, IEventTicketExternalDispatcher, IEventTicketExternalDispatcherTrait,
    };

    #[derive(Drop, Serde, starknet::Store)]
    struct Listing {
        seller: ContractAddress,
        ticket_contract: ContractAddress,
        token_id: u256,
        price: u256,
        active: bool,
    }

    #[storage]
    struct Storage {
        listings: Map<u256, Listing>,
        next_listing_id: u256,
        payment_token: ContractAddress,
        platform_fee_bps: u256,
        platform_treasury: ContractAddress,
        owner: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        payment_token: ContractAddress,
        platform_fee_bps: u256,
        platform_treasury: ContractAddress,
    ) {
        self.owner.write(owner);
        self.payment_token.write(payment_token);
        self.platform_fee_bps.write(platform_fee_bps);
        self.platform_treasury.write(platform_treasury);
    }

    #[abi(embed_v0)]
    impl MarketplaceImpl of super::IMarketplace<ContractState> {
        fn create_listing(
            ref self: ContractState, ticket_contract: ContractAddress, token_id: u256, price: u256,
        ) -> u256 {
            let seller = get_caller_address();
            let ticket = IEventTicketExternalDispatcher { contract_address: ticket_contract };
            assert(ticket.owner_of(token_id) == seller, 'NOT_OWNER');
            assert(!ticket.is_used(token_id), 'TICKET_USED');
            assert(price > 0, 'PRICE_ZERO');
            let id = self.next_listing_id.read();
            self
                .listings
                .write(id, Listing { seller, ticket_contract, token_id, price, active: true });
            self.next_listing_id.write(id + 1);
            id
        }

        fn cancel_listing(ref self: ContractState, listing_id: u256) {
            let l = self.listings.read(listing_id);
            assert(get_caller_address() == l.seller, 'NOT_SELLER');
            assert(l.active, 'NOT_ACTIVE');
            self
                .listings
                .write(
                    listing_id,
                    Listing {
                        seller: l.seller,
                        ticket_contract: l.ticket_contract,
                        token_id: l.token_id,
                        price: l.price,
                        active: false,
                    },
                );
        }

        fn buy_listing(ref self: ContractState, listing_id: u256) {
            let buyer = get_caller_address();
            let l = self.listings.read(listing_id);

            // CHECKS
            assert(l.active, 'NOT_ACTIVE');
            let ticket_contract = l.ticket_contract;
            let token_id = l.token_id;
            let price = l.price;
            let seller = l.seller;

            let ticket = IEventTicketExternalDispatcher { contract_address: ticket_contract };
            assert(ticket.owner_of(token_id) == seller, 'NOT_OWNER');
            assert(!ticket.is_used(token_id), 'TICKET_USED');
            let (royalty_recipient, royalty_amount) = ticket.get_royalty(price);
            let platform_fee = price * self.platform_fee_bps.read() / 10000;
            let seller_amount = price - royalty_amount - platform_fee;

            // EFFECTS — deactivate BEFORE any external call (CEI anti-reentrancy)
            self
                .listings
                .write(
                    listing_id, Listing { seller, ticket_contract, token_id, price, active: false },
                );

            // INTERACTIONS — payments first, NFT transfer last
            let erc20 = IERC20Dispatcher { contract_address: self.payment_token.read() };
            erc20.transfer_from(buyer, royalty_recipient, royalty_amount);
            erc20.transfer_from(buyer, self.platform_treasury.read(), platform_fee);
            erc20.transfer_from(buyer, seller, seller_amount);
            ticket.transfer_ticket(seller, buyer, token_id, price);
        }
    }
}
