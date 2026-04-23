//! # Token Launch Waitlist Contract
//!
//! Priority-queue waitlist for participating in new token staking launches.
//!
//! ## Features
//!
//! - **Token Launch Registration**: Admin registers upcoming token launches
//! - **Waitlist Joining**: Users join via contract; position stored on-chain
//! - **Priority Access**: FIFO queue; positions granted access at launch time
//! - **Access Control**: Admin grants access to queued users when the token launches
//! - **Off-chain Notifications**: Launch and access events emitted for indexers
//!
//! ## Flow
//!
//! 1. Admin creates a token launch entry
//! 2. Users join the waitlist for that launch
//! 3. Admin launches the token and grants access to the queue (FIFO)
//! 4. Events are emitted for each access grant (off-chain notification hooks)

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, String, Vec,
};
use common_utils::error::CommonError;

// ============================================================================
// Storage Keys
// ============================================================================

#[contracttype]
pub enum DataKey {
    Admin,
    Initialized,

    // Token launch registry
    LaunchCount,
    Launch(u64),              // launch_id → LaunchInfo

    // Per-launch waitlists (FIFO queue stored as Vec)
    Waitlist(u64),            // launch_id → Vec<Address>
    UserPosition(u64, Address), // (launch_id, user) → queue position (1-based)

    // Access granted set
    AccessGranted(u64, Address), // (launch_id, user) → bool

    // Global stats
    TotalRegistrations,
}

// ============================================================================
// Data Types
// ============================================================================

/// Status of a token launch
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum LaunchStatus {
    /// Waitlist open
    Open = 0,
    /// Launch in progress — access being granted
    Launching = 1,
    /// Fully launched
    Launched = 2,
    /// Cancelled
    Cancelled = 3,
}

/// Information about a token launch
#[derive(Clone)]
#[contracttype]
pub struct LaunchInfo {
    pub launch_id: u64,
    pub token_symbol: String,
    pub description: String,
    pub status: LaunchStatus,
    pub created_at: u64,
    pub launched_at: u64,
    /// Maximum waitlist size (0 = unlimited)
    pub max_waitlist: u32,
    /// Number of users granted access so far
    pub access_granted_count: u32,
    /// Total users on the waitlist
    pub waitlist_size: u32,
}

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct TokenLaunchWaitlistContract;

#[contractimpl]
impl TokenLaunchWaitlistContract {
    /// Initialize the contract.
    pub fn initialize(env: Env, admin: Address) -> Result<(), CommonError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(CommonError::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::LaunchCount, &0u64);
        env.storage().instance().set(&DataKey::TotalRegistrations, &0u64);
        env.storage().instance().set(&DataKey::Initialized, &true);

        env.events().publish(
            (symbol_short!("tlw_init"), admin),
            symbol_short!("ok"),
        );

        Ok(())
    }

    /// Admin registers a new token launch and opens its waitlist.
    pub fn create_launch(
        env: Env,
        admin: Address,
        token_symbol: String,
        description: String,
        max_waitlist: u32,
    ) -> Result<u64, CommonError> {
        Self::require_admin(&env, &admin)?;

        let launch_id: u64 = env.storage().instance().get(&DataKey::LaunchCount).unwrap_or(0);

        let info = LaunchInfo {
            launch_id,
            token_symbol: token_symbol.clone(),
            description,
            status: LaunchStatus::Open,
            created_at: env.ledger().timestamp(),
            launched_at: 0,
            max_waitlist,
            access_granted_count: 0,
            waitlist_size: 0,
        };

        env.storage().persistent().set(&DataKey::Launch(launch_id), &info);
        env.storage().instance().set(&DataKey::LaunchCount, &(launch_id + 1));

        env.events().publish(
            (symbol_short!("tlw_new"), admin),
            (launch_id, token_symbol),
        );

        Ok(launch_id)
    }

    /// Join the waitlist for a token launch.
    ///
    /// Users are added to a FIFO queue. Their position is stored on-chain.
    pub fn join_waitlist(env: Env, user: Address, launch_id: u64) -> Result<u32, CommonError> {
        user.require_auth();

        let mut info: LaunchInfo = env.storage().persistent()
            .get(&DataKey::Launch(launch_id))
            .ok_or(CommonError::KeyNotFound)?;

        if info.status != LaunchStatus::Open {
            return Err(CommonError::NotAuthorized);
        }

        // Prevent duplicate join
        if env.storage().persistent().has(&DataKey::UserPosition(launch_id, user.clone())) {
            return Err(CommonError::AlreadyInitialized);
        }

        // Enforce max waitlist cap
        if info.max_waitlist > 0 && info.waitlist_size >= info.max_waitlist {
            return Err(CommonError::OutOfRange);
        }

        // Append to FIFO queue; position is 1-based
        let position = info.waitlist_size + 1;
        let mut queue: Vec<Address> = env.storage().persistent()
            .get(&DataKey::Waitlist(launch_id))
            .unwrap_or_else(|| Vec::new(&env));
        queue.push_back(user.clone());
        env.storage().persistent().set(&DataKey::Waitlist(launch_id), &queue);

        env.storage().persistent().set(
            &DataKey::UserPosition(launch_id, user.clone()),
            &position,
        );

        info.waitlist_size = position;
        env.storage().persistent().set(&DataKey::Launch(launch_id), &info);

        let total: u64 = env.storage().instance().get(&DataKey::TotalRegistrations).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalRegistrations, &(total + 1));

        env.events().publish(
            (symbol_short!("tlw_join"), user),
            (launch_id, position),
        );

        Ok(position)
    }

    /// Admin grants access to the next `count` users in the FIFO queue.
    ///
    /// Emits a `tlw_access` event per user for off-chain notification hooks.
    pub fn grant_access(
        env: Env,
        admin: Address,
        launch_id: u64,
        count: u32,
    ) -> Result<u32, CommonError> {
        Self::require_admin(&env, &admin)?;

        let mut info: LaunchInfo = env.storage().persistent()
            .get(&DataKey::Launch(launch_id))
            .ok_or(CommonError::KeyNotFound)?;

        if info.status == LaunchStatus::Cancelled || info.status == LaunchStatus::Launched {
            return Err(CommonError::NotAuthorized);
        }

        // Transition to Launching if still Open
        if info.status == LaunchStatus::Open {
            info.status = LaunchStatus::Launching;
        }

        let queue: Vec<Address> = env.storage().persistent()
            .get(&DataKey::Waitlist(launch_id))
            .unwrap_or_else(|| Vec::new(&env));

        let start = info.access_granted_count as usize;
        let granted_before = info.access_granted_count;
        let queue_len = queue.len() as u32;

        let mut granted = 0u32;
        let mut idx = start;
        while granted < count && (granted_before + granted) < queue_len {
            let user = queue.get(idx as u32).unwrap();
            env.storage().persistent().set(
                &DataKey::AccessGranted(launch_id, user.clone()),
                &true,
            );
            env.events().publish(
                (symbol_short!("tlw_access"), user),
                (launch_id, granted_before + granted + 1),
            );
            granted += 1;
            idx += 1;
        }

        info.access_granted_count += granted;
        env.storage().persistent().set(&DataKey::Launch(launch_id), &info);

        Ok(granted)
    }

    /// Admin marks a launch as fully launched.
    pub fn finalize_launch(env: Env, admin: Address, launch_id: u64) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;

        let mut info: LaunchInfo = env.storage().persistent()
            .get(&DataKey::Launch(launch_id))
            .ok_or(CommonError::KeyNotFound)?;

        if info.status == LaunchStatus::Cancelled || info.status == LaunchStatus::Launched {
            return Err(CommonError::NotAuthorized);
        }

        info.status = LaunchStatus::Launched;
        info.launched_at = env.ledger().timestamp();
        env.storage().persistent().set(&DataKey::Launch(launch_id), &info);

        env.events().publish(
            (symbol_short!("tlw_done"), admin),
            (launch_id, info.launched_at),
        );

        Ok(())
    }

    /// Admin cancels a launch.
    pub fn cancel_launch(env: Env, admin: Address, launch_id: u64) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;

        let mut info: LaunchInfo = env.storage().persistent()
            .get(&DataKey::Launch(launch_id))
            .ok_or(CommonError::KeyNotFound)?;

        if info.status == LaunchStatus::Launched {
            return Err(CommonError::NotAuthorized);
        }

        info.status = LaunchStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Launch(launch_id), &info);

        env.events().publish(
            (symbol_short!("tlw_cxl"), admin),
            launch_id,
        );

        Ok(())
    }

    // ========================================================================
    // View Functions
    // ========================================================================

    pub fn get_launch(env: Env, launch_id: u64) -> Option<LaunchInfo> {
        env.storage().persistent().get(&DataKey::Launch(launch_id))
    }

    pub fn get_waitlist(env: Env, launch_id: u64) -> Vec<Address> {
        env.storage().persistent()
            .get(&DataKey::Waitlist(launch_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_position(env: Env, launch_id: u64, user: Address) -> Option<u32> {
        env.storage().persistent().get(&DataKey::UserPosition(launch_id, user))
    }

    pub fn has_access(env: Env, launch_id: u64, user: Address) -> bool {
        env.storage().persistent()
            .get(&DataKey::AccessGranted(launch_id, user))
            .unwrap_or(false)
    }

    pub fn get_launch_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::LaunchCount).unwrap_or(0)
    }

    pub fn get_total_registrations(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::TotalRegistrations).unwrap_or(0)
    }

    // ========================================================================
    // Internal
    // ========================================================================

    fn require_admin(env: &Env, caller: &Address) -> Result<(), CommonError> {
        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .ok_or(CommonError::NotInitialized)?;

        if admin != *caller {
            return Err(CommonError::NotAuthorized);
        }

        caller.require_auth();
        Ok(())
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, TokenLaunchWaitlistContract);
        let client = TokenLaunchWaitlistContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin).unwrap();
        (env, contract_id, admin)
    }

    #[test]
    fn test_initialize() {
        let (env, contract_id, _) = setup();
        let client = TokenLaunchWaitlistContractClient::new(&env, &contract_id);
        assert_eq!(client.get_launch_count(), 0);
        assert_eq!(client.get_total_registrations(), 0);
    }

    #[test]
    fn test_create_launch() {
        let (env, contract_id, admin) = setup();
        let client = TokenLaunchWaitlistContractClient::new(&env, &contract_id);

        let symbol = String::from_str(&env, "LUMI");
        let desc = String::from_str(&env, "New LUMI token staking launch");
        let launch_id = client.create_launch(&admin, &symbol, &desc, &100).unwrap();

        assert_eq!(launch_id, 0);
        assert_eq!(client.get_launch_count(), 1);

        let info = client.get_launch(&launch_id).unwrap();
        assert_eq!(info.status, LaunchStatus::Open);
        assert_eq!(info.waitlist_size, 0);
    }

    #[test]
    fn test_join_waitlist() {
        let (env, contract_id, admin) = setup();
        let client = TokenLaunchWaitlistContractClient::new(&env, &contract_id);

        let symbol = String::from_str(&env, "LUMI");
        let desc = String::from_str(&env, "Test");
        let launch_id = client.create_launch(&admin, &symbol, &desc, &0).unwrap();

        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        let pos1 = client.join_waitlist(&user1, &launch_id).unwrap();
        let pos2 = client.join_waitlist(&user2, &launch_id).unwrap();

        assert_eq!(pos1, 1);
        assert_eq!(pos2, 2);
        assert_eq!(client.get_total_registrations(), 2);
        assert_eq!(client.get_position(&launch_id, &user1).unwrap(), 1);
    }

    #[test]
    fn test_duplicate_join_fails() {
        let (env, contract_id, admin) = setup();
        let client = TokenLaunchWaitlistContractClient::new(&env, &contract_id);

        let symbol = String::from_str(&env, "LUMI");
        let desc = String::from_str(&env, "Test");
        let launch_id = client.create_launch(&admin, &symbol, &desc, &0).unwrap();

        let user = Address::generate(&env);
        client.join_waitlist(&user, &launch_id).unwrap();
        assert!(client.try_join_waitlist(&user, &launch_id).is_err());
    }

    #[test]
    fn test_max_waitlist_cap() {
        let (env, contract_id, admin) = setup();
        let client = TokenLaunchWaitlistContractClient::new(&env, &contract_id);

        let symbol = String::from_str(&env, "LUMI");
        let desc = String::from_str(&env, "Test");
        let launch_id = client.create_launch(&admin, &symbol, &desc, &2).unwrap();

        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        let user3 = Address::generate(&env);

        client.join_waitlist(&user1, &launch_id).unwrap();
        client.join_waitlist(&user2, &launch_id).unwrap();
        assert!(client.try_join_waitlist(&user3, &launch_id).is_err());
    }

    #[test]
    fn test_grant_access_fifo_order() {
        let (env, contract_id, admin) = setup();
        let client = TokenLaunchWaitlistContractClient::new(&env, &contract_id);

        let symbol = String::from_str(&env, "LUMI");
        let desc = String::from_str(&env, "Test");
        let launch_id = client.create_launch(&admin, &symbol, &desc, &0).unwrap();

        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        let user3 = Address::generate(&env);

        client.join_waitlist(&user1, &launch_id).unwrap();
        client.join_waitlist(&user2, &launch_id).unwrap();
        client.join_waitlist(&user3, &launch_id).unwrap();

        // Grant access to first 2
        let granted = client.grant_access(&admin, &launch_id, &2).unwrap();
        assert_eq!(granted, 2);
        assert!(client.has_access(&launch_id, &user1));
        assert!(client.has_access(&launch_id, &user2));
        assert!(!client.has_access(&launch_id, &user3));

        // Grant remaining
        let granted2 = client.grant_access(&admin, &launch_id, &10).unwrap();
        assert_eq!(granted2, 1);
        assert!(client.has_access(&launch_id, &user3));
    }

    #[test]
    fn test_finalize_launch() {
        let (env, contract_id, admin) = setup();
        let client = TokenLaunchWaitlistContractClient::new(&env, &contract_id);

        let symbol = String::from_str(&env, "LUMI");
        let desc = String::from_str(&env, "Test");
        let launch_id = client.create_launch(&admin, &symbol, &desc, &0).unwrap();

        client.finalize_launch(&admin, &launch_id).unwrap();
        let info = client.get_launch(&launch_id).unwrap();
        assert_eq!(info.status, LaunchStatus::Launched);
    }

    #[test]
    fn test_cancel_launch() {
        let (env, contract_id, admin) = setup();
        let client = TokenLaunchWaitlistContractClient::new(&env, &contract_id);

        let symbol = String::from_str(&env, "LUMI");
        let desc = String::from_str(&env, "Test");
        let launch_id = client.create_launch(&admin, &symbol, &desc, &0).unwrap();

        let user = Address::generate(&env);
        client.join_waitlist(&user, &launch_id).unwrap();
        client.cancel_launch(&admin, &launch_id).unwrap();

        let info = client.get_launch(&launch_id).unwrap();
        assert_eq!(info.status, LaunchStatus::Cancelled);

        // Cannot join cancelled launch
        let user2 = Address::generate(&env);
        assert!(client.try_join_waitlist(&user2, &launch_id).is_err());
    }
}
