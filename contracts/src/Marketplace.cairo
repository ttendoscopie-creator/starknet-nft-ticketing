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
        sale_price: u128,
    );
    fn owner_of(self: @TContractState, token_id: u256) -> ContractAddress;
    fn is_used(self: @TContractState, token_id: u256) -> bool;
    fn get_royalty(self: @TContractState, sale_price: u128) -> (ContractAddress, u128);
    fn is_soulbound(self: @TContractState) -> bool;
}

#[starknet::interface]
pub trait IMarketplace<TContractState> {
    fn create_listing(
        ref self: TContractState, ticket_contract: ContractAddress, token_id: u256, price: u256,
    ) -> u256;
    fn cancel_listing(ref self: TContractState, listing_id: u256);
    fn buy_listing(ref self: TContractState, listing_id: u256);
    // Views
    fn get_listing(
        self: @TContractState, listing_id: u256,
    ) -> (ContractAddress, ContractAddress, u256, u256, bool);
    fn get_listing_count(self: @TContractState) -> u256;
    fn get_platform_fee(self: @TContractState) -> u256;
    fn get_payment_token(self: @TContractState) -> ContractAddress;
    fn get_treasury(self: @TContractState) -> ContractAddress;
    fn is_listing_active(self: @TContractState, listing_id: u256) -> bool;
    // Pause
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
    fn is_paused(self: @TContractState) -> bool;
}

#[starknet::contract]
pub mod Marketplace {
    use super::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess, ContractAddress, get_caller_address, IERC20Dispatcher,
        IERC20DispatcherTrait, IEventTicketExternalDispatcher, IEventTicketExternalDispatcherTrait,
    };
    use core::num::traits::Zero;

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
        paused: bool,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ListingCreated: ListingCreated,
        ListingCancelled: ListingCancelled,
        ListingPurchased: ListingPurchased,
        Paused: Paused,
        Unpaused: Unpaused,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ListingCreated {
        #[key]
        pub listing_id: u256,
        pub seller: ContractAddress,
        pub ticket_contract: ContractAddress,
        pub token_id: u256,
        pub price: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ListingCancelled {
        #[key]
        pub listing_id: u256,
        pub seller: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ListingPurchased {
        #[key]
        pub listing_id: u256,
        pub buyer: ContractAddress,
        pub seller: ContractAddress,
        pub ticket_contract: ContractAddress,
        pub token_id: u256,
        pub price: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Paused {}

    #[derive(Drop, starknet::Event)]
    pub struct Unpaused {}

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        payment_token: ContractAddress,
        platform_fee_bps: u256,
        platform_treasury: ContractAddress,
    ) {
        assert(!owner.is_zero(), 'INVALID_OWNER');
        assert(!payment_token.is_zero(), 'INVALID_TOKEN');
        assert(!platform_treasury.is_zero(), 'INVALID_TREASURY');
        assert(platform_fee_bps <= 5000, 'FEE_TOO_HIGH');
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
            assert(!self.paused.read(), 'CONTRACT_PAUSED');
            let seller = get_caller_address();
            let ticket = IEventTicketExternalDispatcher { contract_address: ticket_contract };

            assert(!ticket.is_soulbound(), 'TICKET_SOULBOUND');
            assert(ticket.owner_of(token_id) == seller, 'NOT_OWNER');
            assert(!ticket.is_used(token_id), 'TICKET_USED');
            assert(price > 0, 'PRICE_ZERO');
            let id = self.next_listing_id.read();
            self
                .listings
                .write(id, Listing { seller, ticket_contract, token_id, price, active: true });
            self.next_listing_id.write(id + 1);
            self
                .emit(
                    Event::ListingCreated(
                        ListingCreated { listing_id: id, seller, ticket_contract, token_id, price },
                    ),
                );
            id
        }

        fn cancel_listing(ref self: ContractState, listing_id: u256) {
            assert(!self.paused.read(), 'CONTRACT_PAUSED');
            let l = self.listings.read(listing_id);
            let seller = l.seller;
            assert(get_caller_address() == seller, 'NOT_SELLER');
            assert(l.active, 'NOT_ACTIVE');
            self
                .listings
                .write(
                    listing_id,
                    Listing {
                        seller,
                        ticket_contract: l.ticket_contract,
                        token_id: l.token_id,
                        price: l.price,
                        active: false,
                    },
                );
            self.emit(Event::ListingCancelled(ListingCancelled { listing_id, seller }));
        }

        fn buy_listing(ref self: ContractState, listing_id: u256) {
            assert(!self.paused.read(), 'CONTRACT_PAUSED');
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

            // Convert price to u128 for EventTicket calls
            let price_u128: u128 = price.try_into().expect('PRICE_OVERFLOW');
            let (royalty_recipient, royalty_amount_u128) = ticket.get_royalty(price_u128);
            let royalty_amount: u256 = royalty_amount_u128.into();

            let platform_fee = price * self.platform_fee_bps.read() / 10000;
            let total_deductions = royalty_amount + platform_fee;
            assert(price >= total_deductions, 'FEES_EXCEED_PRICE');
            let seller_amount = price - total_deductions;

            // EFFECTS — deactivate BEFORE any external call (CEI anti-reentrancy)
            self
                .listings
                .write(
                    listing_id, Listing { seller, ticket_contract, token_id, price, active: false },
                );

            // INTERACTIONS — payments first, NFT transfer last
            let erc20 = IERC20Dispatcher { contract_address: self.payment_token.read() };
            assert(
                erc20.transfer_from(buyer, royalty_recipient, royalty_amount),
                'ROYALTY_TRANSFER_FAILED',
            );
            assert(
                erc20.transfer_from(buyer, self.platform_treasury.read(), platform_fee),
                'FEE_TRANSFER_FAILED',
            );
            assert(erc20.transfer_from(buyer, seller, seller_amount), 'SELLER_TRANSFER_FAILED');
            ticket.transfer_ticket(seller, buyer, token_id, price_u128);

            self
                .emit(
                    Event::ListingPurchased(
                        ListingPurchased {
                            listing_id, buyer, seller, ticket_contract, token_id, price,
                        },
                    ),
                );
        }

        // ── View functions ──────────────────────────────────────────

        fn get_listing(
            self: @ContractState, listing_id: u256,
        ) -> (ContractAddress, ContractAddress, u256, u256, bool) {
            let l = self.listings.read(listing_id);
            (l.seller, l.ticket_contract, l.token_id, l.price, l.active)
        }

        fn get_listing_count(self: @ContractState) -> u256 {
            self.next_listing_id.read()
        }

        fn get_platform_fee(self: @ContractState) -> u256 {
            self.platform_fee_bps.read()
        }

        fn get_payment_token(self: @ContractState) -> ContractAddress {
            self.payment_token.read()
        }

        fn get_treasury(self: @ContractState) -> ContractAddress {
            self.platform_treasury.read()
        }

        fn is_listing_active(self: @ContractState, listing_id: u256) -> bool {
            self.listings.read(listing_id).active
        }

        // ── Pause mechanism ─────────────────────────────────────────

        fn pause(ref self: ContractState) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            assert(!self.paused.read(), 'ALREADY_PAUSED');
            self.paused.write(true);
            self.emit(Event::Paused(Paused {}));
        }

        fn unpause(ref self: ContractState) {
            assert(get_caller_address() == self.owner.read(), 'NOT_OWNER');
            assert(self.paused.read(), 'NOT_PAUSED');
            self.paused.write(false);
            self.emit(Event::Unpaused(Unpaused {}));
        }

        fn is_paused(self: @ContractState) -> bool {
            self.paused.read()
        }
    }
}
