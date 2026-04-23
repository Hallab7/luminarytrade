//! # Referral Rewards Contract
//!
//! On-chain referral tracking with fraud-proof reward distribution.
//!
//! ## Features
//!
//! - **On-chain Referral Tracking**: All referral relationships stored on-chain
//! - **Reward Minting**: Admin mints reward tokens to the reward pool
//! - **Event-Driven**: Every referral and reward action emits an event
//! - **Fraud-Proof**: Prevents self-referral and duplicate referrals
//! - **Secure Distribution**: Rewards only claimable by verified referrers
//!
//! ## Flow
//!
//! 1. Admin initializes contract and funds reward pool
//! 2. User registers with a referrer address
//! 3. Admin confirms the referral (fraud check gate)
//! 4. Referrer accumulates reward balance
//! 5. Referrer claims their reward tokens

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, Vec,
};
use common_utils::error::CommonError;

// ============================================================================
// Storage Keys
// ============================================================================

#[contracttype]
pub enum DataKey {
    Admin,
    Initialized,
    Config,

    // Referral relationships
    ReferredBy(Address),           // user → referrer
    ReferralCount(Address),        // referrer → count of confirmed referrals
    ReferralList(Address),         // referrer → Vec<Address> of referees

    // Reward balances
    PendingReward(Address),        // referrer → claimable reward amount
    TotalClaimed(Address),         // referrer → lifetime claimed amount

    // Anti-fraud: track confirmed vs pending referrals
    ReferralStatus(Address),       // user → ReferralStatus

    // Global stats
    RewardPool,
    TotalReferrals,
    TotalRewardsPaid,
}

// ============================================================================
// Data Types
// ============================================================================

/// Status of a referral registration
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum ReferralStatus {
    /// Registered but awaiting admin confirmation
    Pending = 0,
    /// Confirmed and reward issued to referrer
    Confirmed = 1,
    /// Rejected (fraud detected)
    Rejected = 2,
}

/// Contract-level configuration
#[derive(Clone)]
#[contracttype]
pub struct RewardConfig {
    /// Fixed reward per confirmed referral (in reward token units)
    pub reward_per_referral: i128,
    /// Maximum referrals a single address can make (anti-spam)
    pub max_referrals_per_address: u32,
    pub paused: bool,
}

/// Snapshot of a referral record for queries
#[derive(Clone)]
#[contracttype]
pub struct ReferralRecord {
    pub referee: Address,
    pub referrer: Address,
    pub status: ReferralStatus,
    pub registered_at: u64,
    pub confirmed_at: u64,
}

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct ReferralRewardsContract;

#[contractimpl]
impl ReferralRewardsContract {
    /// Initialize the contract.
    pub fn initialize(
        env: Env,
        admin: Address,
        reward_per_referral: i128,
        max_referrals_per_address: u32,
    ) -> Result<(), CommonError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(CommonError::AlreadyInitialized);
        }

        admin.require_auth();

        if reward_per_referral <= 0 {
            return Err(CommonError::OutOfRange);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Config, &RewardConfig {
            reward_per_referral,
            max_referrals_per_address: if max_referrals_per_address == 0 { 100 } else { max_referrals_per_address },
            paused: false,
        });
        env.storage().instance().set(&DataKey::RewardPool, &0i128);
        env.storage().instance().set(&DataKey::TotalReferrals, &0u64);
        env.storage().instance().set(&DataKey::TotalRewardsPaid, &0i128);
        env.storage().instance().set(&DataKey::Initialized, &true);

        env.events().publish(
            (symbol_short!("rr_init"), admin),
            (reward_per_referral, max_referrals_per_address),
        );

        Ok(())
    }

    /// Admin funds the reward pool.
    pub fn fund_pool(env: Env, admin: Address, amount: i128) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(CommonError::OutOfRange);
        }

        let mut pool: i128 = env.storage().instance().get(&DataKey::RewardPool).unwrap_or(0);
        pool += amount;
        env.storage().instance().set(&DataKey::RewardPool, &pool);

        env.events().publish(
            (symbol_short!("rr_fund"), admin),
            (amount, pool),
        );

        Ok(())
    }

    /// Register a referral relationship.
    ///
    /// Fraud checks enforced:
    /// - A user cannot refer themselves
    /// - A user can only be referred once
    /// - The referrer must not exceed `max_referrals_per_address`
    pub fn register_referral(
        env: Env,
        referee: Address,
        referrer: Address,
    ) -> Result<(), CommonError> {
        referee.require_auth();

        let config: RewardConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        if config.paused {
            return Err(CommonError::NotAuthorized);
        }

        // Self-referral check
        if referee == referrer {
            return Err(CommonError::NotAuthorized);
        }

        // Duplicate referral check
        if env.storage().persistent().has(&DataKey::ReferredBy(referee.clone())) {
            return Err(CommonError::AlreadyInitialized);
        }

        // Referrer cap check
        let ref_count: u32 = env.storage().persistent()
            .get(&DataKey::ReferralCount(referrer.clone()))
            .unwrap_or(0);
        if ref_count >= config.max_referrals_per_address {
            return Err(CommonError::OutOfRange);
        }

        // Record relationship as pending
        env.storage().persistent().set(&DataKey::ReferredBy(referee.clone()), &referrer);
        env.storage().persistent().set(
            &DataKey::ReferralStatus(referee.clone()),
            &ReferralStatus::Pending,
        );

        // Append to referrer's referee list
        let mut list: Vec<Address> = env.storage().persistent()
            .get(&DataKey::ReferralList(referrer.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        list.push_back(referee.clone());
        env.storage().persistent().set(&DataKey::ReferralList(referrer.clone()), &list);

        let total: u64 = env.storage().instance().get(&DataKey::TotalReferrals).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalReferrals, &(total + 1));

        env.events().publish(
            (symbol_short!("rr_reg"), referee.clone()),
            (referrer, symbol_short!("pending")),
        );

        Ok(())
    }

    /// Admin confirms a referral and credits the referrer's reward balance.
    pub fn confirm_referral(env: Env, admin: Address, referee: Address) -> Result<i128, CommonError> {
        Self::require_admin(&env, &admin)?;

        let status: ReferralStatus = env.storage().persistent()
            .get(&DataKey::ReferralStatus(referee.clone()))
            .ok_or(CommonError::KeyNotFound)?;

        if status != ReferralStatus::Pending {
            return Err(CommonError::AlreadyInitialized);
        }

        let referrer: Address = env.storage().persistent()
            .get(&DataKey::ReferredBy(referee.clone()))
            .ok_or(CommonError::KeyNotFound)?;

        let config: RewardConfig = env.storage().instance().get(&DataKey::Config).unwrap();

        // Check pool solvency
        let mut pool: i128 = env.storage().instance().get(&DataKey::RewardPool).unwrap_or(0);
        if pool < config.reward_per_referral {
            return Err(CommonError::OutOfRange);
        }
        pool -= config.reward_per_referral;
        env.storage().instance().set(&DataKey::RewardPool, &pool);

        // Credit referrer
        let mut pending: i128 = env.storage().persistent()
            .get(&DataKey::PendingReward(referrer.clone()))
            .unwrap_or(0);
        pending += config.reward_per_referral;
        env.storage().persistent().set(&DataKey::PendingReward(referrer.clone()), &pending);

        // Update referral count
        let mut count: u32 = env.storage().persistent()
            .get(&DataKey::ReferralCount(referrer.clone()))
            .unwrap_or(0);
        count += 1;
        env.storage().persistent().set(&DataKey::ReferralCount(referrer.clone()), &count);

        // Mark confirmed
        env.storage().persistent().set(
            &DataKey::ReferralStatus(referee.clone()),
            &ReferralStatus::Confirmed,
        );

        env.events().publish(
            (symbol_short!("rr_conf"), referee),
            (referrer, config.reward_per_referral),
        );

        Ok(config.reward_per_referral)
    }

    /// Admin rejects a referral (fraud detected).
    pub fn reject_referral(env: Env, admin: Address, referee: Address) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;

        let status: ReferralStatus = env.storage().persistent()
            .get(&DataKey::ReferralStatus(referee.clone()))
            .ok_or(CommonError::KeyNotFound)?;

        if status != ReferralStatus::Pending {
            return Err(CommonError::AlreadyInitialized);
        }

        env.storage().persistent().set(
            &DataKey::ReferralStatus(referee.clone()),
            &ReferralStatus::Rejected,
        );

        env.events().publish(
            (symbol_short!("rr_rej"), admin),
            referee,
        );

        Ok(())
    }

    /// Referrer claims their accumulated reward.
    pub fn claim_reward(env: Env, referrer: Address) -> Result<i128, CommonError> {
        referrer.require_auth();

        let pending: i128 = env.storage().persistent()
            .get(&DataKey::PendingReward(referrer.clone()))
            .unwrap_or(0);

        if pending <= 0 {
            return Err(CommonError::OutOfRange);
        }

        env.storage().persistent().set(&DataKey::PendingReward(referrer.clone()), &0i128);

        let mut total_claimed: i128 = env.storage().persistent()
            .get(&DataKey::TotalClaimed(referrer.clone()))
            .unwrap_or(0);
        total_claimed += pending;
        env.storage().persistent().set(&DataKey::TotalClaimed(referrer.clone()), &total_claimed);

        let mut total_paid: i128 = env.storage().instance().get(&DataKey::TotalRewardsPaid).unwrap_or(0);
        total_paid += pending;
        env.storage().instance().set(&DataKey::TotalRewardsPaid, &total_paid);

        env.events().publish(
            (symbol_short!("rr_claim"), referrer),
            (pending, total_claimed),
        );

        Ok(pending)
    }

    // ========================================================================
    // View Functions
    // ========================================================================

    pub fn get_pending_reward(env: Env, referrer: Address) -> i128 {
        env.storage().persistent().get(&DataKey::PendingReward(referrer)).unwrap_or(0)
    }

    pub fn get_referrer(env: Env, referee: Address) -> Option<Address> {
        env.storage().persistent().get(&DataKey::ReferredBy(referee))
    }

    pub fn get_referral_status(env: Env, referee: Address) -> Option<ReferralStatus> {
        env.storage().persistent().get(&DataKey::ReferralStatus(referee))
    }

    pub fn get_referral_count(env: Env, referrer: Address) -> u32 {
        env.storage().persistent().get(&DataKey::ReferralCount(referrer)).unwrap_or(0)
    }

    pub fn get_referral_list(env: Env, referrer: Address) -> Vec<Address> {
        env.storage().persistent()
            .get(&DataKey::ReferralList(referrer))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_reward_pool(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::RewardPool).unwrap_or(0)
    }

    pub fn get_total_referrals(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::TotalReferrals).unwrap_or(0)
    }

    pub fn get_total_rewards_paid(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalRewardsPaid).unwrap_or(0)
    }

    // ========================================================================
    // Admin
    // ========================================================================

    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;
        let mut config: RewardConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        config.paused = paused;
        env.storage().instance().set(&DataKey::Config, &config);
        Ok(())
    }

    pub fn update_reward_per_referral(env: Env, admin: Address, new_reward: i128) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;
        if new_reward <= 0 {
            return Err(CommonError::OutOfRange);
        }
        let mut config: RewardConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        config.reward_per_referral = new_reward;
        env.storage().instance().set(&DataKey::Config, &config);
        Ok(())
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
    use soroban_sdk::{testutils::Address as _, Address, Env};

    fn setup(reward_per_referral: i128) -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, ReferralRewardsContract);
        let client = ReferralRewardsContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin, &reward_per_referral, &10).unwrap();
        (env, contract_id, admin)
    }

    #[test]
    fn test_initialize() {
        let (env, contract_id, _) = setup(1_000_000);
        let client = ReferralRewardsContractClient::new(&env, &contract_id);
        assert_eq!(client.get_reward_pool(), 0);
        assert_eq!(client.get_total_referrals(), 0);
    }

    #[test]
    fn test_fund_pool() {
        let (env, contract_id, admin) = setup(1_000_000);
        let client = ReferralRewardsContractClient::new(&env, &contract_id);
        client.fund_pool(&admin, &10_000_000).unwrap();
        assert_eq!(client.get_reward_pool(), 10_000_000);
    }

    #[test]
    fn test_register_referral() {
        let (env, contract_id, admin) = setup(1_000_000);
        let client = ReferralRewardsContractClient::new(&env, &contract_id);

        let referrer = Address::generate(&env);
        let referee = Address::generate(&env);

        client.register_referral(&referee, &referrer).unwrap();

        assert_eq!(client.get_referrer(&referee).unwrap(), referrer);
        assert_eq!(client.get_referral_status(&referee).unwrap(), ReferralStatus::Pending);
        assert_eq!(client.get_total_referrals(), 1);
    }

    #[test]
    fn test_self_referral_fails() {
        let (env, contract_id, _) = setup(1_000_000);
        let client = ReferralRewardsContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);
        assert!(client.try_register_referral(&user, &user).is_err());
    }

    #[test]
    fn test_duplicate_referral_fails() {
        let (env, contract_id, _) = setup(1_000_000);
        let client = ReferralRewardsContractClient::new(&env, &contract_id);
        let referrer = Address::generate(&env);
        let referee = Address::generate(&env);

        client.register_referral(&referee, &referrer).unwrap();
        assert!(client.try_register_referral(&referee, &referrer).is_err());
    }

    #[test]
    fn test_confirm_referral_credits_referrer() {
        let (env, contract_id, admin) = setup(1_000_000);
        let client = ReferralRewardsContractClient::new(&env, &contract_id);

        client.fund_pool(&admin, &10_000_000).unwrap();

        let referrer = Address::generate(&env);
        let referee = Address::generate(&env);

        client.register_referral(&referee, &referrer).unwrap();
        let reward = client.confirm_referral(&admin, &referee).unwrap();

        assert_eq!(reward, 1_000_000);
        assert_eq!(client.get_pending_reward(&referrer), 1_000_000);
        assert_eq!(client.get_referral_status(&referee).unwrap(), ReferralStatus::Confirmed);
        assert_eq!(client.get_referral_count(&referrer), 1);
    }

    #[test]
    fn test_reject_referral() {
        let (env, contract_id, admin) = setup(1_000_000);
        let client = ReferralRewardsContractClient::new(&env, &contract_id);

        let referrer = Address::generate(&env);
        let referee = Address::generate(&env);

        client.register_referral(&referee, &referrer).unwrap();
        client.reject_referral(&admin, &referee).unwrap();

        assert_eq!(client.get_referral_status(&referee).unwrap(), ReferralStatus::Rejected);
        assert_eq!(client.get_pending_reward(&referrer), 0);
    }

    #[test]
    fn test_claim_reward() {
        let (env, contract_id, admin) = setup(1_000_000);
        let client = ReferralRewardsContractClient::new(&env, &contract_id);

        client.fund_pool(&admin, &10_000_000).unwrap();

        let referrer = Address::generate(&env);
        let referee = Address::generate(&env);

        client.register_referral(&referee, &referrer).unwrap();
        client.confirm_referral(&admin, &referee).unwrap();

        let claimed = client.claim_reward(&referrer).unwrap();
        assert_eq!(claimed, 1_000_000);
        assert_eq!(client.get_pending_reward(&referrer), 0);
        assert_eq!(client.get_total_rewards_paid(), 1_000_000);
    }

    #[test]
    fn test_claim_with_no_reward_fails() {
        let (env, contract_id, _) = setup(1_000_000);
        let client = ReferralRewardsContractClient::new(&env, &contract_id);
        let referrer = Address::generate(&env);
        assert!(client.try_claim_reward(&referrer).is_err());
    }
}
