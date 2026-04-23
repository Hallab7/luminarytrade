#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec};

// ============================================================================
// Data Types
// ============================================================================

/// On-chain credit score NFT with verifiable score metadata and marketplace support.
#[contracttype]
#[derive(Clone)]
pub struct CreditScoreNFT {
    pub owner: Address,
    pub metadata_cid: String,
    pub token_id: u64,
    pub mint_timestamp: u64,
    pub is_revoked: bool,
    pub revocation_note: String,
    /// Verifiable credit score (0–1000)
    pub credit_score: u32,
    /// Timestamp of the last score update
    pub score_updated_at: u64,
}

/// Active marketplace listing for a token
#[contracttype]
#[derive(Clone)]
pub struct Listing {
    pub token_id: u64,
    pub seller: Address,
    pub price: i128,
    pub listed_at: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Minters(Address),
    TokenId,
    NFT(u64),
    OwnerTokens(Address),
    /// Approved operator for a specific token (for marketplace transfers)
    Approved(u64),
    /// Active listing for a token
    Listing(u64),
    /// All currently listed token IDs
    ListedTokens,
}

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct CreditScoreNFTContract;

#[contractimpl]
impl CreditScoreNFTContract {
    /// Initialize the credit score NFT contract.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenId, &0u64);

        env.events()
            .publish((symbol_short!("init"), symbol_short!("contract")), admin);
    }

    /// Add an authorized minter.
    pub fn add_minter(env: Env, minter: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        env.storage()
            .persistent()
            .set(&DataKey::Minters(minter.clone()), &true);

        env.events()
            .publish((symbol_short!("add"), symbol_short!("minter")), minter);
    }

    /// Remove an authorized minter.
    pub fn remove_minter(env: Env, minter: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        env.storage()
            .persistent()
            .remove(&DataKey::Minters(minter.clone()));

        env.events()
            .publish((symbol_short!("remove"), symbol_short!("minter")), minter);
    }

    /// Check if an address is an authorized minter.
    pub fn is_minter(env: Env, address: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Minters(address))
            .unwrap_or(false)
    }

    /// Mint a new credit score NFT with a verifiable on-chain credit score.
    pub fn mint(env: Env, minter: Address, to: Address, metadata_cid: String, credit_score: u32) -> u64 {
        minter.require_auth();

        if credit_score > 1000 {
            panic!("Credit score must be between 0 and 1000");
        }

        let is_authorized = Self::is_minter(env.clone(), minter.clone());
        if !is_authorized {
            let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
            if minter != admin {
                panic!("Unauthorized: caller is not an authorized minter");
            }
        }

        let mut token_id: u64 = env.storage().instance().get(&DataKey::TokenId).unwrap_or(0);
        token_id += 1;
        env.storage().instance().set(&DataKey::TokenId, &token_id);

        let now = env.ledger().timestamp();
        let nft = CreditScoreNFT {
            owner: to.clone(),
            metadata_cid: metadata_cid.clone(),
            token_id,
            mint_timestamp: now,
            is_revoked: false,
            revocation_note: String::from_str(&env, ""),
            credit_score,
            score_updated_at: now,
        };

        env.storage().persistent().set(&DataKey::NFT(token_id), &nft);

        let mut owner_tokens: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::OwnerTokens(to.clone()))
            .unwrap_or(Vec::new(&env));
        owner_tokens.push_back(token_id);
        env.storage().persistent().set(&DataKey::OwnerTokens(to.clone()), &owner_tokens);

        env.events().publish(
            (symbol_short!("mint"), symbol_short!("nft")),
            (to, token_id, metadata_cid, credit_score),
        );

        token_id
    }

    /// Update the credit score of an existing NFT (minter or admin only).
    pub fn update_credit_score(env: Env, minter: Address, token_id: u64, new_score: u32) {
        minter.require_auth();

        if new_score > 1000 {
            panic!("Credit score must be between 0 and 1000");
        }

        let is_authorized = Self::is_minter(env.clone(), minter.clone());
        if !is_authorized {
            let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
            if minter != admin {
                panic!("Unauthorized: caller is not an authorized minter");
            }
        }

        let mut nft: CreditScoreNFT = env
            .storage()
            .persistent()
            .get(&DataKey::NFT(token_id))
            .expect("NFT not found");

        if nft.is_revoked {
            panic!("Cannot update score of a revoked NFT");
        }

        nft.credit_score = new_score;
        nft.score_updated_at = env.ledger().timestamp();
        env.storage().persistent().set(&DataKey::NFT(token_id), &nft);

        env.events().publish(
            (symbol_short!("score_upd"), symbol_short!("nft")),
            (token_id, new_score),
        );
    }

    /// Approve an operator to transfer a specific token on behalf of the owner.
    ///
    /// Used by marketplace contracts to facilitate trustless trades.
    pub fn approve(env: Env, owner: Address, operator: Address, token_id: u64) {
        owner.require_auth();

        let nft: CreditScoreNFT = env
            .storage()
            .persistent()
            .get(&DataKey::NFT(token_id))
            .expect("NFT not found");

        if nft.owner != owner {
            panic!("Only the token owner can approve an operator");
        }

        if nft.is_revoked {
            panic!("Cannot approve transfer of a revoked NFT");
        }

        env.storage().persistent().set(&DataKey::Approved(token_id), &operator);

        env.events().publish(
            (symbol_short!("approve"), symbol_short!("nft")),
            (owner, operator, token_id),
        );
    }

    /// Revoke a previously set approval.
    pub fn revoke_approval(env: Env, owner: Address, token_id: u64) {
        owner.require_auth();

        let nft: CreditScoreNFT = env
            .storage()
            .persistent()
            .get(&DataKey::NFT(token_id))
            .expect("NFT not found");

        if nft.owner != owner {
            panic!("Only the token owner can revoke approval");
        }

        env.storage().persistent().remove(&DataKey::Approved(token_id));

        env.events().publish(
            (symbol_short!("revk_appr"), symbol_short!("nft")),
            (owner, token_id),
        );
    }

    /// Get the approved operator for a token, if any.
    pub fn get_approved(env: Env, token_id: u64) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Approved(token_id))
    }

    /// Transfer a token to a new owner.
    ///
    /// Caller must be either the current owner or an approved operator.
    pub fn transfer(env: Env, from: Address, to: Address, token_id: u64) {
        let mut nft: CreditScoreNFT = env
            .storage()
            .persistent()
            .get(&DataKey::NFT(token_id))
            .expect("NFT not found");

        if nft.is_revoked {
            panic!("Cannot transfer a revoked NFT");
        }

        // Caller must be owner or approved operator
        let approved: Option<Address> = env.storage().persistent().get(&DataKey::Approved(token_id));
        let caller_is_owner = nft.owner == from;
        let caller_is_approved = approved.as_ref().map_or(false, |a| *a == from);

        if !caller_is_owner && !caller_is_approved {
            panic!("Transfer not authorized: caller is not owner or approved operator");
        }

        from.require_auth();

        // Remove token from previous owner's list
        let mut from_tokens: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::OwnerTokens(nft.owner.clone()))
            .unwrap_or(Vec::new(&env));
        let mut updated_from_tokens: Vec<u64> = Vec::new(&env);
        for t in from_tokens.iter() {
            if t != token_id {
                updated_from_tokens.push_back(t);
            }
        }
        env.storage().persistent().set(&DataKey::OwnerTokens(nft.owner.clone()), &updated_from_tokens);

        // Add token to new owner's list
        let mut to_tokens: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::OwnerTokens(to.clone()))
            .unwrap_or(Vec::new(&env));
        to_tokens.push_back(token_id);
        env.storage().persistent().set(&DataKey::OwnerTokens(to.clone()), &to_tokens);

        // Clear approval on transfer
        env.storage().persistent().remove(&DataKey::Approved(token_id));

        // Clear any active listing
        if env.storage().persistent().has(&DataKey::Listing(token_id)) {
            env.storage().persistent().remove(&DataKey::Listing(token_id));
            Self::remove_from_listed_tokens(&env, token_id);
        }

        nft.owner = to.clone();
        env.storage().persistent().set(&DataKey::NFT(token_id), &nft);

        env.events().publish(
            (symbol_short!("transfer"), symbol_short!("nft")),
            (from, to, token_id),
        );
    }

    /// List a token for sale at a given price.
    pub fn list_for_sale(env: Env, seller: Address, token_id: u64, price: i128) {
        seller.require_auth();

        if price <= 0 {
            panic!("Price must be greater than zero");
        }

        let nft: CreditScoreNFT = env
            .storage()
            .persistent()
            .get(&DataKey::NFT(token_id))
            .expect("NFT not found");

        if nft.owner != seller {
            panic!("Only the owner can list a token for sale");
        }

        if nft.is_revoked {
            panic!("Cannot list a revoked NFT for sale");
        }

        let listing = Listing {
            token_id,
            seller: seller.clone(),
            price,
            listed_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&DataKey::Listing(token_id), &listing);

        let mut listed: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ListedTokens)
            .unwrap_or(Vec::new(&env));
        // Avoid duplicates
        let mut already_listed = false;
        for t in listed.iter() {
            if t == token_id {
                already_listed = true;
                break;
            }
        }
        if !already_listed {
            listed.push_back(token_id);
            env.storage().instance().set(&DataKey::ListedTokens, &listed);
        }

        env.events().publish(
            (symbol_short!("list"), symbol_short!("nft")),
            (seller, token_id, price),
        );
    }

    /// Delist a token (cancel the sale listing).
    pub fn delist(env: Env, seller: Address, token_id: u64) {
        seller.require_auth();

        let listing: Listing = env
            .storage()
            .persistent()
            .get(&DataKey::Listing(token_id))
            .expect("Token is not listed");

        if listing.seller != seller {
            panic!("Only the seller can delist");
        }

        env.storage().persistent().remove(&DataKey::Listing(token_id));
        Self::remove_from_listed_tokens(&env, token_id);

        env.events().publish(
            (symbol_short!("delist"), symbol_short!("nft")),
            (seller, token_id),
        );
    }

    /// Buy a listed token. The buyer transfers ownership; price settlement
    /// is handled off-chain or by the calling contract.
    ///
    /// Emits a `buy` event so off-chain indexers can track the trade.
    pub fn buy(env: Env, buyer: Address, token_id: u64) {
        buyer.require_auth();

        let listing: Listing = env
            .storage()
            .persistent()
            .get(&DataKey::Listing(token_id))
            .expect("Token is not listed for sale");

        if buyer == listing.seller {
            panic!("Seller cannot buy their own listing");
        }

        // Remove listing before transfer to prevent re-entrancy issues
        env.storage().persistent().remove(&DataKey::Listing(token_id));
        Self::remove_from_listed_tokens(&env, token_id);

        // Perform ownership transfer (from seller to buyer)
        let mut nft: CreditScoreNFT = env
            .storage()
            .persistent()
            .get(&DataKey::NFT(token_id))
            .unwrap();

        // Update seller's token list
        let mut seller_tokens: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::OwnerTokens(listing.seller.clone()))
            .unwrap_or(Vec::new(&env));
        let mut updated_seller_tokens: Vec<u64> = Vec::new(&env);
        for t in seller_tokens.iter() {
            if t != token_id {
                updated_seller_tokens.push_back(t);
            }
        }
        env.storage().persistent().set(
            &DataKey::OwnerTokens(listing.seller.clone()),
            &updated_seller_tokens,
        );

        // Add to buyer's token list
        let mut buyer_tokens: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::OwnerTokens(buyer.clone()))
            .unwrap_or(Vec::new(&env));
        buyer_tokens.push_back(token_id);
        env.storage().persistent().set(&DataKey::OwnerTokens(buyer.clone()), &buyer_tokens);

        // Clear approval
        env.storage().persistent().remove(&DataKey::Approved(token_id));

        nft.owner = buyer.clone();
        env.storage().persistent().set(&DataKey::NFT(token_id), &nft);

        env.events().publish(
            (symbol_short!("buy"), symbol_short!("nft")),
            (buyer, listing.seller, token_id, listing.price),
        );
    }

    // ========================================================================
    // Admin Operations
    // ========================================================================

    /// Revoke an NFT (admin only).
    pub fn revoke(env: Env, admin: Address, token_id: u64, note: String) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("Unauthorized: only admin can revoke");
        }

        let mut nft: CreditScoreNFT = env
            .storage()
            .persistent()
            .get(&DataKey::NFT(token_id))
            .expect("NFT not found");

        // Remove any active listing when revoking
        if env.storage().persistent().has(&DataKey::Listing(token_id)) {
            env.storage().persistent().remove(&DataKey::Listing(token_id));
            Self::remove_from_listed_tokens(&env, token_id);
        }

        nft.is_revoked = true;
        nft.revocation_note = note.clone();
        env.storage().persistent().set(&DataKey::NFT(token_id), &nft);

        env.events().publish(
            (symbol_short!("revoke"), symbol_short!("nft")),
            (token_id, note),
        );
    }

    // ========================================================================
    // View Functions
    // ========================================================================

    pub fn get_nft(env: Env, token_id: u64) -> CreditScoreNFT {
        env.storage()
            .persistent()
            .get(&DataKey::NFT(token_id))
            .expect("NFT not found")
    }

    pub fn get_metadata_cid(env: Env, token_id: u64) -> String {
        let nft: CreditScoreNFT = Self::get_nft(env, token_id);
        nft.metadata_cid
    }

    pub fn get_owner(env: Env, token_id: u64) -> Address {
        let nft: CreditScoreNFT = Self::get_nft(env, token_id);
        nft.owner
    }

    pub fn get_credit_score(env: Env, token_id: u64) -> u32 {
        let nft: CreditScoreNFT = Self::get_nft(env, token_id);
        nft.credit_score
    }

    pub fn get_tokens_by_owner(env: Env, owner: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::OwnerTokens(owner))
            .unwrap_or(Vec::new(&env))
    }

    pub fn total_supply(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::TokenId).unwrap_or(0)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn get_listing(env: Env, token_id: u64) -> Option<Listing> {
        env.storage().persistent().get(&DataKey::Listing(token_id))
    }

    pub fn get_listed_tokens(env: Env) -> Vec<u64> {
        env.storage()
            .instance()
            .get(&DataKey::ListedTokens)
            .unwrap_or(Vec::new(&env))
    }

    // ========================================================================
    // Internal
    // ========================================================================

    fn remove_from_listed_tokens(env: &Env, token_id: u64) {
        let listed: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ListedTokens)
            .unwrap_or(Vec::new(env));
        let mut updated: Vec<u64> = Vec::new(env);
        for t in listed.iter() {
            if t != token_id {
                updated.push_back(t);
            }
        }
        env.storage().instance().set(&DataKey::ListedTokens, &updated);
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

    fn setup() -> (Env, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, CreditScoreNFTContract);
        let client = CreditScoreNFTContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let minter = Address::generate(&env);
        client.initialize(&admin);
        client.add_minter(&minter);
        (env, contract_id, admin, minter)
    }

    #[test]
    fn test_initialize() {
        let (env, contract_id, admin, _) = setup();
        let client = CreditScoreNFTContractClient::new(&env, &contract_id);
        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.total_supply(), 0);
    }

    #[test]
    fn test_add_and_remove_minter() {
        let (env, contract_id, admin, minter) = setup();
        let client = CreditScoreNFTContractClient::new(&env, &contract_id);
        assert!(client.is_minter(&minter));
        client.remove_minter(&minter);
        assert!(!client.is_minter(&minter));
    }

    #[test]
    fn test_mint_nft_with_credit_score() {
        let (env, contract_id, _, minter) = setup();
        let client = CreditScoreNFTContractClient::new(&env, &contract_id);
        let recipient = Address::generate(&env);

        let metadata = String::from_str(&env, "QmXYZ123...");
        let token_id = client.mint(&minter, &recipient, &metadata, &750);

        assert_eq!(token_id, 1);
        assert_eq!(client.get_owner(&token_id), recipient);
        assert_eq!(client.get_credit_score(&token_id), 750);
        assert_eq!(client.get_metadata_cid(&token_id), metadata);
        assert_eq!(client.total_supply(), 1);

        let nft = client.get_nft(&token_id);
        assert!(!nft.is_revoked);
        assert_eq!(nft.credit_score, 750);
    }

    #[test]
    fn test_admin_can_mint() {
        let (env, contract_id, admin, _) = setup();
        let client = CreditScoreNFTContractClient::new(&env, &contract_id);
        let recipient = Address::generate(&env);

        let metadata = String::from_str(&env, "QmABC456...");
        let token_id = client.mint(&admin, &recipient, &metadata, &600);
        assert_eq!(token_id, 1);
    }

    #[test]
    #[should_panic(expected = "Unauthorized: caller is not an authorized minter")]
    fn test_mint_unauthorized() {
        let (env, contract_id, _, _) = setup();
        let client = CreditScoreNFTContractClient::new(&env, &contract_id);
        let unauthorized = Address::generate(&env);
        let recipient = Address::generate(&env);
        let metadata = String::from_str(&env, "QmXYZ123...");
        client.mint(&unauthorized, &recipient, &metadata, &500);
    }

    #[test]
    fn test_update_credit_score() {
        let (env, contract_id, _, minter) = setup();
        let client = CreditScoreNFTContractClient::new(&env, &contract_id);
        let recipient = Address::generate(&env);

        let metadata = String::from_str(&env, "QmScore...");
        let token_id = client.mint(&minter, &recipient, &metadata, &600);
        assert_eq!(client.get_credit_score(&token_id), 600);

        client.update_credit_score(&minter, &token_id, &750);
        assert_eq!(client.get_credit_score(&token_id), 750);
    }

    #[test]
    fn test_transfer_with_approval() {
        let (env, contract_id, _, minter) = setup();
        let client = CreditScoreNFTContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let operator = Address::generate(&env);
        let recipient = Address::generate(&env);

        let metadata = String::from_str(&env, "QmXYZ...");
        let token_id = client.mint(&minter, &owner, &metadata, &700);

        // Owner approves operator
        client.approve(&owner, &operator, &token_id);
        assert_eq!(client.get_approved(&token_id).unwrap(), operator);

        // Operator transfers token to recipient
        client.transfer(&operator, &recipient, &token_id);
        assert_eq!(client.get_owner(&token_id), recipient);

        // Approval cleared after transfer
        assert!(client.get_approved(&token_id).is_none());

        // Owner's token list updated
        let owner_tokens = client.get_tokens_by_owner(&owner);
        assert_eq!(owner_tokens.len(), 0);
        let recipient_tokens = client.get_tokens_by_owner(&recipient);
        assert_eq!(recipient_tokens.len(), 1);
    }

    #[test]
    fn test_owner_can_transfer_directly() {
        let (env, contract_id, _, minter) = setup();
        let client = CreditScoreNFTContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let recipient = Address::generate(&env);

        let metadata = String::from_str(&env, "QmOwner...");
        let token_id = client.mint(&minter, &owner, &metadata, &800);

        client.transfer(&owner, &recipient, &token_id);
        assert_eq!(client.get_owner(&token_id), recipient);
    }

    #[test]
    fn test_marketplace_list_and_buy() {
        let (env, contract_id, _, minter) = setup();
        let client = CreditScoreNFTContractClient::new(&env, &contract_id);

        let seller = Address::generate(&env);
        let buyer = Address::generate(&env);

        let metadata = String::from_str(&env, "QmMarket...");
        let token_id = client.mint(&minter, &seller, &metadata, &900);

        // Seller lists the token
        client.list_for_sale(&seller, &token_id, &5_000_000);
        let listing = client.get_listing(&token_id).unwrap();
        assert_eq!(listing.price, 5_000_000);
        assert_eq!(client.get_listed_tokens().len(), 1);

        // Buyer purchases
        client.buy(&buyer, &token_id);
        assert_eq!(client.get_owner(&token_id), buyer);
        assert!(client.get_listing(&token_id).is_none());
        assert_eq!(client.get_listed_tokens().len(), 0);
    }

    #[test]
    fn test_delist() {
        let (env, contract_id, _, minter) = setup();
        let client = CreditScoreNFTContractClient::new(&env, &contract_id);

        let seller = Address::generate(&env);
        let metadata = String::from_str(&env, "QmDelist...");
        let token_id = client.mint(&minter, &seller, &metadata, &500);

        client.list_for_sale(&seller, &token_id, &1_000_000);
        assert!(client.get_listing(&token_id).is_some());

        client.delist(&seller, &token_id);
        assert!(client.get_listing(&token_id).is_none());
        assert_eq!(client.get_listed_tokens().len(), 0);
    }

    #[test]
    fn test_revoke_nft() {
        let (env, contract_id, admin, minter) = setup();
        let client = CreditScoreNFTContractClient::new(&env, &contract_id);

        let recipient = Address::generate(&env);
        let metadata = String::from_str(&env, "QmRevoke...");
        let token_id = client.mint(&minter, &recipient, &metadata, &400);

        let note = String::from_str(&env, "Fraud detected");
        client.revoke(&admin, &token_id, &note);

        let nft = client.get_nft(&token_id);
        assert!(nft.is_revoked);
        assert_eq!(nft.revocation_note, note);
    }

    #[test]
    fn test_multiple_mints() {
        let (env, contract_id, _, minter) = setup();
        let client = CreditScoreNFTContractClient::new(&env, &contract_id);
        let recipient = Address::generate(&env);

        let metadata1 = String::from_str(&env, "QmFirst...");
        let token_id1 = client.mint(&minter, &recipient, &metadata1, &600);

        let metadata2 = String::from_str(&env, "QmSecond...");
        let token_id2 = client.mint(&minter, &recipient, &metadata2, &700);

        assert_eq!(token_id1, 1);
        assert_eq!(token_id2, 2);
        assert_eq!(client.total_supply(), 2);

        let tokens = client.get_tokens_by_owner(&recipient);
        assert_eq!(tokens.len(), 2);
    }
}
