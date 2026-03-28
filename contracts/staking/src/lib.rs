//! # Oracle Staking Contract
//!
//! A comprehensive staking system for oracles with rewards distribution and slashing mechanisms.
//! This contract ensures oracle accountability through collateral staking and incentivizes quality
//! data provision.
//!
//! ## Features
//!
//! - **Staking System**: Oracles stake collateral to participate
//! - **Rewards Distribution**: Earn rewards based on data quality and accuracy
//! - **Slashing Mechanism**: Penalize bad actors by slashing their stake
//! - **Reputation System**: Higher stake = higher reputation
//! - **Lockup Periods**: Prevent fast exits after slashing events
//! - **Governance**: Configurable parameters through admin controls
//! - **Leaderboard**: Track top stakers and performers
//!
//! ## Stake Lifecycle
//!
//! 1. **Stake**: Deposit collateral to become an oracle
//! 2. **Earn**: Collect rewards for providing accurate data
//! 3. **Unstake**: Request withdrawal (subject to lockup period)
//! 4. **Slash**: Lose stake if providing bad/malicious data
//! 5. **Claim**: Collect accumulated rewards after lockup
//!
//! ## Reward Calculation
//!
//! - Base reward: Per data feed per day
//! - Quality bonus: +10% for >99% accuracy
//! - Penalty: -20% for <95% accuracy
//! - Tier bonus: Higher stake earns higher percentage
//!
//! ## Slashing Conditions
//!
//! - Data offline >24h: 5% slash
//! - False data detected: 20% slash
//! - Malicious behavior (multi-sig): Up to 100% slash

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, panic_with_error,
    Address, Bytes, BytesN, Env, Map, Symbol, Vec, IntoVal, Val,
};
use common_utils::error::CommonError;
use common_utils::compliance_log::{ComplianceLogger, ComplianceAction};

// ============================================================================
// Storage Keys
// ============================================================================

#[contracttype]
pub enum DataKey {
    // Configuration
    Admin,
    Initialized,
    
    // Staking Parameters
    MinStake,
    MaxStake,
    UnstakeLockupDays,
    GracePeriodDays,
    BaseRewardRate,
    
    // Slashing Parameters
    OfflineSlashPercent,
    FalseDataSlashPercent,
    MaliciousSlashMaxPercent,
    OfflineThresholdHours,
    
    // Tier Thresholds
    Tier1Threshold,
    Tier2Threshold,
    Tier3Threshold,
    
    // Reward Parameters
    QualityBonusPercent,
    AccuracyThresholdHigh,
    AccuracyThresholdLow,
    PenaltyPercent,
    
    // Oracle Data
    Oracle(Address),
    StakeInfo(Address),
    Rewards(Address),
    UnstakeRequest(Address),
    SlashEvent(Address),
    
    // Global Tracking
    TotalStaked,
    TotalOracles,
    OracleList,
    
    // Leaderboard
    TopStakers,
    
    // Governance
    GovernanceConfig,
    MultiSigContract,
}

// ============================================================================
// Data Types
// ============================================================================

/// Oracle tier based on stake amount
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum OracleTier {
    /// Bronze tier: Minimum stake
    Bronze = 0,
    /// Silver tier: Medium stake
    Silver = 1,
    /// Gold tier: High stake
    Gold = 2,
    /// Platinum tier: Maximum stake
    Platinum = 3,
}

/// Oracle status
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum OracleStatus {
    /// Active and earning rewards
    Active = 0,
    /// Unstaking request pending
    Unstaking = 1,
    /// Slashed and penalized
    Slashed = 2,
    /// Inactive/cannot participate
    Inactive = 3,
}

/// Stake information for an oracle
#[derive(Clone)]
#[contracttype]
pub struct StakeInfo {
    /// Oracle address
    pub oracle: Address,
    /// Amount staked
    pub amount: i128,
    /// Timestamp when staked
    pub staked_at: u64,
    /// Current tier
    pub tier: OracleTier,
    /// Current status
    pub status: OracleStatus,
    /// Reputation score (based on performance)
    pub reputation: u32,
    /// Total rewards earned
    pub total_rewards_earned: i128,
    /// Consecutive accurate submissions
    pub accurate_submissions: u32,
    /// Consecutive inaccurate submissions
    pub inaccurate_submissions: u32,
}

/// Unstake request
#[derive(Clone)]
#[contracttype]
pub struct UnstakeRequest {
    /// Oracle address
    pub oracle: Address,
    /// Amount to unstake
    pub amount: i128,
    /// Request timestamp
    pub requested_at: u64,
    /// Available after timestamp
    pub available_at: u64,
    /// Grace period ends at
    pub grace_ends_at: u64,
}

/// Slash event record
#[derive(Clone)]
#[contracttype]
pub struct SlashRecord {
    /// Oracle address
    pub oracle: Address,
    /// Amount slashed
    pub slashed_amount: i128,
    /// Reason code
    pub reason: Symbol,
    /// Timestamp
    pub timestamp: u64,
    /// Reported by
    pub reported_by: Option<Address>,
}

/// Reward information
#[derive(Clone)]
#[contracttype]
pub struct RewardInfo {
    /// Oracle address
    pub oracle: Address,
    /// Accumulated rewards
    pub accumulated: i128,
    /// Claimed rewards
    pub claimed: i128,
    /// Last reward timestamp
    pub last_reward_at: u64,
    /// Pending rewards (not yet distributed)
    pub pending: i128,
}

/// Oracle entry for leaderboard
#[derive(Clone)]
#[contracttype]
pub struct OracleEntry {
    /// Oracle address
    pub oracle: Address,
    /// Stake amount
    pub stake: i128,
    /// Reputation score
    pub reputation: u32,
    /// Tier
    pub tier: OracleTier,
}

/// Governance configuration
#[derive(Clone)]
#[contracttype]
pub struct GovernanceConfig {
    /// Multi-sig contract for governance decisions
    pub multisig: Option<Address>,
    /// Enable/disable slashing
    pub slashing_enabled: bool,
    /// Enable/disable rewards
    pub rewards_enabled: bool,
    /// Minimum accuracy required
    pub min_accuracy_percent: u32,
}

/// Stake leaderboard with pagination
#[derive(Clone)]
#[contracttype]
pub struct Leaderboard {
    /// Top stakers by amount
    pub top_stakes: Vec<OracleEntry>,
    /// Top by reputation
    pub top_reputation: Vec<OracleEntry>,
    /// Total count
    pub total_count: u32,
}

// ============================================================================
// Constants
// ============================================================================

const MIN_STAKE: i128 = 1_000_000_000; // 1000 tokens (assuming 6 decimals)
const MAX_STAKE: i128 = 100_000_000_000; // 100,000 tokens
const UNSTAKE_LOCKUP_DAYS: u64 = 7;
const GRACE_PERIOD_DAYS: u64 = 1;
const BASE_REWARD_RATE: i128 = 100_000_000; // 100 tokens per day
const SECONDS_PER_DAY: u64 = 86400;

// Slashing percentages (in basis points, 10000 = 100%)
const OFFLINE_SLASH_BPS: u32 = 500; // 5%
const FALSE_DATA_SLASH_BPS: u32 = 2000; // 20%
const MALICIOUS_SLASH_MAX_BPS: u32 = 10000; // 100%
const OFFLINE_THRESHOLD_HOURS: u64 = 24;

// Tier thresholds
const TIER1_THRESHOLD: i128 = 5_000_000_000; // 5,000 tokens
const TIER2_THRESHOLD: i128 = 20_000_000_000; // 20,000 tokens
const TIER3_THRESHOLD: i128 = 50_000_000_000; // 50,000 tokens

// Reward bonuses (in basis points)
const QUALITY_BONUS_BPS: u32 = 1000; // 10%
const ACCURACY_HIGH: u32 = 99; // 99%
const ACCURACY_LOW: u32 = 95; // 95%
const PENALTY_BPS: u32 = 2000; // 20%

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct StakingContract;

// ============================================================================
// Implementation
// ============================================================================

#[contractimpl]
impl StakingContract {
    /// Initialize the staking contract
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `admin` - Admin address for governance
    /// 
    /// # Returns
    /// 
    /// * `Ok(())` - Initialization successful
    /// * `Err(CommonError)` - If already initialized
    pub fn initialize(env: Env, admin: Address) -> Result<(), CommonError> {
        // Check if already initialized
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(CommonError::AlreadyInitialized);
        }
        
        // Store admin
        env.storage().instance().set(&DataKey::Admin, &admin);
        
        // Initialize configuration
        env.storage().instance().set(&DataKey::MinStake, &MIN_STAKE);
        env.storage().instance().set(&DataKey::MaxStake, &MAX_STAKE);
        env.storage().instance().set(&DataKey::UnstakeLockupDays, &UNSTAKE_LOCKUP_DAYS);
        env.storage().instance().set(&DataKey::GracePeriodDays, &GRACE_PERIOD_DAYS);
        env.storage().instance().set(&DataKey::BaseRewardRate, &BASE_REWARD_RATE);
        
        // Slashing parameters
        env.storage().instance().set(&DataKey::OfflineSlashPercent, &OFFLINE_SLASH_BPS);
        env.storage().instance().set(&DataKey::FalseDataSlashPercent, &FALSE_DATA_SLASH_BPS);
        env.storage().instance().set(&DataKey::MaliciousSlashMaxPercent, &MALICIOUS_SLASH_MAX_BPS);
        env.storage().instance().set(&DataKey::OfflineThresholdHours, &OFFLINE_THRESHOLD_HOURS);
        
        // Tier thresholds
        env.storage().instance().set(&DataKey::Tier1Threshold, &TIER1_THRESHOLD);
        env.storage().instance().set(&DataKey::Tier2Threshold, &TIER2_THRESHOLD);
        env.storage().instance().set(&DataKey::Tier3Threshold, &TIER3_THRESHOLD);
        
        // Reward parameters
        env.storage().instance().set(&DataKey::QualityBonusPercent, &QUALITY_BONUS_BPS);
        env.storage().instance().set(&DataKey::AccuracyThresholdHigh, &ACCURACY_HIGH);
        env.storage().instance().set(&DataKey::AccuracyThresholdLow, &ACCURACY_LOW);
        env.storage().instance().set(&DataKey::PenaltyPercent, &PENALTY_BPS);
        
        // Global tracking
        env.storage().instance().set(&DataKey::TotalStaked, &0i128);
        env.storage().instance().set(&DataKey::TotalOracles, &0u32);
        env.storage().instance().set(&DataKey::OracleList, &Vec::<Address>::new(&env));
        
        // Governance config
        let gov_config = GovernanceConfig {
            multisig: None,
            slashing_enabled: true,
            rewards_enabled: true,
            min_accuracy_percent: 90,
        };
        env.storage().instance().set(&DataKey::GovernanceConfig, &gov_config);
        
        // Mark as initialized
        env.storage().instance().set(&DataKey::Initialized, &true);
        
        // Emit initialization event
        env.events().publish(
            (symbol_short!("staking_init"), admin),
            symbol_short!("initialized"),
        );
        
        Ok(())
    }

    /// Stake collateral to become an oracle
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `oracle` - Oracle address
    /// * `amount` - Amount to stake
    /// 
    /// # Returns
    /// 
    /// * `Ok(StakeInfo)` - Stake information
    /// * `Err(CommonError)` - If invalid amount or already staked
    pub fn stake(env: Env, oracle: Address, amount: i128) -> Result<StakeInfo, CommonError> {
        // Verify oracle authorization
        oracle.require_auth();
        
        // Validate amount
        let min_stake: i128 = env.storage().instance().get(&DataKey::MinStake).unwrap();
        let max_stake: i128 = env.storage().instance().get(&DataKey::MaxStake).unwrap();
        
        if amount < min_stake {
            return Err(CommonError::OutOfRange); // Below minimum
        }
        
        if amount > max_stake {
            return Err(CommonError::OutOfRange); // Above maximum
        }
        
        // Check if oracle already has a stake
        if env.storage().persistent().has(&DataKey::StakeInfo(oracle.clone())) {
            return Err(CommonError::AlreadyInitialized); // Already staked
        }
        
        // Calculate tier
        let tier = Self::calculate_tier(&env, amount);
        
        // Create stake info
        let stake_info = StakeInfo {
            oracle: oracle.clone(),
            amount,
            staked_at: env.ledger().timestamp(),
            tier,
            status: OracleStatus::Active,
            reputation: 100, // Starting reputation
            total_rewards_earned: 0,
            accurate_submissions: 0,
            inaccurate_submissions: 0,
        };
        
        // Store stake info
        env.storage().persistent().set(&DataKey::StakeInfo(oracle.clone()), &stake_info);
        
        // Initialize rewards tracking
        let reward_info = RewardInfo {
            oracle: oracle.clone(),
            accumulated: 0,
            claimed: 0,
            last_reward_at: env.ledger().timestamp(),
            pending: 0,
        };
        env.storage().persistent().set(&DataKey::Rewards(oracle.clone()), &reward_info);
        
        // Update global tracking
        let mut total_staked: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0);
        total_staked += amount;
        env.storage().instance().set(&DataKey::TotalStaked, &total_staked);
        
        let mut total_oracles: u32 = env.storage().instance().get(&DataKey::TotalOracles).unwrap_or(0);
        total_oracles += 1;
        env.storage().instance().set(&DataKey::TotalOracles, &total_oracles);
        
        // Add to oracle list
        let mut oracle_list: Vec<Address> = env.storage().instance().get(&DataKey::OracleList).unwrap_or_else(|| Vec::new(&env));
        oracle_list.push_back(oracle.clone());
        env.storage().instance().set(&DataKey::OracleList, &oracle_list);
        
        // Update leaderboard
        Self::update_leaderboard(&env, oracle.clone(), amount, 100, tier);
        
        // Emit stake event
        env.events().publish(
            (symbol_short!("stake"), oracle.clone()),
            (amount, tier as u32),
        );

        // Compliance audit log – StakeAdded (fund movement)
        if ComplianceLogger::is_initialized(&env) {
            let amt_bytes = Bytes::from_slice(&env, &amount.to_le_bytes());
            let oracle_str: soroban_sdk::String = oracle.clone().to_string();
            let target_bytes = Bytes::from_slice(&env, oracle_str.as_bytes());
            ComplianceLogger::append(
                &env,
                oracle.clone(),
                ComplianceAction::StakeAdded,
                target_bytes,
                Bytes::new(&env),
                amt_bytes,
                BytesN::from_array(&env, &[0u8; 32]),
            );
        }

        Ok(stake_info)
    }

    /// Request to unstake (initiates lockup period)
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `oracle` - Oracle address
    /// 
    /// # Returns
    /// 
    /// * `Ok(UnstakeRequest)` - Unstake request details
    /// * `Err(CommonError)` - If not staked or already unstaking
    pub fn unstake(env: Env, oracle: Address) -> Result<UnstakeRequest, CommonError> {
        // Verify oracle authorization
        oracle.require_auth();
        
        // Get stake info
        let mut stake_info: StakeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::StakeInfo(oracle.clone()))
            .ok_or(CommonError::KeyNotFound)?;
        
        // Check if already unstaking
        if env.storage().persistent().has(&DataKey::UnstakeRequest(oracle.clone())) {
            return Err(CommonError::AlreadyInitialized); // Already has unstake request
        }
        
        // Check status
        if stake_info.status != OracleStatus::Active {
            return Err(CommonError::NotAuthorized); // Cannot unstake if not active
        }
        
        // Calculate lockup and grace periods
        let lockup_days: u64 = env.storage().instance().get(&DataKey::UnstakeLockupDays).unwrap();
        let grace_days: u64 = env.storage().instance().get(&DataKey::GracePeriodDays).unwrap();
        let current_time = env.ledger().timestamp();
        let available_at = current_time + (lockup_days * SECONDS_PER_DAY);
        let grace_ends_at = available_at + (grace_days * SECONDS_PER_DAY);
        
        // Create unstake request
        let unstake_request = UnstakeRequest {
            oracle: oracle.clone(),
            amount: stake_info.amount,
            requested_at: current_time,
            available_at,
            grace_ends_at,
        };
        
        // Store unstake request
        env.storage().persistent().set(&DataKey::UnstakeRequest(oracle.clone()), &unstake_request);
        
        // Update stake status
        stake_info.status = OracleStatus::Unstaking;
        env.storage().persistent().set(&DataKey::StakeInfo(oracle.clone()), &stake_info);
        
        // Emit unstake event
        env.events().publish(
            (symbol_short!("unstake_req"), oracle.clone()),
            (stake_info.amount, available_at),
        );
        
        Ok(unstake_request)
    }

    /// Complete unstaking and claim collateral after lockup period
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `oracle` - Oracle address
    /// 
    /// # Returns
    /// 
    /// * `Ok(i128)` - Amount returned
    /// * `Err(CommonError)` - If lockup not ended or no request
    pub fn claim_unstake(env: Env, oracle: Address) -> Result<i128, CommonError> {
        // Verify oracle authorization
        oracle.require_auth();
        
        // Get unstake request
        let unstake_request: UnstakeRequest = env
            .storage()
            .persistent()
            .get(&DataKey::UnstakeRequest(oracle.clone()))
            .ok_or(CommonError::KeyNotFound)?;
        
        // Check if lockup period has ended
        let current_time = env.ledger().timestamp();
        if current_time < unstake_request.available_at {
            return Err(CommonError::OutOfRange); // Lockup period not ended
        }
        
        // Check if within grace period
        if current_time > unstake_request.grace_ends_at {
            // Grace period expired - could implement penalty here
            // For now, we'll just allow claiming but emit a warning event
            env.events().publish(
                (symbol_short!("grace_exp"), oracle.clone()),
                symbol_short!("warning"),
            );
        }
        
        // Get stake info
        let stake_info: StakeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::StakeInfo(oracle.clone()))
            .ok_or(CommonError::KeyNotFound)?;
        
        // Calculate final rewards
        Self::process_final_rewards(&env, &oracle, &stake_info)?;
        
        // Transfer stake back to oracle (mock - in production would use token transfer)
        let return_amount = unstake_request.amount;
        
        // Update global tracking
        let mut total_staked: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap();
        total_staked -= return_amount;
        env.storage().instance().set(&DataKey::TotalStaked, &total_staked);
        
        let mut total_oracles: u32 = env.storage().instance().get(&DataKey::TotalOracles).unwrap();
        if total_oracles > 0 {
            total_oracles -= 1;
            env.storage().instance().set(&DataKey::TotalOracles, &total_oracles);
        }
        
        // Remove from oracle list
        let mut oracle_list: Vec<Address> = env.storage().instance().get(&DataKey::OracleList).unwrap();
        let mut new_list = Vec::new(&env);
        for addr in oracle_list.iter() {
            if addr != oracle {
                new_list.push_back(addr);
            }
        }
        env.storage().instance().set(&DataKey::OracleList, &new_list);
        
        // Remove from leaderboard
        Self::remove_from_leaderboard(&env, oracle.clone());
        
        // Clean up storage
        env.storage().persistent().remove(&DataKey::UnstakeRequest(oracle.clone()));
        env.storage().persistent().remove(&DataKey::StakeInfo(oracle.clone()));
        env.storage().persistent().remove(&DataKey::Rewards(oracle.clone()));
        
        // Emit claim event
        env.events().publish(
            (symbol_short!("unstake_ok"), oracle.clone()),
            return_amount,
        );
        
        Ok(return_amount)
    }

    /// Claim accumulated rewards
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `oracle` - Oracle address
    /// 
    /// # Returns
    /// 
    /// * `Ok(i128)` - Total rewards claimed
    /// * `Err(CommonError)` - If no rewards to claim
    pub fn claim_rewards(env: Env, oracle: Address) -> Result<i128, CommonError> {
        // Verify oracle authorization
        oracle.require_auth();
        
        // Check if rewards are enabled
        let gov_config: GovernanceConfig = env.storage().instance().get(&DataKey::GovernanceConfig).unwrap();
        if !gov_config.rewards_enabled {
            return Err(CommonError::NotAuthorized);
        }
        
        // Get reward info
        let mut reward_info: RewardInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(oracle.clone()))
            .ok_or(CommonError::KeyNotFound)?;
        
        // Calculate pending rewards
        let pending = Self::calculate_pending_rewards(&env, &oracle, &reward_info)?;
        let total_claimable = reward_info.accumulated + pending;
        
        if total_claimable == 0 {
            return Err(CommonError::OutOfRange); // No rewards to claim
        }
        
        // Transfer rewards (mock - in production would use token transfer)
        let claim_amount = total_claimable;
        
        // Update reward tracking
        reward_info.claimed += claim_amount;
        reward_info.accumulated = 0;
        reward_info.pending = 0;
        env.storage().persistent().set(&DataKey::Rewards(oracle.clone()), &reward_info);
        
        // Emit claim event
        env.events().publish(
            (symbol_short!("reward_clm"), oracle.clone()),
            claim_amount,
        );
        
        Ok(claim_amount)
    }

    /// Slash an oracle for misbehavior
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `oracle` - Oracle address to slash
    /// * `reason` - Reason code for slashing
    /// * `percent_bps` - Slash percentage in basis points
    /// * `reporter` - Address reporting the misbehavior (optional)
    /// 
    /// # Returns
    /// 
    /// * `Ok(SlashRecord)` - Slash record
    /// * `Err(CommonError)` - If slashing not enabled or invalid parameters
    pub fn slash(
        env: Env,
        oracle: Address,
        reason: Symbol,
        percent_bps: u32,
        reporter: Option<Address>,
    ) -> Result<SlashRecord, CommonError> {
        // Check if slashing is enabled
        let gov_config: GovernanceConfig = env.storage().instance().get(&DataKey::GovernanceConfig).unwrap();
        if !gov_config.slashing_enabled {
            return Err(CommonError::NotAuthorized);
        }
        
        // Validate slash percentage
        let max_slash: u32 = env.storage().instance().get(&DataKey::MaliciousSlashMaxPercent).unwrap();
        if percent_bps > max_slash {
            return Err(CommonError::OutOfRange);
        }
        
        // Get stake info
        let mut stake_info: StakeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::StakeInfo(oracle.clone()))
            .ok_or(CommonError::KeyNotFound)?;
        
        // Check if oracle is active
        if stake_info.status != OracleStatus::Active && stake_info.status != OracleStatus::Slashed {
            return Err(CommonError::NotAuthorized);
        }
        
        // Calculate slash amount
        let slash_amount = (stake_info.amount * percent_bps as i128) / 10000;
        
        // Apply slash
        stake_info.amount -= slash_amount;
        stake_info.status = OracleStatus::Slashed;
        stake_info.reputation = stake_info.reputation.saturating_sub(50); // Reduce reputation
        
        // Update tier if stake decreased
        if stake_info.amount > 0 {
            stake_info.tier = Self::calculate_tier(&env, stake_info.amount);
        }
        
        // Store updated stake info
        env.storage().persistent().set(&DataKey::StakeInfo(oracle.clone()), &stake_info);
        
        // Burn slashed amount (reduce total staked)
        let mut total_staked: i128 = env.storage().instance().get(&DataKey::TotalStaked).unwrap();
        total_staked -= slash_amount;
        env.storage().instance().set(&DataKey::TotalStaked, &total_staked);
        
        // Create slash record
        let slash_record = SlashRecord {
            oracle: oracle.clone(),
            slashed_amount: slash_amount,
            reason,
            timestamp: env.ledger().timestamp(),
            reported_by: reporter.clone(),
        };
        
        // Store slash record
        env.storage().persistent().set(&DataKey::SlashEvent(oracle.clone()), &slash_record);
        
        // Update leaderboard
        Self::update_leaderboard(&env, oracle.clone(), stake_info.amount, stake_info.reputation, stake_info.tier);
        
        // Distribute bounty to reporter (if any)
        if let Some(reporter_addr) = reporter {
            let bounty = slash_amount / 10; // 10% bounty
            if bounty > 0 {
                // Mock transfer to reporter
                env.events().publish(
                    (symbol_short!("slash_bnty"), reporter_addr),
                    bounty,
                );
            }
        }
        
        // Emit slash event
        env.events().publish(
            (symbol_short!("slash"), oracle.clone()),
            (slash_amount, slash_amount),
        );

        // Compliance audit log – StakeRemoved (fund movement / slashing)
        if ComplianceLogger::is_initialized(&env) {
            let old_bytes = Bytes::from_slice(&env, &(stake_info.amount + slash_amount).to_le_bytes());
            let new_bytes = Bytes::from_slice(&env, &stake_info.amount.to_le_bytes());
            let oracle_str: soroban_sdk::String = oracle.clone().to_string();
            let target_bytes = Bytes::from_slice(&env, oracle_str.as_bytes());
            let actor = reporter.clone().unwrap_or(oracle.clone());
            ComplianceLogger::append(
                &env,
                actor,
                ComplianceAction::StakeRemoved,
                target_bytes,
                old_bytes,
                new_bytes,
                BytesN::from_array(&env, &[0u8; 32]),
            );
        }

        Ok(slash_record)
    }

    /// Report oracle offline for slashing consideration
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `oracle` - Oracle address
    /// * `offline_hours` - Hours the oracle has been offline
    /// 
    /// # Returns
    /// 
    /// * `Ok(SlashRecord)` - Slash record if slashed
    /// * `Err(CommonError)` - If threshold not met
    pub fn report_offline(
        env: Env,
        oracle: Address,
        offline_hours: u64,
    ) -> Result<SlashRecord, CommonError> {
        // Check minimum threshold
        let threshold: u64 = env.storage().instance().get(&DataKey::OfflineThresholdHours).unwrap();
        if offline_hours < threshold {
            return Err(CommonError::OutOfRange); // Not offline long enough
        }
        
        // Get slash percentage
        let slash_percent: u32 = env.storage().instance().get(&DataKey::OfflineSlashPercent).unwrap();
        
        // Perform slash
        Self::slash(
            env.clone(),
            oracle.clone(),
            symbol_short!("offline"),
            slash_percent,
            None,
        )
    }

    /// Report false data provided by oracle
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `oracle` - Oracle address
    /// * `evidence` - Evidence of false data
    /// * `reporter` - Reporter address
    /// 
    /// # Returns
    /// 
    /// * `Ok(SlashRecord)` - Slash record
    /// * `Err(CommonError)` - If verification fails
    pub fn report_false_data(
        env: Env,
        oracle: Address,
        evidence: Symbol,
        reporter: Address,
    ) -> Result<SlashRecord, CommonError> {
        // Verify reporter authorization
        reporter.require_auth();
        
        // Get slash percentage for false data
        let slash_percent: u32 = env.storage().instance().get(&DataKey::FalseDataSlashPercent).unwrap();
        
        // Perform slash
        Self::slash(
            env.clone(),
            oracle.clone(),
            symbol_short!("false_dt"),
            slash_percent,
            Some(reporter.clone()),
        )
    }

    /// Record accurate data submission (for rewards calculation)
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `oracle` - Oracle address
    /// * `accuracy_score` - Accuracy percentage (0-100)
    pub fn record_submission(
        env: Env,
        oracle: Address,
        accuracy_score: u32,
    ) -> Result<(), CommonError> {
        // Verify oracle authorization
        oracle.require_auth();
        
        // Get stake info
        let mut stake_info: StakeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::StakeInfo(oracle.clone()))
            .ok_or(CommonError::KeyNotFound)?;
        
        // Update submission tracking
        if accuracy_score >= 99 {
            stake_info.accurate_submissions += 1;
            stake_info.inaccurate_submissions = 0; // Reset streak
        } else if accuracy_score < 95 {
            stake_info.inaccurate_submissions += 1;
            stake_info.accurate_submissions = 0; // Reset streak
        }
        
        // Update reputation
        if accuracy_score >= 99 {
            stake_info.reputation = stake_info.reputation.saturating_add(1);
        } else if accuracy_score < 95 {
            stake_info.reputation = stake_info.reputation.saturating_sub(5);
        }
        
        // Store updated stake info
        env.storage().persistent().set(&DataKey::StakeInfo(oracle.clone()), &stake_info);
        
        // Update rewards
        Self::update_rewards(&env, &oracle, &stake_info, accuracy_score)?;
        
        // Update leaderboard
        Self::update_leaderboard(&env, oracle.clone(), stake_info.amount, stake_info.reputation, stake_info.tier);
        
        // Emit event
        env.events().publish(
            (symbol_short!("submission"), oracle.clone()),
            (accuracy_score, stake_info.reputation),
        );
        
        Ok(())
    }

    /// Get stake info for an oracle
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `oracle` - Oracle address
    /// 
    /// # Returns
    /// 
    /// * `Ok(StakeInfo)` - Stake information
    /// * `Err(CommonError)` - If oracle not found
    pub fn get_stake_info(env: Env, oracle: Address) -> Result<StakeInfo, CommonError> {
        env.storage()
            .persistent()
            .get(&DataKey::StakeInfo(oracle))
            .ok_or(CommonError::KeyNotFound)
    }

    /// Get reward info for an oracle
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `oracle` - Oracle address
    /// 
    /// # Returns
    /// 
    /// * `Ok(RewardInfo)` - Reward information
    /// * `Err(CommonError)` - If oracle not found
    pub fn get_reward_info(env: Env, oracle: Address) -> Result<RewardInfo, CommonError> {
        env.storage()
            .persistent()
            .get(&DataKey::Rewards(oracle))
            .ok_or(CommonError::KeyNotFound)
    }

    /// Get leaderboard
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `limit` - Number of entries to return
    /// 
    /// # Returns
    /// 
    /// * `Leaderboard` - Top stakers and reputation leaders
    pub fn get_leaderboard(env: Env, limit: u32) -> Leaderboard {
        let total: u32 = env.storage().instance().get(&DataKey::TotalOracles).unwrap_or(0);
        
        // Get top stakes (sorted by amount - mock implementation)
        let mut top_stakes = Vec::new(&env);
        let oracle_list: Vec<Address> = env.storage().instance().get(&DataKey::OracleList).unwrap_or_else(|| Vec::new(&env));
        
        let mut entries = Vec::new(&env);
        for oracle in oracle_list.iter() {
            if let Ok(stake_info) = Self::get_stake_info(env.clone(), oracle.clone()) {
                entries.push_back(OracleEntry {
                    oracle,
                    stake: stake_info.amount,
                    reputation: stake_info.reputation,
                    tier: stake_info.tier,
                });
            }
        }
        
        // Sort by stake (descending) - simple bubble sort for demo
        let len = entries.len();
        for i in 0..len {
            for j in 0..len - i - 1 {
                if let (Some(a), Some(b)) = (entries.get(j), entries.get(j + 1)) {
                    if a.stake < b.stake {
                        let temp = entries.get(j).unwrap();
                        entries.set(j, b);
                        entries.set(j + 1, temp);
                    }
                }
            }
        }
        
        // Take top N
        let take = if limit < entries.len() { limit } else { entries.len() };
        for i in 0..take {
            if let Some(entry) = entries.get(i) {
                top_stakes.push_back(entry);
            }
        }
        
        // Sort by reputation (descending)
        let mut top_rep = Vec::new(&env);
        for i in 0..len {
            for j in 0..len - i - 1 {
                if let (Some(a), Some(b)) = (entries.get(j), entries.get(j + 1)) {
                    if a.reputation < b.reputation {
                        let temp = entries.get(j).unwrap();
                        entries.set(j, b);
                        entries.set(j + 1, temp);
                    }
                }
            }
        }
        
        for i in 0..take {
            if let Some(entry) = entries.get(i) {
                top_rep.push_back(entry);
            }
        }
        
        Leaderboard {
            top_stakes,
            top_reputation: top_rep,
            total_count: total,
        }
    }

    /// Get total staked amount
    pub fn get_total_staked(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalStaked).unwrap_or(0)
    }

    /// Get total number of oracles
    pub fn get_total_oracles(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::TotalOracles).unwrap_or(0)
    }

    /// Update governance configuration (admin only)
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `admin` - Admin address
    /// * `config` - New governance configuration
    pub fn update_governance(
        env: Env,
        admin: Address,
        config: GovernanceConfig,
    ) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::GovernanceConfig, &config);
        
        env.events().publish(
            (symbol_short!("gov_upd"), admin),
            symbol_short!("updated"),
        );
        
        Ok(())
    }

    /// Update reward rate (admin only)
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `admin` - Admin address
    /// * `new_rate` - New base reward rate
    pub fn update_reward_rate(
        env: Env,
        admin: Address,
        new_rate: i128,
    ) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::BaseRewardRate, &new_rate);
        
        env.events().publish(
            (symbol_short!("rate_upd"), admin),
            new_rate,
        );
        
        Ok(())
    }

    /// Update slashing parameters (admin only)
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `admin` - Admin address
    /// * `offline_bps` - Offline slash percentage
    /// * `false_data_bps` - False data slash percentage
    /// * `malicious_max_bps` - Maximum malicious slash percentage
    pub fn update_slashing_params(
        env: Env,
        admin: Address,
        offline_bps: u32,
        false_data_bps: u32,
        malicious_max_bps: u32,
    ) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;
        
        // Validate parameters
        if offline_bps > 10000 || false_data_bps > 10000 || malicious_max_bps > 10000 {
            return Err(CommonError::OutOfRange);
        }
        
        env.storage().instance().set(&DataKey::OfflineSlashPercent, &offline_bps);
        env.storage().instance().set(&DataKey::FalseDataSlashPercent, &false_data_bps);
        env.storage().instance().set(&DataKey::MaliciousSlashMaxPercent, &malicious_max_bps);
        
        env.events().publish(
            (symbol_short!("slash_upd"), admin),
            symbol_short!("updated"),
        );
        
        Ok(())
    }

    // ========================================================================
    // Internal Helper Functions
    // ========================================================================

    /// Calculate oracle tier based on stake amount
    fn calculate_tier(env: &Env, amount: i128) -> OracleTier {
        let tier1: i128 = env.storage().instance().get(&DataKey::Tier1Threshold).unwrap();
        let tier2: i128 = env.storage().instance().get(&DataKey::Tier2Threshold).unwrap();
        let tier3: i128 = env.storage().instance().get(&DataKey::Tier3Threshold).unwrap();
        
        if amount >= tier3 {
            OracleTier::Platinum
        } else if amount >= tier2 {
            OracleTier::Gold
        } else if amount >= tier1 {
            OracleTier::Silver
        } else {
            OracleTier::Bronze
        }
    }

    /// Calculate pending rewards for an oracle
    fn calculate_pending_rewards(
        env: &Env,
        oracle: &Address,
        reward_info: &RewardInfo,
    ) -> Result<i128, CommonError> {
        let stake_info: StakeInfo = env
            .storage()
            .persistent()
            .get(&DataKey::StakeInfo(oracle.clone()))
            .ok_or(CommonError::KeyNotFound)?;
        
        let base_rate: i128 = env.storage().instance().get(&DataKey::BaseRewardRate).unwrap();
        let current_time = env.ledger().timestamp();
        let time_elapsed = current_time - reward_info.last_reward_at;
        let days_elapsed = time_elapsed / SECONDS_PER_DAY;
        
        if days_elapsed == 0 {
            return Ok(0);
        }
        
        // Calculate base rewards
        let mut rewards = base_rate * days_elapsed as i128;
        
        // Apply tier bonus
        let tier_bonus = match stake_info.tier {
            OracleTier::Bronze => 0,
            OracleTier::Silver => 500, // 5%
            OracleTier::Gold => 1500,  // 15%
            OracleTier::Platinum => 3000, // 30%
        };
        rewards = rewards + (rewards * tier_bonus as i128) / 10000;
        
        // Apply quality bonus/penalty based on recent submissions
        let total_submissions = stake_info.accurate_submissions + stake_info.inaccurate_submissions;
        if total_submissions > 0 {
            let accuracy = (stake_info.accurate_submissions * 100) / total_submissions;
            
            let quality_threshold_high: u32 = env.storage().instance().get(&DataKey::AccuracyThresholdHigh).unwrap();
            let quality_threshold_low: u32 = env.storage().instance().get(&DataKey::AccuracyThresholdLow).unwrap();
            let quality_bonus: u32 = env.storage().instance().get(&DataKey::QualityBonusPercent).unwrap();
            let penalty: u32 = env.storage().instance().get(&DataKey::PenaltyPercent).unwrap();
            
            if accuracy >= quality_threshold_high {
                // Quality bonus
                rewards = rewards + (rewards * quality_bonus as i128) / 10000;
            } else if accuracy < quality_threshold_low {
                // Penalty
                rewards = rewards - (rewards * penalty as i128) / 10000;
            }
        }
        
        // Ensure non-negative
        if rewards < 0 {
            rewards = 0;
        }
        
        Ok(rewards)
    }

    /// Update rewards for an oracle
    fn update_rewards(
        env: &Env,
        oracle: &Address,
        stake_info: &StakeInfo,
        accuracy_score: u32,
    ) -> Result<(), CommonError> {
        let mut reward_info: RewardInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(oracle.clone()))
            .ok_or(CommonError::KeyNotFound)?;
        
        let pending = Self::calculate_pending_rewards(env, oracle, &reward_info)?;
        reward_info.pending = pending;
        reward_info.last_reward_at = env.ledger().timestamp();
        
        // Update total earned
        reward_info.total_rewards_earned += pending;
        
        env.storage().persistent().set(&DataKey::Rewards(oracle.clone()), &reward_info);
        
        Ok(())
    }

    /// Process final rewards before unstaking
    fn process_final_rewards(
        env: &Env,
        oracle: &Address,
        stake_info: &StakeInfo,
    ) -> Result<(), CommonError> {
        let mut reward_info: RewardInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(oracle.clone()))
            .ok_or(CommonError::KeyNotFound)?;
        
        let pending = Self::calculate_pending_rewards(env, oracle, &reward_info)?;
        reward_info.accumulated += pending;
        reward_info.pending = 0;
        
        env.storage().persistent().set(&DataKey::Rewards(oracle.clone()), &reward_info);
        
        Ok(())
    }

    /// Update leaderboard entry
    fn update_leaderboard(
        env: &Env,
        oracle: Address,
        stake: i128,
        reputation: u32,
        tier: OracleTier,
    ) {
        // In production, this would maintain a sorted data structure
        // For now, we'll just store individual entries that can be queried
        let entry = OracleEntry {
            oracle,
            stake,
            reputation,
            tier,
        };
        env.storage().persistent().set(&DataKey::TopStakers, &entry);
    }

    /// Remove from leaderboard
    fn remove_from_leaderboard(env: &Env, oracle: Address) {
        // In production, remove from sorted structure
        // For now, this is a no-op as leaderboard is rebuilt on query
    }

    /// Require admin authorization
    fn require_admin(env: &Env, admin: &Address) -> Result<(), CommonError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CommonError::NotInitialized)?;
        
        if stored_admin != *admin {
            return Err(CommonError::NotAuthorized);
        }
        
        admin.require_auth();
        Ok(())
    }
}
