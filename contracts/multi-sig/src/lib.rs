//! # Multi-Signature Contract
//!
//! A Soroban smart contract implementing multi-signature functionality for critical operations.
//! Supports configurable signers, thresholds, proposal lifecycle, and tiered operations.
//!
//! ## Features
//!
//! - Configurable signers and thresholds
//! - Operation proposal system with lifecycle management
//! - Approval tracking and collection
//! - Timeouts and expiry for proposals
//! - Replay protection via nonce tracking
//! - Execution logging
//! - Tiered thresholds for different operation types

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Bytes, BytesN, Env, Map, Symbol, Vec,
    Val, TryFromVal,
};
use common_utils::error::CommonError;
use common_utils::compliance_log::{ComplianceLogger, ComplianceAction};

// ============================================================================
// Storage Keys
// ============================================================================

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    // Configuration
    Threshold,
    DefaultThreshold,
    LowThreshold,
    MediumThreshold,
    HighThreshold,
    
    // Signers
    SignerSet,
    SignerCount,
    Signer(Address),
    
    // Proposals
    Proposal(u32),
    ProposalCount,
    ProposalCreator(u32),
    ProposalApprovals(u32),
    ProposalExpiry(u32),
    
    // Execution tracking
    ExecutionNonce,
    ExecutedProposal(u32),
    
    // Operation-specific thresholds
    OperationThreshold(OperationType),
}

// ============================================================================
// Data Types
// ============================================================================

/// Operation types with different security requirements
#[derive(Clone, Copy)]
#[contracttype]
pub enum OperationType {
    /// Low-risk operations (e.g., reading data)
    Read = 0,
    /// Standard operations (e.g., updating non-critical data)
    Standard = 1,
    /// High-risk operations (e.g., transferring funds)
    HighValue = 2,
    /// Critical operations (e.g., changing signers, thresholds)
    Critical = 3,
}

impl OperationType {
    pub fn from_u32(value: u32) -> Option<OperationType> {
        match value {
            0 => Some(OperationType::Read),
            1 => Some(OperationType::Standard),
            2 => Some(OperationType::HighValue),
            3 => Some(OperationType::Critical),
            _ => None,
        }
    }
}

/// Proposal status
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum ProposalStatus {
    /// Proposal has been created but not yet approved
    Pending = 0,
    /// Proposal has received enough approvals
    Approved = 1,
    /// Proposal has been executed
    Executed = 2,
    /// Proposal was cancelled
    Cancelled = 3,
    /// Proposal has expired
    Expired = 4,
}

/// A multi-sig proposal
#[derive(Clone)]
#[contracttype]
pub struct Proposal {
    /// Unique proposal ID
    pub id: u32,
    /// Operation type
    pub operation: OperationType,
    /// Target contract (if applicable)
    pub target: Option<Address>,
    /// Function name to call
    pub function: Symbol,
    /// Arguments for the call
    pub arguments: Vec<Val>,
    /// Current approval count
    pub approval_count: u32,
    /// Required threshold for this operation type
    pub required_threshold: u32,
    /// Creator of the proposal
    pub creator: Address,
    /// Timestamp when created
    pub created_at: u64,
    /// Timestamp when proposal expires
    pub expires_at: u64,
    /// Current status
    pub status: ProposalStatus,
}

/// Signer information
#[derive(Clone)]
#[contracttype]
pub struct SignerInfo {
    pub address: Address,
    pub weight: u32,
    pub added_at: u64,
}

/// Multi-sig configuration
#[derive(Clone)]
#[contracttype]
pub struct MultiSigConfig {
    pub threshold: u32,
    pub low_threshold: u32,
    pub medium_threshold: u32,
    pub high_threshold: u32,
    pub proposal_timeout: u64,
    pub max_proposals: u32,
}

/// Execution record for logging
#[derive(Clone)]
#[contracttype]
pub struct ExecutionRecord {
    pub proposal_id: u32,
    pub executed_by: Address,
    pub executed_at: u64,
    pub nonce: u32,
    pub success: bool,
}

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct MultiSignatureContract;

// ============================================================================
// Implementation
// ============================================================================

#[contractimpl]
impl MultiSignatureContract {
    /// Initialize the multi-sig contract with initial signers and thresholds
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `signers` - Initial list of signer addresses
    /// * `threshold` - Default threshold for operations
    /// * `low_threshold` - Threshold for low-risk operations
    /// * `medium_threshold` - Threshold for medium-risk operations
    /// * `high_threshold` - Threshold for high-risk operations
    /// * `proposal_timeout` - Time in seconds before proposal expires
    /// 
    /// # Returns
    /// 
    /// * `Ok(())` - Initialization successful
    /// * `Err(CommonError)` - If already initialized or invalid parameters
    pub fn initialize(
        env: Env,
        signers: Vec<Address>,
        threshold: u32,
        low_threshold: u32,
        medium_threshold: u32,
        high_threshold: u32,
        proposal_timeout: u64,
    ) -> Result<(), CommonError> {
        // Check if already initialized
        if env.storage().instance().has(&DataKey::Threshold) {
            return Err(CommonError::AlreadyInitialized);
        }

        // Validate thresholds
        let signer_count = signers.len() as u32;
        if threshold == 0 || threshold > signer_count {
            return Err(CommonError::InvalidFormat);
        }
        if low_threshold > threshold 
            || medium_threshold > threshold 
            || high_threshold > threshold {
            return Err(CommonError::InvalidFormat);
        }

        // Store configuration
        env.storage().instance().set(&DataKey::Threshold, &threshold);
        env.storage().instance().set(&DataKey::DefaultThreshold, &threshold);
        env.storage().instance().set(&DataKey::LowThreshold, &low_threshold);
        env.storage().instance().set(&DataKey::MediumThreshold, &medium_threshold);
        env.storage().instance().set(&DataKey::HighThreshold, &high_threshold);
        env.storage().instance().set(&DataKey::SignerCount, &signer_count);
        env.storage().instance().set(&DataKey::ProposalCount, &0u32);
        env.storage().instance().set(&DataKey::ExecutionNonce, &0u32);

        // Store signers
        let mut signer_set = Vec::new(&env);
        for (index, signer) in signers.iter().enumerate() {
            let signer_info = SignerInfo {
                address: signer.clone(),
                weight: 1,
                added_at: env.ledger().timestamp(),
            };
            env.storage().persistent().set(&DataKey::Signer(signer.clone()), &signer_info);
            signer_set.push_back(signer.to_val());
            
            // Emit event for each signer added
            env.events().publish(
                (symbol_short!("signer_add"),),
                signer,
            );
        }
        env.storage().instance().set(&DataKey::SignerSet, &signer_set);

        // Emit initialization event
        env.events().publish(
            (symbol_short!("init"),),
            (threshold, signer_count),
        );

        Ok(())
    }

    /// Add a new signer to the multi-sig contract
    /// 
    /// Requires multi-sig approval as a proposal
    pub fn add_signer(
        env: Env,
        caller: Address,
        new_signer: Address,
    ) -> Result<u32, CommonError> {
        caller.require_auth();
        
        // Check if caller is a valid signer
        Self::check_signer(&env, &caller)?;

        // Check if signer already exists
        if env.storage().persistent().has(&DataKey::Signer(new_signer.clone())) {
            return Err(CommonError::InvalidFormat);
        }

        // Create proposal for adding signer
        let proposal_id = Self::create_proposal(
            &env,
            OperationType::Critical,
            None,
            symbol_short!("add_signer"),
            vec![&env, new_signer.to_val()],
            caller,
        )?;

        Ok(proposal_id)
    }

    /// Remove a signer from the multi-sig contract
    pub fn remove_signer(
        env: Env,
        caller: Address,
        signer_to_remove: Address,
    ) -> Result<u32, CommonError> {
        caller.require_auth();
        
        // Check if caller is a valid signer
        Self::check_signer(&env, &caller)?;

        // Check if signer exists
        if !env.storage().persistent().has(&DataKey::Signer(signer_to_remove.clone())) {
            return Err(CommonError::KeyNotFound);
        }

        // Prevent removing the last signer
        let signer_count: u32 = env.storage().instance().get(&DataKey::SignerCount)
            .ok_or(CommonError::NotInitialized)?;
        if signer_count <= 1 {
            return Err(CommonError::InvalidFormat);
        }

        // Create proposal for removing signer
        let proposal_id = Self::create_proposal(
            &env,
            OperationType::Critical,
            None,
            symbol_short!("remove_signer"),
            vec![&env, signer_to_remove.to_val()],
            caller,
        )?;

        Ok(proposal_id)
    }

    /// Change the default threshold
    pub fn change_threshold(
        env: Env,
        caller: Address,
        new_threshold: u32,
    ) -> Result<u32, CommonError> {
        caller.require_auth();
        
        // Check if caller is a valid signer
        Self::check_signer(&env, &caller)?;

        // Validate threshold
        let signer_count: u32 = env.storage().instance().get(&DataKey::SignerCount)
            .ok_or(CommonError::NotInitialized)?;
        if new_threshold == 0 || new_threshold > signer_count {
            return Err(CommonError::InvalidFormat);
        }

        // Create proposal for changing threshold
        let proposal_id = Self::create_proposal(
            &env,
            OperationType::Critical,
            None,
            symbol_short!("chg_thresh"),
            vec![&env, new_threshold.into()],
            caller,
        )?;

        Ok(proposal_id)
    }

    /// Create a new proposal
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `operation` - Type of operation
    /// * `target` - Target contract address (optional)
    /// * `function` - Function name to call
    /// * `arguments` - Arguments for the function
    /// * `creator` - Address creating the proposal
    /// 
    /// # Returns
    /// 
    /// * `Ok(proposal_id)` - ID of created proposal
    /// * `Err(CommonError)` - If creation fails
    pub fn create_proposal(
        env: &Env,
        operation: OperationType,
        target: Option<Address>,
        function: Symbol,
        arguments: Vec<Val>,
        creator: Address,
    ) -> Result<u32, CommonError> {
        // Get current proposal count
        let mut proposal_count: u32 = env.storage().instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0);

        // Check max proposals
        let max_proposals: u32 = 100; // Could be made configurable
        if proposal_count >= max_proposals {
            return Err(CommonError::StorageFull);
        }

        // Get threshold for operation type
        let required_threshold = Self::get_threshold_for_operation(env, operation)?;

        // Generate proposal ID
        proposal_count += 1;
        let proposal_id = proposal_count;

        // Get expiry time
        let created_at = env.ledger().timestamp();
        let timeout: u64 = 7 * 24 * 60 * 60; // 7 days default
        let expires_at = created_at + timeout;

        // Create proposal
        let proposal = Proposal {
            id: proposal_id,
            operation,
            target,
            function,
            arguments,
            approval_count: 0,
            required_threshold,
            creator,
            created_at,
            expires_at,
            status: ProposalStatus::Pending,
        };

        // Store proposal
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
        
        // Update proposal count
        env.storage().instance().set(&DataKey::ProposalCount, &proposal_count);

        // Store creator reference
        env.storage().persistent().set(&DataKey::ProposalCreator(proposal_id), &creator);

        // Emit event
        env.events().publish(
            (symbol_short!("prop_crt"),),
            (proposal_id, operation as u32, creator.clone()),
        );

        // Compliance audit log – ProposalCreated
        if ComplianceLogger::is_initialized(env) {
            let id_bytes = Bytes::from_slice(env, &(proposal_id as u64).to_le_bytes());
            ComplianceLogger::append(
                env,
                creator.clone(),
                ComplianceAction::ProposalCreated,
                id_bytes.clone(),
                Bytes::new(env),
                id_bytes,
                BytesN::from_array(env, &[0u8; 32]),
            );
        }

        Ok(proposal_id)
    }

    /// Approve a proposal
    /// 
    /// Each signer can approve a proposal once. When threshold is reached,
    /// the proposal status changes to Approved.
    pub fn approve_proposal(
        env: Env,
        approver: Address,
        proposal_id: u32,
    ) -> Result<ProposalStatus, CommonError> {
        approver.require_auth();
        
        // Check if approver is a valid signer
        Self::check_signer(&env, &approver)?;

        // Get proposal
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(CommonError::KeyNotFound)?;

        // Check proposal status
        if proposal.status != ProposalStatus::Pending {
            return Err(CommonError::InvalidFormat);
        }

        // Check expiry
        if env.ledger().timestamp() > proposal.expires_at {
            proposal.status = ProposalStatus::Expired;
            env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
            return Err(CommonError::InvalidFormat);
        }

        // Get current approvals
        let mut approvals: Map<Address, bool> = env.storage().persistent()
            .get(&DataKey::ProposalApprovals(proposal_id))
            .unwrap_or(Map::new(&env));

        // Check if already approved
        if approvals.get(approver.clone()).unwrap_or(false) {
            return Err(CommonError::InvalidFormat);
        }

        // Record approval
        approvals.set(approver.clone(), true);
        proposal.approval_count += 1;

        // Store updated approvals
        env.storage().persistent().set(&DataKey::ProposalApprovals(proposal_id), &approvals);

        // Check if threshold met
        if proposal.approval_count >= proposal.required_threshold {
            proposal.status = ProposalStatus::Approved;
        }

        // Store updated proposal
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        // Emit event
        env.events().publish(
            (symbol_short!("prop_appr"),),
            (proposal_id, approver.clone(), proposal.approval_count),
        );

        // Compliance audit log – ProposalApproved
        if ComplianceLogger::is_initialized(&env) {
            let id_bytes = Bytes::from_slice(&env, &(proposal_id as u64).to_le_bytes());
            let count_bytes = Bytes::from_slice(&env, &(proposal.approval_count as u64).to_le_bytes());
            ComplianceLogger::append(
                &env,
                approver.clone(),
                ComplianceAction::ProposalApproved,
                id_bytes,
                Bytes::new(&env),
                count_bytes,
                BytesN::from_array(&env, &[0u8; 32]),
            );
        }

        Ok(proposal.status)
    }

    /// Execute an approved proposal
    /// 
    /// Only proposals with status Approved can be executed.
    /// This function can invoke other contracts with the approved parameters.
    pub fn execute_proposal(
        env: Env,
        executor: Address,
        proposal_id: u32,
    ) -> Result<bool, CommonError> {
        executor.require_auth();
        
        // Check if executor is a valid signer
        Self::check_signer(&env, &executor)?;

        // Get proposal
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(CommonError::KeyNotFound)?;

        // Check proposal status
        if proposal.status != ProposalStatus::Approved {
            return Err(CommonError::InvalidFormat);
        }

        // Check expiry
        if env.ledger().timestamp() > proposal.expires_at {
            proposal.status = ProposalStatus::Expired;
            env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
            return Err(CommonError::InvalidFormat);
        }

        // Get and increment execution nonce for replay protection
        let mut nonce: u32 = env.storage().instance()
            .get(&DataKey::ExecutionNonce)
            .unwrap_or(0);
        nonce += 1;
        env.storage().instance().set(&DataKey::ExecutionNonce, &nonce);

        // Execute the operation based on function name
        let success = Self::execute_operation(&env, &proposal)?;

        // Mark proposal as executed
        proposal.status = ProposalStatus::Executed;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        // Store execution record
        let record = ExecutionRecord {
            proposal_id,
            executed_by: executor,
            executed_at: env.ledger().timestamp(),
            nonce,
            success,
        };
        env.storage().persistent().set(&DataKey::ExecutedProposal(proposal_id), &record);

        // Emit event
        env.events().publish(
            (symbol_short!("prop_exec"),),
            (proposal_id, success),
        );

        // Compliance audit log – ProposalExecuted
        if ComplianceLogger::is_initialized(&env) {
            let id_bytes = Bytes::from_slice(&env, &(proposal_id as u64).to_le_bytes());
            let result_bytes = Bytes::from_slice(&env, if success { b"\x01" } else { b"\x00" });
            ComplianceLogger::append(
                &env,
                executor.clone(),
                ComplianceAction::ProposalExecuted,
                id_bytes,
                Bytes::new(&env),
                result_bytes,
                BytesN::from_array(&env, &[0u8; 32]),
            );
        }

        Ok(success)
    }

    /// Cancel a pending or approved proposal
    pub fn cancel_proposal(
        env: Env,
        caller: Address,
        proposal_id: u32,
    ) -> Result<(), CommonError> {
        caller.require_auth();
        
        // Get proposal
        let mut proposal: Proposal = env.storage().persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(CommonError::KeyNotFound)?;

        // Only creator or threshold signers can cancel
        let creator: Address = env.storage().persistent()
            .get(&DataKey::ProposalCreator(proposal_id))
            .ok_or(CommonError::KeyNotFound)?;

        if caller != creator {
            // Check if caller is a valid signer (for emergency cancellation)
            Self::check_signer(&env, &caller)?;
        }

        // Check proposal status
        if proposal.status != ProposalStatus::Pending 
            && proposal.status != ProposalStatus::Approved {
            return Err(CommonError::InvalidFormat);
        }

        // Cancel proposal
        proposal.status = ProposalStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);

        // Emit event
        env.events().publish(
            (symbol_short!("prop_canc"),),
            proposal_id,
        );

        Ok(())
    }

    /// Get proposal details
    pub fn get_proposal(env: Env, proposal_id: u32) -> Option<Proposal> {
        env.storage().persistent().get(&DataKey::Proposal(proposal_id))
    }

    /// Get signer count
    pub fn get_signer_count(env: Env) -> u32 {
        env.storage().instance()
            .get(&DataKey::SignerCount)
            .unwrap_or(0)
    }

    /// Get current threshold
    pub fn get_threshold(env: Env) -> u32 {
        env.storage().instance()
            .get(&DataKey::Threshold)
            .unwrap_or(0)
    }

    /// Get threshold for specific operation type
    pub fn get_operation_threshold(env: Env, operation: OperationType) -> u32 {
        Self::get_threshold_for_operation(&env, operation).unwrap_or(0)
    }

    /// Check if address is a valid signer
    pub fn is_signer(env: Env, address: Address) -> bool {
        env.storage().persistent().has(&DataKey::Signer(address))
    }

    /// Get all signers
    pub fn get_signers(env: Env) -> Vec<Address> {
        env.storage().instance()
            .get(&DataKey::SignerSet)
            .unwrap_or(Vec::new(&env))
    }

    /// Get approval status for a proposal
    pub fn get_approval_status(env: Env, proposal_id: u32, signer: Address) -> bool {
        let approvals: Map<Address, bool> = env.storage().persistent()
            .get(&DataKey::ProposalApprovals(proposal_id))
            .unwrap_or(Map::new(&env));
        approvals.get(signer).unwrap_or(false)
    }

    /// Get execution record for a proposal
    pub fn get_execution_record(env: Env, proposal_id: u32) -> Option<ExecutionRecord> {
        env.storage().persistent().get(&DataKey::ExecutedProposal(proposal_id))
    }

    // ========================================================================
    // Internal Helper Functions
    // ========================================================================

    /// Check if address is a valid signer
    fn check_signer(env: &Env, address: &Address) -> Result<(), CommonError> {
        if !env.storage().persistent().has(&DataKey::Signer(address.clone())) {
            return Err(CommonError::NotAuthorized);
        }
        Ok(())
    }

    /// Get threshold for operation type
    fn get_threshold_for_operation(env: &Env, operation: OperationType) -> Result<u32, CommonError> {
        let threshold: u32 = match operation {
            OperationType::Read => {
                env.storage().instance()
                    .get(&DataKey::LowThreshold)
                    .unwrap_or(1)
            }
            OperationType::Standard => {
                env.storage().instance()
                    .get(&DataKey::MediumThreshold)
                    .unwrap_or(1)
            }
            OperationType::HighValue => {
                env.storage().instance()
                    .get(&DataKey::HighThreshold)
                    .unwrap_or(2)
            }
            OperationType::Critical => {
                env.storage().instance()
                    .get(&DataKey::Threshold)
                    .unwrap_or(2)
            }
        };
        Ok(threshold)
    }

    /// Execute the actual operation
    fn execute_operation(env: &Env, proposal: &Proposal) -> Result<bool, CommonError> {
        // Handle internal operations
        match proposal.function.as_val().to_string().as_str() {
            "add_signer" => {
                if proposal.arguments.len() < 1 {
                    return Err(CommonError::InvalidFormat);
                }
                let new_signer = Address::try_from_val(env, &proposal.arguments.get(0).unwrap())
                    .map_err(|_| CommonError::InvalidFormat)?;
                Self::execute_add_signer(env, new_signer)
            }
            "remove_signer" => {
                if proposal.arguments.len() < 1 {
                    return Err(CommonError::InvalidFormat);
                }
                let signer_to_remove = Address::try_from_val(env, &proposal.arguments.get(0).unwrap())
                    .map_err(|_| CommonError::InvalidFormat)?;
                Self::execute_remove_signer(env, signer_to_remove)
            }
            "chg_thresh" => {
                if proposal.arguments.len() < 1 {
                    return Err(CommonError::InvalidFormat);
                }
                let new_threshold = u32::try_from_val(env, &proposal.arguments.get(0).unwrap())
                    .map_err(|_| CommonError::InvalidFormat)?;
                Self::execute_change_threshold(env, new_threshold)
            }
            // For external contract calls, return true to indicate the proposal
            // was approved and should be executed by the calling contract
            _ => Ok(true),
        }
    }

    /// Execute adding a signer
    fn execute_add_signer(env: &Env, new_signer: Address) -> Result<bool, CommonError> {
        // Add signer
        let signer_info = SignerInfo {
            address: new_signer.clone(),
            weight: 1,
            added_at: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&DataKey::Signer(new_signer.clone()), &signer_info);

        // Update signer count
        let mut count: u32 = env.storage().instance()
            .get(&DataKey::SignerCount)
            .unwrap_or(0);
        count += 1;
        env.storage().instance().set(&DataKey::SignerCount, &count);

        // Update signer set
        let mut signers: Vec<Address> = env.storage().instance()
            .get(&DataKey::SignerSet)
            .unwrap_or(Vec::new(env));
        signers.push_back(new_signer.clone());
        env.storage().instance().set(&DataKey::SignerSet, &signers);

        // Emit event
        env.events().publish(
            (symbol_short!("signer_add"),),
            new_signer,
        );

        Ok(true)
    }

    /// Execute removing a signer
    fn execute_remove_signer(env: &Env, signer_to_remove: Address) -> Result<bool, CommonError> {
        // Remove signer
        env.storage().persistent().remove(&DataKey::Signer(signer_to_remove.clone()));

        // Update signer count
        let mut count: u32 = env.storage().instance()
            .get(&DataKey::SignerCount)
            .unwrap_or(0);
        if count > 0 {
            count -= 1;
        }
        env.storage().instance().set(&DataKey::SignerCount, &count);

        // Update signer set
        let mut signers: Vec<Address> = env.storage().instance()
            .get(&DataKey::SignerSet)
            .unwrap_or(Vec::new(env));
        // Create new vector without the removed signer
        let mut new_signers = Vec::new(env);
        for s in signers.iter() {
            if s != &signer_to_remove {
                new_signers.push_back(s);
            }
        }
        env.storage().instance().set(&DataKey::SignerSet, &new_signers);

        // Emit event
        env.events().publish(
            (symbol_short!("signer_rem"),),
            signer_to_remove,
        );

        Ok(true)
    }

    /// Execute changing threshold
    fn execute_change_threshold(env: &Env, new_threshold: u32) -> Result<bool, CommonError> {
        // Validate
        let signer_count: u32 = env.storage().instance()
            .get(&DataKey::SignerCount)
            .ok_or(CommonError::NotInitialized)?;
        
        if new_threshold == 0 || new_threshold > signer_count {
            return Err(CommonError::InvalidFormat);
        }

        // Update threshold
        env.storage().instance().set(&DataKey::Threshold, &new_threshold);

        // Emit event
        env.events().publish(
            (symbol_short!("thresh_chg"),),
            new_threshold,
        );

        Ok(true)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address};

    fn setup() -> (Env, Address, Vec<Address>) {
        let env = Env::default();
        env.mock_all_auths();
        
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);
        
        let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];
        
        (env, signer1, signers)
    }

    #[test]
    fn test_initialize() {
        let (env, _, signers) = setup();
        
        let result = MultiSignatureContract::initialize(
            env.clone(),
            signers.clone(),
            2, // threshold
            1, // low
            2, // medium
            3, // high
            7 * 24 * 60 * 60, // 7 days
        );
        
        assert!(result.is_ok());
        
        // Verify configuration
        let threshold = MultiSignatureContract::get_threshold(env.clone());
        assert_eq!(threshold, 2);
        
        let signer_count = MultiSignatureContract::get_signer_count(env.clone());
        assert_eq!(signer_count, 3);
    }

    #[test]
    fn test_initialize_invalid_threshold() {
        let (env, _, signers) = setup();
        
        // Threshold > signer count should fail
        let result = MultiSignatureContract::initialize(
            env.clone(),
            signers.clone(),
            5, // threshold > signer count
            1,
            2,
            3,
            7 * 24 * 60 * 60,
        );
        
        assert!(result.is_err());
    }

    #[test]
    fn test_create_proposal() {
        let (env, signer1, signers) = setup();
        
        // Initialize
        MultiSignatureContract::initialize(
            env.clone(),
            signers.clone(),
            2,
            1,
            2,
            3,
            7 * 24 * 60 * 60,
        ).unwrap();
        
        // Create proposal
        let proposal_id = MultiSignatureContract::create_proposal(
            &env,
            OperationType::Standard,
            None,
            symbol_short!("test_fn"),
            vec![&env],
            signer1.clone(),
        ).unwrap();
        
        assert_eq!(proposal_id, 1);
        
        // Verify proposal
        let proposal = MultiSignatureContract::get_proposal(env.clone(), proposal_id);
        assert!(proposal.is_some());
        
        let p = proposal.unwrap();
        assert_eq!(p.id, proposal_id);
        assert_eq!(p.status, ProposalStatus::Pending);
    }

    #[test]
    fn test_approve_proposal() {
        let (env, signer1, signers) = setup();
        
        // Initialize
        MultiSignatureContract::initialize(
            env.clone(),
            signers.clone(),
            2,
            1,
            2,
            3,
            7 * 24 * 60 * 60,
        ).unwrap();
        
        // Create proposal
        let proposal_id = MultiSignatureContract::create_proposal(
            &env,
            OperationType::Standard,
            None,
            symbol_short!("test_fn"),
            vec![&env],
            signer1.clone(),
        ).unwrap();
        
        // Get other signers
        let signers_vec = MultiSignatureContract::get_signers(env.clone());
        let signer2 = signers_vec.get(1).unwrap();
        let signer3 = signers_vec.get(2).unwrap();
        
        // Approve with first signer
        let status = MultiSignatureContract::approve_proposal(
            env.clone(),
            signer1.clone(),
            proposal_id,
        ).unwrap();
        
        assert_eq!(status, ProposalStatus::Pending); // Not enough approvals yet
        
        // Approve with second signer
        let status = MultiSignatureContract::approve_proposal(
            env.clone(),
            signer2.clone(),
            proposal_id,
        ).unwrap();
        
        assert_eq!(status, ProposalStatus::Approved); // Threshold met
        
        // Verify approval count
        let proposal = MultiSignatureContract::get_proposal(env.clone(), proposal_id).unwrap();
        assert_eq!(proposal.approval_count, 2);
    }

    #[test]
    fn test_execute_proposal() {
        let (env, signer1, signers) = setup();
        
        // Initialize
        MultiSignatureContract::initialize(
            env.clone(),
            signers.clone(),
            2,
            1,
            2,
            3,
            7 * 24 * 60 * 60,
        ).unwrap();
        
        // Create proposal
        let proposal_id = MultiSignatureContract::create_proposal(
            &env,
            OperationType::Standard,
            None,
            symbol_short!("test_fn"),
            vec![&env],
            signer1.clone(),
        ).unwrap();
        
        // Get other signers
        let signers_vec = MultiSignatureContract::get_signers(env.clone());
        let signer2 = signers_vec.get(1).unwrap();
        let signer3 = signers_vec.get(2).unwrap();
        
        // Approve with two signers
        MultiSignatureContract::approve_proposal(
            env.clone(),
            signer1.clone(),
            proposal_id,
        ).unwrap();
        
        MultiSignatureContract::approve_proposal(
            env.clone(),
            signer2.clone(),
            proposal_id,
        ).unwrap();
        
        // Execute
        let result = MultiSignatureContract::execute_proposal(
            env.clone(),
            signer3.clone(),
            proposal_id,
        ).unwrap();
        
        assert!(result);
        
        // Verify executed status
        let proposal = MultiSignatureContract::get_proposal(env.clone(), proposal_id).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Executed);
        
        // Verify execution record
        let record = MultiSignatureContract::get_execution_record(env.clone(), proposal_id);
        assert!(record.is_some());
    }

    #[test]
    fn test_add_signer_proposal() {
        let (env, signer1, signers) = setup();
        
        // Initialize
        MultiSignatureContract::initialize(
            env.clone(),
            signers.clone(),
            2,
            1,
            2,
            3,
            7 * 24 * 60 * 60,
        ).unwrap();
        
        let new_signer = Address::generate(&env);
        
        // Create add signer proposal
        let proposal_id = MultiSignatureContract::add_signer(
            env.clone(),
            signer1.clone(),
            new_signer.clone(),
        ).unwrap();
        
        // Get signers and approve
        let signers_vec = MultiSignatureContract::get_signers(env.clone());
        let signer2 = signers_vec.get(1).unwrap();
        
        MultiSignatureContract::approve_proposal(
            env.clone(),
            signer1.clone(),
            proposal_id,
        ).unwrap();
        
        MultiSignatureContract::approve_proposal(
            env.clone(),
            signer2.clone(),
            proposal_id,
        ).unwrap();
        
        // Execute
        MultiSignatureContract::execute_proposal(
            env.clone(),
            signer1.clone(),
            proposal_id,
        ).unwrap();
        
        // Verify new signer added
        let is_signer = MultiSignatureContract::is_signer(env.clone(), new_signer.clone());
        assert!(is_signer);
        
        let signer_count = MultiSignatureContract::get_signer_count(env.clone());
        assert_eq!(signer_count, 4);
    }

    #[test]
    fn test_change_threshold_proposal() {
        let (env, signer1, signers) = setup();
        
        // Initialize
        MultiSignatureContract::initialize(
            env.clone(),
            signers.clone(),
            2,
            1,
            2,
            3,
            7 * 24 * 60 * 60,
        ).unwrap();
        
        let initial_threshold = MultiSignatureContract::get_threshold(env.clone());
        assert_eq!(initial_threshold, 2);
        
        // Create change threshold proposal
        let proposal_id = MultiSignatureContract::change_threshold(
            env.clone(),
            signer1.clone(),
            3, // New threshold
        ).unwrap();
        
        // Get signers and approve
        let signers_vec = MultiSignatureContract::get_signers(env.clone());
        let signer2 = signers_vec.get(1).unwrap();
        
        MultiSignatureContract::approve_proposal(
            env.clone(),
            signer1.clone(),
            proposal_id,
        ).unwrap();
        
        MultiSignatureContract::approve_proposal(
            env.clone(),
            signer2.clone(),
            proposal_id,
        ).unwrap();
        
        // Execute
        MultiSignatureContract::execute_proposal(
            env.clone(),
            signer1.clone(),
            proposal_id,
        ).unwrap();
        
        // Verify threshold changed
        let new_threshold = MultiSignatureContract::get_threshold(env.clone());
        assert_eq!(new_threshold, 3);
    }

    #[test]
    fn test_cancel_proposal() {
        let (env, signer1, signers) = setup();
        
        // Initialize
        MultiSignatureContract::initialize(
            env.clone(),
            signers.clone(),
            2,
            1,
            2,
            3,
            7 * 24 * 60 * 60,
        ).unwrap();
        
        // Create proposal
        let proposal_id = MultiSignatureContract::create_proposal(
            &env,
            OperationType::Standard,
            None,
            symbol_short!("test_fn"),
            vec![&env],
            signer1.clone(),
        ).unwrap();
        
        // Cancel by creator
        MultiSignatureContract::cancel_proposal(
            env.clone(),
            signer1.clone(),
            proposal_id,
        ).unwrap();
        
        // Verify cancelled
        let proposal = MultiSignatureContract::get_proposal(env.clone(), proposal_id).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Cancelled);
    }

    #[test]
    fn test_operation_thresholds() {
        let (env, _, signers) = setup();
        
        // Initialize
        MultiSignatureContract::initialize(
            env.clone(),
            signers.clone(),
            3,
            1,
            2,
            3,
            7 * 24 * 60 * 60,
        ).unwrap();
        
        // Check different operation thresholds
        let read_threshold = MultiSignatureContract::get_operation_threshold(
            env.clone(), 
            OperationType::Read
        );
        assert_eq!(read_threshold, 1);
        
        let standard_threshold = MultiSignatureContract::get_operation_threshold(
            env.clone(), 
            OperationType::Standard
        );
        assert_eq!(standard_threshold, 2);
        
        let high_value_threshold = MultiSignatureContract::get_operation_threshold(
            env.clone(), 
            OperationType::HighValue
        );
        assert_eq!(high_value_threshold, 3);
        
        let critical_threshold = MultiSignatureContract::get_operation_threshold(
            env.clone(), 
            OperationType::Critical
        );
        assert_eq!(critical_threshold, 3);
    }

    #[test]
    fn test_non_signer_cannot_approve() {
        let (env, signer1, signers) = setup();
        
        // Initialize
        MultiSignatureContract::initialize(
            env.clone(),
            signers.clone(),
            2,
            1,
            2,
            3,
            7 * 24 * 60 * 60,
        ).unwrap();
        
        // Create proposal
        let proposal_id = MultiSignatureContract::create_proposal(
            &env,
            OperationType::Standard,
            None,
            symbol_short!("test_fn"),
            vec![&env],
            signer1.clone(),
        ).unwrap();
        
        // Try to approve with non-signer
        let non_signer = Address::generate(&env);
        let result = MultiSignatureContract::approve_proposal(
            env.clone(),
            non_signer,
            proposal_id,
        );
        
        assert!(result.is_err());
    }

    #[test]
    fn test_replay_protection_nonce() {
        let (env, signer1, signers) = setup();
        
        // Initialize
        MultiSignatureContract::initialize(
            env.clone(),
            signers.clone(),
            2,
            1,
            2,
            3,
            7 * 24 * 60 * 60,
        ).unwrap();
        
        // Create and execute multiple proposals
        let signers_vec = MultiSignatureContract::get_signers(env.clone());
        let signer2 = signers_vec.get(1).unwrap();
        
        for i in 0..3 {
            let proposal_id = MultiSignatureContract::create_proposal(
                &env,
                OperationType::Read,
                None,
                symbol_short!("test"),
                vec![&env],
                signer1.clone(),
            ).unwrap();
            
            MultiSignatureContract::approve_proposal(
                env.clone(),
                signer1.clone(),
                proposal_id,
            ).unwrap();
            
            MultiSignatureContract::approve_proposal(
                env.clone(),
                signer2.clone(),
                proposal_id,
            ).unwrap();
            
            MultiSignatureContract::execute_proposal(
                env.clone(),
                signer1.clone(),
                proposal_id,
            ).unwrap();
        }
        
        // Verify nonce incremented
        let record = MultiSignatureContract::get_execution_record(env.clone(), 3).unwrap();
        assert_eq!(record.nonce, 3);
    }
}
