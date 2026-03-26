// contracts/fraud-detect/src/types.rs

use soroban_sdk::{contracttype, Address, Vec};

#[contracttype]
#[derive(Clone)]
pub struct Transaction {
    pub user: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct UserProfile {
    pub avg_amount: i128,
    pub tx_count: u32,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct FraudScore {
    pub total: u32,
    pub unusual_activity: u32,
    pub rapid_tx: u32,
    pub velocity: u32,
    pub blacklist: u32,
}