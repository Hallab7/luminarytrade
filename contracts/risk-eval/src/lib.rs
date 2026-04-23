#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Bytes, BytesN, Env, Map, Symbol,
};
use common_utils::error::{AuthorizationError, CryptoError, ValidationError, ContractError, StateError};
use common_utils::authorization::{IAuthorizable, SignatureBasedAuth, Permission, PermissionCache, CachedAuth};
use common_utils::{permission, auth, cached_auth, check_authorization, verify_signature};
use common_utils::state_machine::{State, StateMachine, RiskEvalState};
use common_utils::{state_guard, transition_to};

mod oracle_cache;
pub use oracle_cache::OracleCache;

/// -------------------------
/// Storage Keys
/// -------------------------
#[contracttype]
pub enum DataKey {
    BridgePubKey,
    AclContract,
    Risk(Address),
    ContractState,
}

/// -------------------------
/// Risk Levels
/// -------------------------
#[contracttype]
#[derive(Clone, Copy)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

/// -------------------------
/// Signed Payload
/// -------------------------
#[contracttype]
pub struct RiskAttestation {
    pub agent: Address,
    pub risk: RiskLevel,
    pub timestamp: u64,
}

/// -------------------------
/// Contract
/// -------------------------
#[contract]
pub struct RiskEvaluationContract;

impl StateMachine<RiskEvalState> for RiskEvaluationContract {
    fn get_state(env: &Env) -> State<RiskEvalState> {
        env.storage()
            .instance()
            .get(&DataKey::ContractState)
            .unwrap_or(State::Uninitialized)
    }

    fn set_state(env: &Env, state: State<RiskEvalState>) {
        env.storage().instance().set(&DataKey::ContractState, &state);
    }
}

/// -------------------------
/// Implementation
/// -------------------------
#[contractimpl]
impl RiskEvaluationContract {
    /// Initialize contract with AI bridge public key and ACL contract
    pub fn init(env: Env, bridge_pubkey: BytesN<32>, acl_contract: Address) -> Result<(), StateError> {
        // Ensure contract is uninitialized
        let current_state = Self::get_state(&env);
        if !current_state.is_uninitialized() {
            return Err(StateError::AlreadyInitialized);
        }

        // Transition to Active state
        let initial_state = State::Active(RiskEvalState {
            bridge_pubkey: bridge_pubkey.clone(),
            acl_contract: acl_contract.clone(),
            total_evaluations: 0,
        });
        
        transition_to!(Self, &env, initial_state)?;
        
        // Store for backward compatibility
        env.storage()
            .instance()
            .set(&DataKey::BridgePubKey, &bridge_pubkey);
        env.storage()
            .instance()
            .set(&DataKey::AclContract, &acl_contract);
            
        env.events().publish(
            (symbol_short!("init"),),
            (bridge_pubkey, acl_contract),
        );
        
        Ok(())
    }

    /// Submit signed risk evaluation
    pub fn submit_risk(
        env: Env,
        attestation: RiskAttestation,
        signature: BytesN<64>,
        payload: Bytes,
    ) -> Result<(), CryptoError> {
        // State guard: contract must be active
        state_guard!(Self, &env, active);
        
        let state = Self::get_state(&env);
        let state_data = state.get_data().ok_or(CryptoError::InvalidPublicKey)?;

        // ACL Check
        if !common_utils::check_permission(
            env.clone(),
            state_data.acl_contract.clone(),
            attestation.agent.clone(),
            symbol_short!("risk"),
            symbol_short!("submit")
        ) {
            return Err(CryptoError::InvalidSignature);
        }

        // Verify signature
        let valid = env.crypto().ed25519_verify(
            &state_data.bridge_pubkey,
            &payload,
            &signature,
        );

        if !valid {
            return Err(CryptoError::SignatureVerificationFailed);
        }
        
        // Check custom permission for signature-based auth
        check_authorization!(auth, &env, &attestation.agent, permission!(Custom(Symbol::new(&env, "signature"))));

        // Optional replay protection (basic)
        let now = env.ledger().timestamp();
        if attestation.timestamp > now + 60 {
            return Err(CryptoError::InvalidSignature);
        }

        // Store risk level for agent
        env.storage()
            .persistent()
            .set(&DataKey::Risk(attestation.agent.clone()), &attestation.risk);

        // Update total evaluations count in state
        let mut new_state_data = state_data.clone();
        new_state_data.total_evaluations += 1;
        Self::set_state(&env, State::Active(new_state_data));

        // Emit event
        env.events().publish(
            (symbol_short!("RiskEval"), attestation.agent.clone()),
            (attestation.risk, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Get risk level for an agent
    pub fn get_risk(env: Env, agent: Address) -> Option<RiskLevel> {
        // Allow reads even when paused, but not when uninitialized or terminated
        if Self::require_initialized(&env).is_err() {
            return None;
        }
        
        env.storage()
            .persistent()
            .get(&DataKey::Risk(agent))
    }
    
    /// Pause the contract (Admin only - requires bridge key signature)
    pub fn pause(env: Env) -> Result<(), StateError> {
        state_guard!(Self, &env, active);
        
        let state = Self::get_state(&env);
        let state_data = state.get_data().ok_or(StateError::NotInitialized)?;
        
        let paused_state = State::Paused(state_data.clone());
        transition_to!(Self, &env, paused_state)?;
        
        Ok(())
    }

    /// Resume the contract from paused state
    pub fn resume(env: Env) -> Result<(), StateError> {
        let state = Self::get_state(&env);
        if !state.is_paused() {
            return Err(StateError::InvalidState);
        }
        
        let state_data = state.get_data().ok_or(StateError::NotInitialized)?;
        
        let active_state = State::Active(state_data.clone());
        transition_to!(Self, &env, active_state)?;
        
        Ok(())
    }

    /// Get the current contract state
    pub fn get_contract_state(env: Env) -> State<RiskEvalState> {
        Self::get_state(&env)
    }

    /// Get total evaluations count
    pub fn get_total_evaluations(env: Env) -> Result<u64, StateError> {
        state_guard!(Self, &env, initialized);
        
        let state = Self::get_state(&env);
        let state_data = state.get_data().ok_or(StateError::NotInitialized)?;
        Ok(state_data.total_evaluations)
    }
    
    /// Get the authorization instance for this contract
    fn get_auth(env: &Env) -> CachedAuth<SignatureBasedAuth> {
        let sig_auth = auth!(SignatureBased, Symbol::new(env, "bridge_pubkey"));
        let cache = PermissionCache::new(300, Symbol::new(env, "auth_cache"));
        cached_auth!(sig_auth, cache)
    }
    
    /// Verify a signature directly (utility method)
    pub fn verify_signature_direct(env: Env, payload: Bytes, signature: BytesN<64>) -> Result<bool, CryptoError> {
        let auth = Self::get_auth(&env);
        auth.verify_signature(&env, &payload, &signature)
    }
}

