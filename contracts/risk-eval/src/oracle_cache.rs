/// Oracle query cache — resolves #260 (Optimize Oracle Queries)
///
/// Caches oracle price/data results in Soroban instance storage with a
/// configurable TTL so repeated calls within the same ledger window skip
/// the cross-contract round-trip entirely.
use soroban_sdk::{contracttype, symbol_short, Address, Env, Symbol};

/// Default cache TTL in ledger-seconds (~5 minutes at 5 s/ledger).
const DEFAULT_TTL_SECS: u64 = 300;

#[contracttype]
#[derive(Clone)]
pub struct OracleEntry {
    pub value: i128,
    pub timestamp: u64,
}

#[contracttype]
pub enum OracleCacheKey {
    Entry(Symbol),
    Ttl,
}

pub struct OracleCache;

impl OracleCache {
    /// Store a value returned by an oracle call.
    pub fn set(env: &Env, key: Symbol, value: i128) {
        let entry = OracleEntry {
            value,
            timestamp: env.ledger().timestamp(),
        };
        env.storage()
            .instance()
            .set(&OracleCacheKey::Entry(key), &entry);
    }

    /// Return a cached value if it is still within TTL, otherwise `None`.
    pub fn get(env: &Env, key: Symbol) -> Option<i128> {
        let entry: OracleEntry = env
            .storage()
            .instance()
            .get(&OracleCacheKey::Entry(key))?;
        let ttl = Self::ttl(env);
        if env.ledger().timestamp().saturating_sub(entry.timestamp) <= ttl {
            Some(entry.value)
        } else {
            None
        }
    }

    /// Fetch from cache or call `fetch_fn`, cache the result, and return it.
    /// Emits a `oracle_hit` / `oracle_miss` event for observability.
    pub fn get_or_fetch<F>(env: &Env, key: Symbol, fetch_fn: F) -> i128
    where
        F: FnOnce() -> i128,
    {
        if let Some(cached) = Self::get(env, key.clone()) {
            env.events()
                .publish((symbol_short!("orc_hit"), key), cached);
            return cached;
        }
        let value = fetch_fn();
        Self::set(env, key.clone(), value);
        env.events()
            .publish((symbol_short!("orc_miss"), key), value);
        value
    }

    /// Override the default TTL (stored in instance storage).
    pub fn set_ttl(env: &Env, ttl_secs: u64) {
        env.storage()
            .instance()
            .set(&OracleCacheKey::Ttl, &ttl_secs);
    }

    fn ttl(env: &Env) -> u64 {
        env.storage()
            .instance()
            .get(&OracleCacheKey::Ttl)
            .unwrap_or(DEFAULT_TTL_SECS)
    }
}
