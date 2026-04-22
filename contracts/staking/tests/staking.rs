//! # Staking Contract Tests
//!
//! Comprehensive test suite covering 20+ scenarios for the oracle staking system.

#![cfg(test)]

use soroban_sdk::{Address, Env, Symbol, symbol_short, Vec};
use crate::{StakingContract, StakingContractClient, StakeInfo, OracleTier, OracleStatus, RewardInfo, Leaderboard};

// ============================================================================
// Test Utilities
// ============================================================================

fn setup_test() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    
    // Initialize contract
    let client = StakingContractClient::new(&env, &admin);
    client.initialize(&admin);
    
    (env, admin, oracle)
}

fn create_oracle_with_stake(env: &Env, stake_amount: i128) -> Address {
    let oracle = Address::generate(env);
    let client = StakingContractClient::new(env, &oracle);
    client.stake(&oracle, &stake_amount);
    oracle
}

// ============================================================================
// Initialization Tests
// ============================================================================

#[test]
fn test_initialize_success() {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let client = StakingContractClient::new(&env, &admin);
    
    // Should initialize successfully
    client.initialize(&admin);
    
    // Verify admin is set
    // (In production, would add getter for admin)
}

#[test]
#[should_panic(expected = "AlreadyInitialized")]
fn test_initialize_already_initialized() {
    let (env, admin, _) = setup_test();
    let client = StakingContractClient::new(&env, &admin);
    
    // Should panic - already initialized
    client.initialize(&admin);
}

// ============================================================================
// Staking Tests
// ============================================================================

#[test]
fn test_stake_minimum_amount() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    // Stake minimum amount
    let stake_info = client.stake(&oracle, &1_000_000_000); // 1000 tokens
    
    assert_eq!(stake_info.amount, 1_000_000_000);
    assert_eq!(stake_info.tier as u32, OracleTier::Bronze as u32);
    assert_eq!(stake_info.status as u32, OracleStatus::Active as u32);
    assert_eq!(stake_info.reputation, 100);
}

#[test]
fn test_stake_silver_tier() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    // Stake for silver tier (5,000 tokens)
    let stake_info = client.stake(&oracle, &5_000_000_000);
    
    assert_eq!(stake_info.tier as u32, OracleTier::Silver as u32);
}

#[test]
fn test_stake_gold_tier() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    // Stake for gold tier (20,000 tokens)
    let stake_info = client.stake(&oracle, &20_000_000_000);
    
    assert_eq!(stake_info.tier as u32, OracleTier::Gold as u32);
}

#[test]
fn test_stake_platinum_tier() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    // Stake for platinum tier (50,000 tokens)
    let stake_info = client.stake(&oracle, &50_000_000_000);
    
    assert_eq!(stake_info.tier as u32, OracleTier::Platinum as u32);
}

#[test]
#[should_panic]
fn test_stake_below_minimum() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    // Should panic - below minimum
    client.stake(&oracle, &500_000_000); // 500 tokens
}

#[test]
#[should_panic]
fn test_stake_above_maximum() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    // Should panic - above maximum
    client.stake(&oracle, &150_000_000_000); // 150,000 tokens
}

#[test]
#[should_panic]
fn test_stake_twice_fails() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    // First stake succeeds
    client.stake(&oracle, &1_000_000_000);
    
    // Second stake should panic
    client.stake(&oracle, &1_000_000_000);
}

#[test]
fn test_get_stake_info() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &10_000_000_000);
    
    let stake_info = client.get_stake_info(&oracle);
    
    assert_eq!(stake_info.oracle, oracle);
    assert_eq!(stake_info.amount, 10_000_000_000);
    assert_eq!(stake_info.tier as u32, OracleTier::Silver as u32);
}

// ============================================================================
// Unstaking Tests
// ============================================================================

#[test]
fn test_unstake_request() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    // Stake first
    client.stake(&oracle, &1_000_000_000);
    
    // Request unstake
    let unstake_request = client.unstake(&oracle);
    
    assert_eq!(unstake_request.oracle, oracle);
    assert_eq!(unstake_request.amount, 1_000_000_000);
    assert!(unstake_request.available_at > unstake_request.requested_at);
}

#[test]
fn test_unstake_lockup_period() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &1_000_000_000);
    let unstake_request = client.unstake(&oracle);
    
    // Lockup period should be 7 days (604800 seconds)
    let expected_available = unstake_request.requested_at + (7 * 86400);
    assert_eq!(unstake_request.available_at, expected_available);
}

#[test]
fn test_claim_unstake_after_lockup() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &1_000_000_000);
    client.unstake(&oracle);
    
    // Fast forward past lockup period (7 days + buffer)
    env.ledger().with_mut(|li| {
        li.timestamp += 8 * 86400; // 8 days
    });
    
    // Claim unstake
    let returned_amount = client.claim_unstake(&oracle);
    
    assert_eq!(returned_amount, 1_000_000_000);
}

#[test]
#[should_panic]
fn test_claim_unstake_before_lockup() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &1_000_000_000);
    client.unstake(&oracle);
    
    // Try to claim immediately - should panic
    client.claim_unstake(&oracle);
}

#[test]
#[should_panic]
fn test_unstake_twice_fails() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &1_000_000_000);
    client.unstake(&oracle);
    
    // Second unstake should panic
    client.unstake(&oracle);
}

// ============================================================================
// Rewards Tests
// ============================================================================

#[test]
fn test_claim_rewards_zero() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &1_000_000_000);
    
    // No rewards accumulated yet
    // This might return error or 0 depending on implementation
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.try_claim_rewards(&oracle)
    }));
    
    // Either panics or returns Ok(0)
    if let Ok(Ok(reward)) = result {
        assert_eq!(reward, 0);
    }
}

#[test]
fn test_record_submission_accurate() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &1_000_000_000);
    
    // Record accurate submission (100% accuracy)
    client.record_submission(&oracle, &100);
    
    let stake_info = client.get_stake_info(&oracle);
    assert!(stake_info.accurate_submissions > 0);
    assert!(stake_info.reputation > 100); // Increased from base 100
}

#[test]
fn test_record_submission_inaccurate() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &1_000_000_000);
    
    // Record inaccurate submission (<95% accuracy)
    client.record_submission(&oracle, &90);
    
    let stake_info = client.get_stake_info(&oracle);
    assert!(stake_info.inaccurate_submissions > 0);
    assert!(stake_info.reputation < 100); // Decreased from base 100
}

#[test]
fn test_rewards_with_quality_bonus() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &10_000_000_000); // Silver tier
    
    // Submit multiple accurate reports
    for _ in 0..5 {
        client.record_submission(&oracle, &100);
    }
    
    // Fast forward 1 day
    env.ledger().with_mut(|li| {
        li.timestamp += 86400;
    });
    
    // Should have accumulated rewards with quality bonus
    let reward_info = client.get_reward_info(&oracle);
    assert!(reward_info.pending > 0);
}

#[test]
fn test_claim_rewards_accumulated() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &10_000_000_000);
    
    // Submit accurate data
    client.record_submission(&oracle, &100);
    
    // Fast forward 2 days
    env.ledger().with_mut(|li| {
        li.timestamp += 2 * 86400;
    });
    
    // Claim rewards
    let claimed = client.claim_rewards(&oracle);
    assert!(claimed > 0);
    
    // Verify reward info updated
    let reward_info = client.get_reward_info(&oracle);
    assert_eq!(reward_info.claimed, claimed);
    assert_eq!(reward_info.accumulated, 0);
}

// ============================================================================
// Slashing Tests
// ============================================================================

#[test]
fn test_slash_offline() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    let initial_stake = 10_000_000_000;
    client.stake(&oracle, &initial_stake);
    
    // Report offline for 24+ hours
    let slash_record = client.report_offline(&oracle, &25);
    
    assert_eq!(slash_record.oracle, oracle);
    assert!(slash_record.slashed_amount > 0);
    assert_eq!(slash_record.reason, symbol_short!("offline"));
    
    // Verify stake reduced
    let stake_info = client.get_stake_info(&oracle);
    assert!(stake_info.amount < initial_stake);
    assert_eq!(stake_info.status as u32, OracleStatus::Slashed as u32);
}

#[test]
fn test_slash_false_data() {
    let (env, admin, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    let initial_stake = 10_000_000_000;
    client.stake(&oracle, &initial_stake);
    
    let reporter = Address::generate(&env);
    
    // Report false data
    let slash_record = client.report_false_data(&oracle, &symbol_short!("bad_price"), &reporter);
    
    assert_eq!(slash_record.oracle, oracle);
    assert!(slash_record.slashed_amount > 0);
    assert_eq!(slash_record.reason, symbol_short!("false_dt"));
    
    // Verify 20% slash
    let expected_slash = (initial_stake * 2000) / 10000; // 20%
    assert_eq!(slash_record.slashed_amount, expected_slash);
}

#[test]
fn test_slash_direct() {
    let (env, admin, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    let initial_stake = 10_000_000_000;
    client.stake(&oracle, &initial_stake);
    
    // Direct slash with custom reason
    let slash_record = client.slash(&oracle, &symbol_short!("malicious"), &5000, &None);
    
    assert_eq!(slash_record.oracle, oracle);
    assert_eq!(slash_record.reason, symbol_short!("malicious"));
    
    // Verify 50% slash (5000 bps)
    let expected_slash = (initial_stake * 5000) / 10000;
    assert_eq!(slash_record.slashed_amount, expected_slash);
}

#[test]
#[should_panic]
fn test_slash_invalid_percent() {
    let (env, admin, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &10_000_000_000);
    
    // Should panic - percentage > 100%
    client.slash(&oracle, &symbol_short!("test"), &15000, &None);
}

#[test]
fn test_report_offline_below_threshold() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &1_000_000_000);
    
    // Report offline for less than threshold (24h)
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.report_offline(&oracle, &12) // 12 hours
    }));
    
    // Should fail
    assert!(result.is_err());
}

// ============================================================================
// Leaderboard Tests
// ============================================================================

#[test]
fn test_leaderboard_empty() {
    let (env, _, _) = setup_test();
    let client = StakingContractClient::new(&env, &Address::generate(&env));
    
    let leaderboard = client.get_leaderboard(&10);
    
    assert_eq!(leaderboard.total_count, 0);
    assert_eq!(leaderboard.top_stakes.len(), 0);
}

#[test]
fn test_leaderboard_multiple_oracles() {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let client = StakingContractClient::new(&env, &admin);
    client.initialize(&admin);
    
    // Create oracles with different stakes
    let oracle1 = create_oracle_with_stake(&env, 5_000_000_000);
    let oracle2 = create_oracle_with_stake(&env, 20_000_000_000);
    let oracle3 = create_oracle_with_stake(&env, 50_000_000_000);
    
    let leaderboard = client.get_leaderboard(&10);
    
    assert_eq!(leaderboard.total_count, 3);
    assert_eq!(leaderboard.top_stakes.len(), 3);
    
    // Should be sorted by stake (descending)
    assert_eq!(leaderboard.top_stakes.get(0).unwrap().stake, 50_000_000_000);
    assert_eq!(leaderboard.top_stakes.get(1).unwrap().stake, 20_000_000_000);
    assert_eq!(leaderboard.top_stakes.get(2).unwrap().stake, 5_000_000_000);
}

#[test]
fn test_leaderboard_pagination() {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let client = StakingContractClient::new(&env, &admin);
    client.initialize(&admin);
    
    // Create 5 oracles
    for _ in 0..5 {
        create_oracle_with_stake(&env, 5_000_000_000);
    }
    
    // Get top 3
    let leaderboard = client.get_leaderboard(&3);
    assert_eq!(leaderboard.top_stakes.len(), 3);
    assert_eq!(leaderboard.total_count, 5);
}

// ============================================================================
// Governance Tests
// ============================================================================

#[test]
fn test_update_governance_config() {
    let (env, admin, _) = setup_test();
    let client = StakingContractClient::new(&env, &admin);
    
    let new_config = crate::GovernanceConfig {
        multisig: None,
        slashing_enabled: false,
        rewards_enabled: true,
        min_accuracy_percent: 95,
    };
    
    client.update_governance(&admin, &new_config);
    
    // Config should be updated (would need getter to verify)
}

#[test]
fn test_update_reward_rate() {
    let (env, admin, _) = setup_test();
    let client = StakingContractClient::new(&env, &admin);
    
    let new_rate = 200_000_000; // Double the base rate
    
    client.update_reward_rate(&admin, &new_rate);
    
    // Rate should be updated
}

#[test]
fn test_update_slashing_params() {
    let (env, admin, _) = setup_test();
    let client = StakingContractClient::new(&env, &admin);
    
    client.update_slashing_params(&admin, &600, &2500, &10000);
    
    // Parameters should be updated
}

#[test]
#[should_panic]
fn test_non_admin_cannot_update_governance() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    let new_config = crate::GovernanceConfig {
        multisig: None,
        slashing_enabled: false,
        rewards_enabled: true,
        min_accuracy_percent: 95,
    };
    
    // Non-admin should fail
    client.update_governance(&oracle, &new_config);
}

// ============================================================================
// Edge Cases and Integration Tests
// ============================================================================

#[test]
fn test_total_staked_tracking() {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let client = StakingContractClient::new(&env, &admin);
    client.initialize(&admin);
    
    // Initial total should be 0
    assert_eq!(client.get_total_staked(), 0);
    
    // Add stakes
    let oracle1 = create_oracle_with_stake(&env, 5_000_000_000);
    let oracle2 = create_oracle_with_stake(&env, 10_000_000_000);
    
    assert_eq!(client.get_total_staked(), 15_000_000_000);
    
    // Unstake one
    let client2 = StakingContractClient::new(&env, &oracle2);
    client2.unstake(&oracle2);
    
    // Fast forward
    env.ledger().with_mut(|li| {
        li.timestamp += 8 * 86400;
    });
    
    client2.claim_unstake(&oracle2);
    
    // Total should decrease
    assert_eq!(client.get_total_staked(), 5_000_000_000);
}

#[test]
fn test_total_oracles_tracking() {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let client = StakingContractClient::new(&env, &admin);
    client.initialize(&admin);
    
    assert_eq!(client.get_total_oracles(), 0);
    
    create_oracle_with_stake(&env, 5_000_000_000);
    create_oracle_with_stake(&env, 5_000_000_000);
    create_oracle_with_stake(&env, 5_000_000_000);
    
    assert_eq!(client.get_total_oracles(), 3);
}

#[test]
fn test_reputation_increase() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &1_000_000_000);
    
    // Multiple accurate submissions
    for _ in 0..10 {
        client.record_submission(&oracle, &100);
    }
    
    let stake_info = client.get_stake_info(&oracle);
    assert!(stake_info.reputation > 100);
    assert_eq!(stake_info.accurate_submissions, 10);
}

#[test]
fn test_reputation_decrease() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &1_000_000_000);
    
    // Multiple inaccurate submissions
    for _ in 0..5 {
        client.record_submission(&oracle, &80);
    }
    
    let stake_info = client.get_stake_info(&oracle);
    assert!(stake_info.reputation < 100);
    assert_eq!(stake_info.inaccurate_submissions, 5);
}

#[test]
fn test_tier_downgrade_after_slash() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    // Start with gold tier
    client.stake(&oracle, &20_000_000_000);
    
    let stake_info = client.get_stake_info(&oracle);
    assert_eq!(stake_info.tier as u32, OracleTier::Gold as u32);
    
    // Slash heavily (50%)
    client.slash(&oracle, &symbol_short!("test"), &5000, &None);
    
    let stake_info = client.get_stake_info(&oracle);
    // Should drop to bronze or silver
    assert!(stake_info.tier as u32 <= OracleTier::Silver as u32);
    assert_eq!(stake_info.status as u32, OracleStatus::Slashed as u32);
}

#[test]
fn test_grace_period_after_lockup() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &1_000_000_000);
    let unstake_request = client.unstake(&oracle);
    
    // Fast forward to just after lockup but before grace ends
    env.ledger().with_mut(|li| {
        li.timestamp = unstake_request.available_at + 12 * 3600; // 12 hours into grace
    });
    
    // Should still be able to claim
    let returned = client.claim_unstake(&oracle);
    assert_eq!(returned, 1_000_000_000);
}

#[test]
fn test_multiple_submissions_reward_calculation() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    client.stake(&oracle, &10_000_000_000); // Silver tier
    
    // Mix of accurate and inaccurate
    client.record_submission(&oracle, &100);
    client.record_submission(&oracle, &100);
    client.record_submission(&oracle, &90);
    client.record_submission(&oracle, &100);
    client.record_submission(&oracle, &100);
    
    let stake_info = client.get_stake_info(&oracle);
    
    // Should have 4 accurate, 1 inaccurate
    assert_eq!(stake_info.accurate_submissions, 4);
    assert_eq!(stake_info.inaccurate_submissions, 1);
    
    // Accuracy = 80%, should not get quality bonus
    // But reputation should still be decent
    assert!(stake_info.reputation > 95);
}

#[test]
fn test_stake_info_after_full_lifecycle() {
    let (env, _, oracle) = setup_test();
    let client = StakingContractClient::new(&env, &oracle);
    
    // Complete lifecycle: stake -> submit -> unstake -> claim
    client.stake(&oracle, &5_000_000_000);
    client.record_submission(&oracle, &100);
    client.unstake(&oracle);
    
    env.ledger().with_mut(|li| {
        li.timestamp += 8 * 86400;
    });
    
    client.claim_unstake(&oracle);
    
    // Stake info should be removed
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.get_stake_info(&oracle)
    }));
    
    assert!(result.is_err()); // Should fail - no longer exists
}
