// contracts/fraud-detect/src/storage.rs

use soroban_sdk::{contracttype, Address};

#[contracttype]
pub enum FraudKey {
    Transactions(Address),
    Profile(Address),
    Blacklist(Address),
    Whitelist(Address),
    Config,
}