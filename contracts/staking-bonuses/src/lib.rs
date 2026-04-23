//! # Staking Bonuses Contract
//!
//! Duration-based staking bonuses with time locks and periodic claimable rewards.
//!
//! ## Features
//!
//! - **Duration Tiers**: Longer lock periods earn higher bonus rates
//! - **Time Locks**: Staked tokens are locked until the end of the chosen period
//! - **Claimable Bonuses**: Accumulated bonuses can be claimed after the lock expires
//! - **Transparent**: All stake/bonus events are emitted on-chain
//! - **Admin Controls**: Configurable bonus rates and reward pool management

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, Vec,
};
use common_utils::error::CommonError;

// ============================================================================
// Constants
// ============================================================================

const SECONDS_PER_DAY: u64 = 86_400;

/// Bonus rate (basis points) for each tier
const TIER1_RATE_BPS: u32 = 500;   // 5%  — 30 days
const TIER2_RATE_BPS: u32 = 1000;  // 10% — 90 days
const TIER3_RATE_BPS: u32 = 1500;  // 15% — 180 days
const TIER4_RATE_BPS: u32 = 2500;  // 25% — 365 days

const TIER1_DAYS: u64 = 30;
const TIER2_DAYS: u64 = 90;
const TIER3_DAYS: u64 = 180;
const TIER4_DAYS: u64 = 365;

// ============================================================================
// Storage Keys
// ============================================================================

#[contracttype]
pub enum DataKey {
    Admin,
    Initialized,
    Config,

    // Per-user stake records
    Stake(Address),

    // Reward pool (deposited by admin)
    RewardPool,

    // Global stats
    TotalStaked,
    TotalBonusPaid,
    StakeCount,
}

// ============================================================================
// Data Types
// ============================================================================

/// Lock tier chosen by the staker
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum LockTier {
    Days30 = 0,
    Days90 = 1,
    Days180 = 2,
    Days365 = 3,
}

impl LockTier {
    pub fn duration_seconds(self) -> u64 {
        match self {
            LockTier::Days30  => TIER1_DAYS  * SECONDS_PER_DAY,
            LockTier::Days90  => TIER2_DAYS  * SECONDS_PER_DAY,
            LockTier::Days180 => TIER3_DAYS  * SECONDS_PER_DAY,
            LockTier::Days365 => TIER4_DAYS  * SECONDS_PER_DAY,
        }
    }

    pub fn bonus_rate_bps(self) -> u32 {
        match self {
            LockTier::Days30  => TIER1_RATE_BPS,
            LockTier::Days90  => TIER2_RATE_BPS,
            LockTier::Days180 => TIER3_RATE_BPS,
            LockTier::Days365 => TIER4_RATE_BPS,
        }
    }
}

/// Active stake record for a user
#[derive(Clone)]
#[contracttype]
pub struct StakeRecord {
    pub staker: Address,
    pub amount: i128,
    pub tier: LockTier,
    pub staked_at: u64,
    pub lock_until: u64,
    pub bonus_amount: i128,
    pub claimed: bool,
}

/// Contract configuration
#[derive(Clone)]
#[contracttype]
pub struct StakingConfig {
    pub min_stake: i128,
    pub paused: bool,
}

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct StakingBonusesContract;

#[contractimpl]
impl StakingBonusesContract {
    /// Initialize the contract.
    pub fn initialize(env: Env, admin: Address) -> Result<(), CommonError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(CommonError::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Config, &StakingConfig {
            min_stake: 1_000_000,
            paused: false,
        });
        env.storage().instance().set(&DataKey::RewardPool, &0i128);
        env.storage().instance().set(&DataKey::TotalStaked, &0i128);
        env.storage().instance().set(&DataKey::TotalBonusPaid, &0i128);
        env.storage().instance().set(&DataKey::StakeCount, &0u64);
        env.storage().instance().set(&DataKey::Initialized, &true);

        env.events().publish(
            (symbol_short!("sb_init"), admin),
            symbol_short!("ok"),
        );

        Ok(())
    }

    /// Deposit tokens into the reward pool (admin only).
    pub fn fund_reward_pool(env: Env, admin: Address, amount: i128) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(CommonError::OutOfRange);
        }

        let mut pool: i128 = env.storage().instance().get(&DataKey::RewardPool).unwrap_or(0);
        pool += amount;
        env.storage().instance().set(&DataKey::RewardPool, &pool);

        env.events().publish(
            (symbol_short!("sb_fund"), admin),
            (amount, pool),
        );

        Ok(())
    }

    /// Stake tokens for a given lock tier.
    ///
    /// The bonus is calculated immediately at stake time and reserved from the pool.
    /// Tokens + bonus become claimable once `lock_until` passes.
    pub fn stake(env: Env, staker: Address, amount: i128, tier: LockTier) -> Result<i128, CommonError> {
        staker.require_auth();

        let config: StakingConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        if config.paused {
            return Err(CommonError::NotAuthorized);
        }

        if amount < config.min_stake {
            return Err(CommonError::OutOfRange);
        }

        // Prevent a second stake from the same address while one is active
        if env.storage().persistent().has(&DataKey::Stake(staker.clone())) {
            let existing: StakeRecord = env.storage().persistent()
                .get(&DataKey::Stake(staker.clone())).unwrap();
            if !existing.claimed {
                return Err(CommonError::AlreadyInitialized);
            }
        }

        let bonus_amount = (amount * tier.bonus_rate_bps() as i128) / 10_000;

        // Ensure reward pool can cover the bonus
        let mut pool: i128 = env.storage().instance().get(&DataKey::RewardPool).unwrap_or(0);
        if pool < bonus_amount {
            return Err(CommonError::OutOfRange);
        }
        pool -= bonus_amount;
        env.storage().instance().set(&DataKey::RewardPool, &pool);

        let now = env.ledger().timestamp();
        let lock_until = now + tier.duration_seconds();

        let record = StakeRecord {
            staker: staker.clone(),
            amount,
            tier,
            staked_at: now,
            lock_until,
            bonus_amount,
            claimed: false,
        };
        env.storage().persistent().set(&DataKey::Stake(staker.clone()), &record);

        let mut total_staked: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        total_staked += amount;
        env.storage().instance().set(&DataKey::TotalStaked, &total_staked);

        let count: u64 = env.storage().instance().get(&DataKey::StakeCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::StakeCount, &(count + 1));

        env.events().publish(
            (symbol_short!("sb_stake"), staker),
            (amount, tier as u32, lock_until, bonus_amount),
        );

        Ok(bonus_amount)
    }

    /// Claim staked tokens + bonus after the lock period expires.
    pub fn claim(env: Env, staker: Address) -> Result<i128, CommonError> {
        staker.require_auth();

        let mut record: StakeRecord = env.storage().persistent()
            .get(&DataKey::Stake(staker.clone()))
            .ok_or(CommonError::KeyNotFound)?;

        if record.claimed {
            return Err(CommonError::AlreadyInitialized);
        }

        let now = env.ledger().timestamp();
        if now < record.lock_until {
            return Err(CommonError::NotAuthorized);
        }

        record.claimed = true;
        env.storage().persistent().set(&DataKey::Stake(staker.clone()), &record);

        let total_payout = record.amount + record.bonus_amount;

        let mut total_paid: i128 = env.storage().instance().get(&DataKey::TotalBonusPaid).unwrap_or(0);
        total_paid += record.bonus_amount;
        env.storage().instance().set(&DataKey::TotalBonusPaid, &total_paid);

        env.events().publish(
            (symbol_short!("sb_claim"), staker),
            (record.amount, record.bonus_amount, total_payout),
        );

        Ok(total_payout)
    }

    // ========================================================================
    // View Functions
    // ========================================================================

    pub fn get_stake(env: Env, staker: Address) -> Option<StakeRecord> {
        env.storage().persistent().get(&DataKey::Stake(staker))
    }

    pub fn get_reward_pool(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::RewardPool).unwrap_or(0)
    }

    pub fn get_total_staked(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0)
    }

    pub fn get_total_bonus_paid(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalBonusPaid).unwrap_or(0)
    }

    pub fn is_claimable(env: Env, staker: Address) -> bool {
        if let Some(record) = env.storage().persistent().get::<_, StakeRecord>(&DataKey::Stake(staker)) {
            !record.claimed && env.ledger().timestamp() >= record.lock_until
        } else {
            false
        }
    }

    // ========================================================================
    // Admin Functions
    // ========================================================================

    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;

        let mut config: StakingConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        config.paused = paused;
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("sb_pause"), admin),
            paused,
        );

        Ok(())
    }

    pub fn set_min_stake(env: Env, admin: Address, min_stake: i128) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;

        if min_stake <= 0 {
            return Err(CommonError::OutOfRange);
        }

        let mut config: StakingConfig = env.storage().instance().get(&DataKey::Config).unwrap();
        config.min_stake = min_stake;
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

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, StakingBonusesContract);
        let client = StakingBonusesContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.initialize(&admin).unwrap();
        (env, contract_id, admin)
    }

    #[test]
    fn test_initialize() {
        let (env, contract_id, admin) = setup();
        let client = StakingBonusesContractClient::new(&env, &contract_id);
        assert_eq!(client.get_reward_pool(), 0);
        assert_eq!(client.get_total_staked(), 0);
    }

    #[test]
    fn test_double_initialize_fails() {
        let (env, contract_id, admin) = setup();
        let client = StakingBonusesContractClient::new(&env, &contract_id);
        assert!(client.try_initialize(&admin).is_err());
    }

    #[test]
    fn test_fund_reward_pool() {
        let (env, contract_id, admin) = setup();
        let client = StakingBonusesContractClient::new(&env, &contract_id);
        client.fund_reward_pool(&admin, &5_000_000).unwrap();
        assert_eq!(client.get_reward_pool(), 5_000_000);
    }

    #[test]
    fn test_stake_and_bonus_calculation() {
        let (env, contract_id, admin) = setup();
        let client = StakingBonusesContractClient::new(&env, &contract_id);

        client.fund_reward_pool(&admin, &10_000_000).unwrap();

        let staker = Address::generate(&env);
        // Stake 1_000_000 for 30 days → bonus = 5% = 50_000
        let bonus = client.stake(&staker, &1_000_000, &LockTier::Days30).unwrap();
        assert_eq!(bonus, 50_000);
        assert_eq!(client.get_reward_pool(), 9_950_000);
        assert_eq!(client.get_total_staked(), 1_000_000);
    }

    #[test]
    fn test_claim_before_lock_fails() {
        let (env, contract_id, admin) = setup();
        let client = StakingBonusesContractClient::new(&env, &contract_id);

        client.fund_reward_pool(&admin, &10_000_000).unwrap();
        let staker = Address::generate(&env);
        client.stake(&staker, &1_000_000, &LockTier::Days30).unwrap();

        assert!(client.try_claim(&staker).is_err());
        assert!(!client.is_claimable(&staker));
    }

    #[test]
    fn test_claim_after_lock_succeeds() {
        let (env, contract_id, admin) = setup();
        let client = StakingBonusesContractClient::new(&env, &contract_id);

        client.fund_reward_pool(&admin, &10_000_000).unwrap();
        let staker = Address::generate(&env);
        client.stake(&staker, &1_000_000, &LockTier::Days30).unwrap();

        // Fast-forward past lock period
        env.ledger().with_mut(|l| {
            l.timestamp += TIER1_DAYS * SECONDS_PER_DAY + 1;
        });

        assert!(client.is_claimable(&staker));
        let payout = client.claim(&staker).unwrap();
        assert_eq!(payout, 1_050_000); // 1_000_000 + 50_000 bonus
    }

    #[test]
    fn test_double_claim_fails() {
        let (env, contract_id, admin) = setup();
        let client = StakingBonusesContractClient::new(&env, &contract_id);

        client.fund_reward_pool(&admin, &10_000_000).unwrap();
        let staker = Address::generate(&env);
        client.stake(&staker, &1_000_000, &LockTier::Days30).unwrap();

        env.ledger().with_mut(|l| {
            l.timestamp += TIER1_DAYS * SECONDS_PER_DAY + 1;
        });

        client.claim(&staker).unwrap();
        assert!(client.try_claim(&staker).is_err());
    }

    #[test]
    fn test_tier_rates() {
        assert_eq!(LockTier::Days30.bonus_rate_bps(), 500);
        assert_eq!(LockTier::Days90.bonus_rate_bps(), 1000);
        assert_eq!(LockTier::Days180.bonus_rate_bps(), 1500);
        assert_eq!(LockTier::Days365.bonus_rate_bps(), 2500);
    }

    #[test]
    fn test_paused_stake_fails() {
        let (env, contract_id, admin) = setup();
        let client = StakingBonusesContractClient::new(&env, &contract_id);

        client.fund_reward_pool(&admin, &10_000_000).unwrap();
        client.set_paused(&admin, &true).unwrap();

        let staker = Address::generate(&env);
        assert!(client.try_stake(&staker, &1_000_000, &LockTier::Days30).is_err());
    }
}
