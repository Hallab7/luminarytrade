#![no_std]

use soroban_sdk::{contracttype, Address, Env, Map, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TreasuryPool {
    Ecosystem = 1,
    OraclePool = 2,
    Governance = 3,
}

pub struct TreasuryModule;

impl TreasuryModule {
    pub fn collect_and_distribute(env: &Env, user: &Address, amount: i128) {
        if amount == 0 {
            return;
        }

        Self::track_user_fee(env, user, amount);

        // 60% Ecosystem
        let eco_amount = (amount * 60) / 100;
        // 30% Oracle Pool
        let oracle_amount = (amount * 30) / 100;
        // 10% Governance
        let gov_amount = amount - eco_amount - oracle_amount; // Ensure no rounding errors

        Self::add_to_pool(env, TreasuryPool::Ecosystem, eco_amount);
        Self::add_to_pool(env, TreasuryPool::OraclePool, oracle_amount);
        Self::add_to_pool(env, TreasuryPool::Governance, gov_amount);

        Self::track_daily_stats(env, amount);
    }

    pub fn get_pool_balance(env: &Env, pool: TreasuryPool) -> i128 {
        let key = (soroban_sdk::symbol_short!("t_pool"), pool);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    fn add_to_pool(env: &Env, pool: TreasuryPool, amount: i128) {
        let key = (soroban_sdk::symbol_short!("t_pool"), pool.clone());
        let current = Self::get_pool_balance(env, pool);
        env.storage().persistent().set(&key, &(current + amount));
    }

    pub fn track_oracle_earnings(env: &Env, oracle: &Address, amount: i128) {
        let key = (soroban_sdk::symbol_short!("o_earn"), oracle.clone());
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));
    }

    pub fn withdraw_oracle_fees(env: &Env, oracle: &Address) -> i128 {
        oracle.require_auth();
        let key = (soroban_sdk::symbol_short!("o_earn"), oracle.clone());
        let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        
        if amount > 0 {
            env.storage().persistent().set(&key, &0i128);
            // In a real scenario, this would transfer tokens from the contract to the oracle.
            // For now, we just update the internal accounting.
        }
        amount
    }

    fn track_daily_stats(env: &Env, amount: i128) {
        let day = env.ledger().timestamp() / 86400;
        let key = (soroban_sdk::symbol_short!("d_stat"), day);
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));
    }

    pub fn get_daily_fees(env: &Env, timestamp: u64) -> i128 {
        let day = timestamp / 86400;
        let key = (soroban_sdk::symbol_short!("d_stat"), day);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    fn track_user_fee(env: &Env, user: &Address, amount: i128) {
        let key = (soroban_sdk::symbol_short!("u_fee"), user.clone());
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(current + amount));
    }

    pub fn get_user_fees(env: &Env, user: &Address) -> i128 {
        let key = (soroban_sdk::symbol_short!("u_fee"), user.clone());
        env.storage().persistent().get(&key).unwrap_or(0)
    }
}
