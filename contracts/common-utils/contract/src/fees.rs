#![no_std]

use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FeeType {
    Service = 1,
    Data = 2,
    Usage = 3,
    Membership = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeConfig {
    pub base_fee_bps: u32, // Basis points (1 bps = 0.01%)
    pub premium_tier_bps: u32,
    pub data_fee_fixed: i128,
}

impl Default for FeeConfig {
    fn default() -> Self {
        Self {
            base_fee_bps: 10,    // 0.1%
            premium_tier_bps: 5, // 0.05%
            data_fee_fixed: 100_0000000, // Fixed cost for data (example unit)
        }
    }
}

pub struct FeeModule;

impl FeeModule {
    pub fn calculate_service_fee(env: &Env, amount: i128, is_premium: bool) -> i128 {
        let config = Self::get_config(env);
        let bps = if is_premium {
            config.premium_tier_bps
        } else {
            config.base_fee_bps
        };

        // Fee = (amount * bps) / 10000
        (amount * bps as i128) / 10000
    }

    pub fn get_data_fee(env: &Env) -> i128 {
        let config = Self::get_config(env);
        config.data_fee_fixed
    }

    pub fn is_whitelisted(env: &Env, address: &Address) -> bool {
        let key = (soroban_sdk::symbol_short!("fee_wl"), address.clone());
        env.storage().persistent().has(&key)
    }

    pub fn set_whitelisted(env: &Env, address: &Address, whitelisted: bool) {
        let key = (soroban_sdk::symbol_short!("fee_wl"), address.clone());
        if whitelisted {
            env.storage().persistent().set(&key, &true);
        } else {
            env.storage().persistent().remove(&key);
        }
    }

    pub fn get_config(env: &Env) -> FeeConfig {
        env.storage()
            .persistent()
            .get(&soroban_sdk::symbol_short!("f_conf"))
            .unwrap_or_else(|| FeeConfig::default())
    }

    pub fn set_config(env: &Env, config: &FeeConfig) {
        env.storage()
            .persistent()
            .set(&soroban_sdk::symbol_short!("f_conf"), config);
    }
}
