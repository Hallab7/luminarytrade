#![cfg(test)]

use crate::fees::{FeeModule, FeeConfig};
use crate::treasury::{TreasuryModule, TreasuryPool};
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_fee_calculation() {
    let env = Env::default();
    let amount = 10000;
    
    // Default 0.1% = 10 bps
    let fee = FeeModule::calculate_service_fee(&env, amount, false);
    assert_eq!(fee, 10);
    
    // Premium 0.05% = 5 bps
    let premium_fee = FeeModule::calculate_service_fee(&env, amount, true);
    assert_eq!(premium_fee, 5);
}

#[test]
fn test_treasury_distribution() {
    let env = Env::default();
    let amount = 1000;
    let user = Address::generate(&env);
    
    TreasuryModule::collect_and_distribute(&env, &user, amount);
    
    // 60% Ecosystem = 600
    assert_eq!(TreasuryModule::get_pool_balance(&env, TreasuryPool::Ecosystem), 600);
    // 30% Oracle = 300
    assert_eq!(TreasuryModule::get_pool_balance(&env, TreasuryPool::OraclePool), 300);
    // 10% Governance = 100
    assert_eq!(TreasuryModule::get_pool_balance(&env, TreasuryPool::Governance), 100);
}

#[test]
fn test_whitelist() {
    let env = Env::default();
    let user = Address::generate(&env);
    
    assert!(!FeeModule::is_whitelisted(&env, &user));
    
    FeeModule::set_whitelisted(&env, &user, true);
    assert!(FeeModule::is_whitelisted(&env, &user));
    
    FeeModule::set_whitelisted(&env, &user, false);
    assert!(!FeeModule::is_whitelisted(&env, &user));
}

#[test]
fn test_oracle_withdrawal() {
    let env = Env::default();
    let oracle = Address::generate(&env);
    
    TreasuryModule::track_oracle_earnings(&env, &oracle, 500);
    
    env.mock_all_auths();
    let withdrawn = TreasuryModule::withdraw_oracle_fees(&env, &oracle);
    assert_eq!(withdrawn, 500);
    
    let balance_after = TreasuryModule::track_oracle_earnings(&env, &oracle, 0); // Just to check
    // Actually withdrawals reset the internal tracking in my implementation
    let withdrawn_again = TreasuryModule::withdraw_oracle_fees(&env, &oracle);
    assert_eq!(withdrawn_again, 0);
}

#[test]
fn test_daily_stats() {
    let env = Env::default();
    let now = env.ledger().timestamp();
    let user = Address::generate(&env);
    
    TreasuryModule::collect_and_distribute(&env, &user, 100);
    TreasuryModule::collect_and_distribute(&env, &user, 200);
    
    assert_eq!(TreasuryModule::get_daily_fees(&env, now), 300);
    assert_eq!(TreasuryModule::get_user_fees(&env, &user), 300);
}
