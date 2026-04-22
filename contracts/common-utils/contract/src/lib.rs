#![no_std]

pub mod error;
pub mod marketplace;
pub mod marketplace_types;
pub mod oracle_bridge;
pub mod rate_limit;
pub mod timelock;
pub mod validator;
pub mod storage;
pub mod upgrade_registry;
pub mod upgrade_proxy;
pub mod migration;
pub mod state_machine;
pub mod dex;
pub mod fees;
pub mod treasury;
pub mod acl;
pub mod batch;
pub mod authorization;
pub mod compression;
pub mod storage_optimization;
pub mod storage_monitoring;
pub mod data_migration;
pub mod compliance_log;

pub use error::CommonError;
pub use state_machine::{State, StateMachine, FraudDetectState, RiskEvalState, CreditScoreState, state_guard, transition_to};

use soroban_sdk::{
    contract,
    contractimpl,
    Address,
    Env,
    BytesN,
    contracttype,
    symbol_short,
    Bytes,
    Vec,
    contracttype,
    BytesN,
    IntoVal,
};

#[contracttype]
pub enum DataKey {
    Admin,
    TrustedBridge,
    AgentLevel(Address),
    AgentStake(Address),
    UsedAttestation(BytesN<32>),
}

#[contracttype]
#[derive(Clone)]
pub struct Attestation {
    pub agent: Address,
    pub new_level: u32,
    pub stake_amount: i128,
    pub attestation_hash: BytesN<32>,
    pub attestation_hash: BytesN<32>, // unique ID / replay protection
}



impl<K: IStorageKey> StorageRepository<K> for PersistentStorageRepository {
    fn set<V>(&self, key: &K, value: &V)
    where
        V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>,
    {
        self.env.storage().persistent().set(key, value);
    }
    fn get<V>(&self, key: &K) -> Option<V>
    where
        V: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>,
    {
        self.env.storage().persistent().get(key)
    }
    fn remove(&self, key: &K) {
        self.env.storage().persistent().remove(key);
    }
    fn has(&self, key: &K) -> bool {
        self.env.storage().persistent().has(key)
    }
    fn extend_ttl(&self, key: &K, threshold: u32, extend_to: u32) {
        self.env
            .storage()
            .persistent()
            .extend_ttl(key, threshold, extend_to);
    }
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum Error {
    InvalidActionType = 1,
    ExecutionIdExists = 2,
    RateLimitExceeded = 3,
    Unauthorized = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ActionType {
    CreditScore = 1,
    FraudDetect = 2,
    Trade = 3,
}

impl ActionType {
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            1 => Some(ActionType::CreditScore),
            2 => Some(ActionType::FraudDetect),
            3 => Some(ActionType::Trade),
            _ => None,
        }
    }
}

#[contracttype]
#[derive(Clone)]
pub struct Execution {
    pub id: u64,
    pub agent: Address,
    pub action_type: ActionType,
    pub data: Bytes,
    pub timestamp: u64,
}

#[contract]
pub struct CommonUtilsContract;

const RATE_LIMIT_WINDOW: u64 = 3600;
const RATE_LIMIT_MAX: u32 = 10;

#[contractimpl]
impl CommonUtilsContract {
    /// Initialize contract with admin.
    pub fn initialize(env: Env, admin: Address) {
        env.storage()
            .persistent()
            .set(&Symbol::new(&env, "admin"), &admin);
        env.storage()
            .persistent()
            .set(&Symbol::new(&env, "exec_cnt"), &0u64);
    }

    /// Submit an agent action.
    pub fn submit_action(env: Env, agent: Address, action_type: u32, data: Bytes) -> u64 {
        let action = ActionType::from_u32(action_type).unwrap_or_else(|| {
            panic_with_error!(&env, Error::InvalidActionType);
        });

        Self::check_rate_limit(&env, &agent);

        let counter = env
            .storage()
            .persistent()
            .get::<_, u64>(&Symbol::new(&env, "exec_cnt"))
            .unwrap_or(0);
        let execution_id = counter + 1;

        let timestamp = env.ledger().timestamp();
        let execution = Execution {
            id: execution_id,
            agent: agent.clone(),
            action_type: action,
            data,
            timestamp,
        };

        let execution_key = (Symbol::new(&env, "execution"), execution_id);
        if env.storage().persistent().has(&execution_key) {
            panic_with_error!(&env, Error::ExecutionIdExists);
        }

        env.storage().persistent().set(&execution_key, &execution);
        env.storage()
            .persistent()
            .set(&Symbol::new(&env, "exec_cnt"), &execution_id);

        Self::update_rate_limit(&env, &agent, timestamp);

        env.events().publish(
            (Symbol::new(&env, "act_sub"),),
            (execution_id, agent, action_type, timestamp),
        );

        execution_id
    }

    pub fn get_execution(env: Env, execution_id: u64) -> Option<Execution> {
        let key = (Symbol::new(&env, "execution"), execution_id);
        env.storage().persistent().get(&key)
    }

    pub fn admin(env: Env) -> Address {
        env.storage()
            .persistent()
            .get(&Symbol::new(&env, "admin"))
            .unwrap()
    }

    fn check_rate_limit(env: &Env, agent: &Address) {
        let now = env.ledger().timestamp();
        let window_start = now.saturating_sub(RATE_LIMIT_WINDOW);
        let key = (Symbol::new(&env, "rate_limit"), agent.clone());

        let actions: Vec<u64> = env.storage().temporary().get(&key).unwrap_or(Vec::new(env));
        let mut recent_count = 0;
        for t in actions.iter() {
            if t >= window_start {
                recent_count += 1;
            }
        }

        if recent_count >= RATE_LIMIT_MAX {
            panic_with_error!(env, Error::RateLimitExceeded);
        }
    }

    fn update_rate_limit(env: &Env, agent: &Address, timestamp: u64) {
        let key = (Symbol::new(&env, "rate_limit"), agent.clone());
        let mut actions: Vec<u64> = env.storage().temporary().get(&key).unwrap_or(Vec::new(env));
        actions.push_back(timestamp);
        env.storage().temporary().set(&key, &actions);
    }

    /// Helper to check permission against ACL contract
    /// In a production scenario, this would be a cross-contract call.
    pub fn check_permission(env: Env, acl_address: Address, user: Address, resource: Symbol, action: Symbol) -> bool {
        env.invoke_contract::<bool>(&acl_address, &Symbol::new(&env, "has_permission"), soroban_sdk::vec![&env, user.into_val(&env), resource.into_val(&env), action.into_val(&env)])
    }
}

#[contract]
pub struct EvolutionManager;

#[contractimpl]
impl EvolutionManager {
    pub fn emit_evolution_completed(
        env: Env,
        agent: Address,
        new_level: u32,
        total_stake: i128,
        attestation_hash: BytesN<32>,
    ) {
        env.events().publish(
            ("EvolutionCompleted",),
            (agent, new_level, total_stake, attestation_hash),
        );
    }
}

#[cfg(test)]
mod test_marketplace;

#[cfg(test)]
mod timelock_tests;

#[cfg(test)]
mod batch_tests;

#[cfg(test)]
mod rate_limit_tests;

#[cfg(test)]
mod state_machine_tests;

#[cfg(test)]
mod fees_tests;

#[cfg(test)]
mod compliance_log_tests;
