//! # Governance Contract
//!
//! Community-governed parameter changes via on-chain proposals and voting.
//!
//! ## Features
//!
//! - **Proposals**: Create proposals with description, options, and deadline
//! - **Vote Types**: Binary (YES/NO), MultiChoice, Weighted (by stake)
//! - **Eligibility**: Minimum stake, per-proposal whitelist/blacklist
//! - **Timeline**: Voting period → Grace period → Execution window → Expiry
//! - **Thresholds**: Configurable quorum and majority (simple or supermajority)
//! - **Delegation**: Transitive vote delegation, revocable at any time
//! - **Execution**: Winning option executed after grace period
//!
//! ## Proposal Lifecycle
//!
//! 1. `create_proposal` — proposer submits with options and deadline
//! 2. `cast_vote`       — eligible voters cast votes during voting period
//! 3. `finalize`        — anyone calls after voting_end to tally results
//! 4. `execute`         — anyone calls after grace period to execute winner

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec};

pub mod delegation;
pub mod proposal;
pub mod voting;

// ============================================================================
// Governance-level errors
// ============================================================================

#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum GovernanceError {
    AlreadyInitialized = 1001,
    NotInitialized = 1002,
    NotAuthorized = 1003,
    InvalidParameter = 1004,
    ProposalNotFound = 1005,
    AlreadyFinalized = 1006,
}

use delegation::DelegationError;
use proposal::{
    load_proposal, next_proposal_id, save_proposal, Proposal, ProposalCategory, ProposalKey,
    ProposalStatus, VoteType,
};
use voting::{cast_vote, execute_proposal, finalize_proposal, VotingError};

// ============================================================================
// Storage Keys (contract-level config)
// ============================================================================

#[contracttype]
pub enum ConfigKey {
    Admin,
    Initialized,
    /// Default voting period in seconds
    DefaultVotingPeriod,
    /// Default grace period in seconds
    DefaultGracePeriod,
    /// Default expiry window in seconds (after execution_after)
    DefaultExpiryWindow,
    /// Default quorum in basis points
    DefaultQuorumBps,
    /// Default simple majority in basis points
    DefaultMajorityBps,
    /// Supermajority threshold in basis points (for critical proposals)
    SupermajorityBps,
    /// Minimum stake required to create a proposal
    MinStakeToPropose,
    /// Minimum required proposal deposit for waitlisted submissions
    ProposalDepositRequired,
    /// Number of community approvals required to activate a waitlisted proposal
    ProposalWaitlistThreshold,
}

// ============================================================================
// Input structs (Soroban limits contract fns to 10 params)
// ============================================================================

/// Parameters for creating a new proposal
#[contracttype]
#[derive(Clone)]
pub struct ProposalParams {
    pub title: String,
    pub description: String,
    pub category: ProposalCategory,
    pub vote_type: VoteType,
    /// Number of vote options (minimum 2)
    pub options_count: u32,
    /// Voting duration in seconds (0 = use contract default)
    pub voting_period: u64,
    /// Grace period in seconds (0 = use contract default)
    pub grace_period: u64,
    /// Quorum in basis points (0 = use contract default)
    pub quorum_bps: u32,
    /// Majority threshold in basis points (0 = use contract default)
    pub majority_bps: u32,
    /// Minimum stake/tokens required to vote (0 = no minimum)
    pub min_stake_to_vote: i128,
    /// Optional voter whitelist (empty = open to all eligible)
    pub whitelist: Vec<Address>,
    /// Optional voter blacklist
    pub blacklist: Vec<Address>,
    /// Deposit attached to proposal submission
    pub proposal_deposit: i128,
}

// ============================================================================
// Constants
// ============================================================================

const SECONDS_PER_DAY: u64 = 86_400;
const DEFAULT_VOTING_PERIOD: u64 = 7 * SECONDS_PER_DAY; // 7 days
const DEFAULT_GRACE_PERIOD: u64 = 2 * SECONDS_PER_DAY; // 2 days
const DEFAULT_EXPIRY_WINDOW: u64 = 7 * SECONDS_PER_DAY; // 7 days after grace
const DEFAULT_QUORUM_BPS: u32 = 1000; // 10%
const DEFAULT_MAJORITY_BPS: u32 = 5001; // >50%
const SUPERMAJORITY_BPS: u32 = 6600; // >66%
const MIN_STAKE_TO_PROPOSE: i128 = 1_000_000_000; // 1000 tokens (6 decimals)
const PROPOSAL_DEPOSIT_REQUIRED: i128 = 100_000_000; // 100 tokens (6 decimals)
const PROPOSAL_WAITLIST_THRESHOLD: u32 = 3;

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    // -------------------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------------------

    /// Initialize the governance contract.
    pub fn initialize(env: Env, admin: Address) -> Result<(), GovernanceError> {
        if env.storage().instance().has(&ConfigKey::Initialized) {
            return Err(GovernanceError::AlreadyInitialized);
        }

        env.storage().instance().set(&ConfigKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&ConfigKey::DefaultVotingPeriod, &DEFAULT_VOTING_PERIOD);
        env.storage()
            .instance()
            .set(&ConfigKey::DefaultGracePeriod, &DEFAULT_GRACE_PERIOD);
        env.storage()
            .instance()
            .set(&ConfigKey::DefaultExpiryWindow, &DEFAULT_EXPIRY_WINDOW);
        env.storage()
            .instance()
            .set(&ConfigKey::DefaultQuorumBps, &DEFAULT_QUORUM_BPS);
        env.storage()
            .instance()
            .set(&ConfigKey::DefaultMajorityBps, &DEFAULT_MAJORITY_BPS);
        env.storage()
            .instance()
            .set(&ConfigKey::SupermajorityBps, &SUPERMAJORITY_BPS);
        env.storage()
            .instance()
            .set(&ConfigKey::MinStakeToPropose, &MIN_STAKE_TO_PROPOSE);
        env.storage()
            .instance()
            .set(&ConfigKey::ProposalDepositRequired, &PROPOSAL_DEPOSIT_REQUIRED);
        env.storage()
            .instance()
            .set(&ConfigKey::ProposalWaitlistThreshold, &PROPOSAL_WAITLIST_THRESHOLD);
        env.storage().instance().set(&ConfigKey::Initialized, &true);

        env.events()
            .publish((symbol_short!("gov_init"), admin), symbol_short!("ok"));

        Ok(())
    }

    // -------------------------------------------------------------------------
    // Proposal creation
    // -------------------------------------------------------------------------

    /// Create a new governance proposal.
    ///
    /// Proposal configuration is passed as a `ProposalParams` struct to stay
    /// within Soroban's 10-parameter limit for contract functions.
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        params: ProposalParams,
    ) -> Result<u64, GovernanceError> {
        proposer.require_auth();

        if params.options_count < 2 {
            return Err(GovernanceError::InvalidParameter);
        }
        if params.min_stake_to_vote < 0 || params.proposal_deposit < 0 {
            return Err(GovernanceError::InvalidParameter);
        }

        let required_deposit: i128 = env
            .storage()
            .instance()
            .get(&ConfigKey::ProposalDepositRequired)
            .unwrap_or(PROPOSAL_DEPOSIT_REQUIRED);
        if params.proposal_deposit < required_deposit {
            return Err(GovernanceError::InvalidParameter);
        }

        let vp: u64 = if params.voting_period == 0 {
            env.storage()
                .instance()
                .get(&ConfigKey::DefaultVotingPeriod)
                .unwrap_or(DEFAULT_VOTING_PERIOD)
        } else {
            params.voting_period
        };

        let gp: u64 = if params.grace_period == 0 {
            env.storage()
                .instance()
                .get(&ConfigKey::DefaultGracePeriod)
                .unwrap_or(DEFAULT_GRACE_PERIOD)
        } else {
            params.grace_period
        };

        let q_bps: u32 = if params.quorum_bps == 0 {
            env.storage()
                .instance()
                .get(&ConfigKey::DefaultQuorumBps)
                .unwrap_or(DEFAULT_QUORUM_BPS)
        } else {
            params.quorum_bps
        };

        let m_bps: u32 = if params.majority_bps == 0 {
            env.storage()
                .instance()
                .get(&ConfigKey::DefaultMajorityBps)
                .unwrap_or(DEFAULT_MAJORITY_BPS)
        } else {
            params.majority_bps
        };

        let expiry_window: u64 = env
            .storage()
            .instance()
            .get(&ConfigKey::DefaultExpiryWindow)
            .unwrap_or(DEFAULT_EXPIRY_WINDOW);

        let now = env.ledger().timestamp();
        let waitlist_threshold: u32 = env
            .storage()
            .instance()
            .get(&ConfigKey::ProposalWaitlistThreshold)
            .unwrap_or(PROPOSAL_WAITLIST_THRESHOLD);
        let voting_end = now;
        let execution_after = now;
        let expires_at = now + expiry_window;

        let id = next_proposal_id(&env);

        let proposal = Proposal {
            id,
            proposer: proposer.clone(),
            title: params.title,
            description: params.description,
            category: params.category,
            vote_type: params.vote_type,
            options_count: params.options_count,
            min_stake_to_vote: params.min_stake_to_vote,
            voting_start: 0,
            voting_end,
            voting_period: vp,
            execution_after,
            grace_period: gp,
            expires_at,
            quorum_bps: q_bps,
            majority_bps: m_bps,
            status: ProposalStatus::Waitlisted,
            winning_option: None,
            total_votes: 0,
            proposal_deposit: params.proposal_deposit,
            deposit_refunded: false,
            waitlist_approvals: 0,
            waitlist_threshold,
        };

        save_proposal(&env, &proposal);

        if !params.whitelist.is_empty() {
            env.storage()
                .persistent()
                .set(&ProposalKey::Whitelist(id), &params.whitelist);
        }
        if !params.blacklist.is_empty() {
            env.storage()
                .persistent()
                .set(&ProposalKey::Blacklist(id), &params.blacklist);
        }

        env.events().publish(
            (symbol_short!("proposed"), proposer),
            (id, params.category as u32, params.vote_type as u32),
        );

        Ok(id)
    }

    /// Community approval for a waitlisted proposal.
    /// Once threshold is reached, proposal becomes active and voting opens.
    pub fn approve_waitlisted(
        env: Env,
        approver: Address,
        proposal_id: u64,
    ) -> Result<ProposalStatus, VotingError> {
        approver.require_auth();
        let mut proposal = load_proposal(&env, proposal_id).ok_or(VotingError::ProposalNotFound)?;
        if proposal.status != ProposalStatus::Waitlisted {
            return Err(VotingError::VotingNotOpen);
        }
        if proposal::has_waitlist_approved(&env, proposal_id, &approver) {
            return Err(VotingError::AlreadyVoted);
        }

        proposal::mark_waitlist_approval(&env, proposal_id, &approver);
        proposal.waitlist_approvals += 1;

        if proposal.waitlist_approvals >= proposal.waitlist_threshold {
            let now = env.ledger().timestamp();
            let expiry_window: u64 = env
                .storage()
                .instance()
                .get(&ConfigKey::DefaultExpiryWindow)
                .unwrap_or(DEFAULT_EXPIRY_WINDOW);

            proposal.status = ProposalStatus::Active;
            proposal.voting_start = now;
            proposal.voting_end = now + proposal.voting_period;
            proposal.execution_after = proposal.voting_end + proposal.grace_period;
            proposal.expires_at = proposal.execution_after + expiry_window;
        }

        let status = proposal.status;
        save_proposal(&env, &proposal);
        Ok(status)
    }

    // -------------------------------------------------------------------------
    // Voting
    // -------------------------------------------------------------------------

    /// Cast a vote on an active proposal.
    ///
    /// For Weighted proposals, `vote_weight` should be the voter's staked amount.
    /// For Binary/MultiChoice, `vote_weight` is used only for eligibility checks.
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        option_index: u32,
        vote_weight: i128,
    ) -> Result<(), VotingError> {
        cast_vote(&env, &voter, proposal_id, option_index, vote_weight)
    }

    // -------------------------------------------------------------------------
    // Finalization & Execution
    // -------------------------------------------------------------------------

    /// Tally votes and set proposal outcome. Callable by anyone after voting ends.
    pub fn finalize(env: Env, proposal_id: u64) -> Result<ProposalStatus, VotingError> {
        finalize_proposal(&env, proposal_id)
    }

    /// Execute the winning option after the grace period. Callable by anyone.
    /// Returns the winning option index.
    pub fn execute(env: Env, proposal_id: u64) -> Result<u32, VotingError> {
        execute_proposal(&env, proposal_id)
    }

    /// Cancel a proposal (proposer or admin only).
    pub fn cancel(env: Env, caller: Address, proposal_id: u64) -> Result<(), GovernanceError> {
        caller.require_auth();

        let mut proposal =
            load_proposal(&env, proposal_id).ok_or(GovernanceError::ProposalNotFound)?;

        let admin: Address = env
            .storage()
            .instance()
            .get(&ConfigKey::Admin)
            .ok_or(GovernanceError::NotInitialized)?;

        if caller != proposal.proposer && caller != admin {
            return Err(GovernanceError::NotAuthorized);
        }

        if proposal.status != ProposalStatus::Active {
            return Err(GovernanceError::AlreadyFinalized);
        }

        proposal.status = ProposalStatus::Cancelled;
        save_proposal(&env, &proposal);

        env.events()
            .publish((symbol_short!("cancelled"), caller), proposal_id);

        Ok(())
    }

    // -------------------------------------------------------------------------
    // Delegation
    // -------------------------------------------------------------------------

    /// Delegate your voting power to another address.
    pub fn delegate(
        env: Env,
        delegator: Address,
        delegate: Address,
    ) -> Result<(), DelegationError> {
        delegator.require_auth();
        delegation::delegate(&env, &delegator, &delegate)
    }

    /// Revoke your current delegation.
    pub fn revoke_delegation(env: Env, delegator: Address) -> Result<(), DelegationError> {
        delegator.require_auth();
        delegation::revoke(&env, &delegator)
    }

    /// Get the current delegate for an address.
    pub fn get_delegate(env: Env, delegator: Address) -> Option<Address> {
        delegation::get_delegate(&env, &delegator)
    }

    /// Resolve the effective voter (follows the full delegation chain).
    pub fn resolve_delegate(env: Env, voter: Address) -> Address {
        delegation::resolve_delegate(&env, &voter)
    }

    // -------------------------------------------------------------------------
    // Queries
    // -------------------------------------------------------------------------

    /// Get a proposal by ID.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<Proposal> {
        load_proposal(&env, proposal_id)
    }

    /// Check whether the proposer deposit has been refunded for a proposal.
    pub fn is_deposit_refunded(env: Env, proposal_id: u64) -> bool {
        load_proposal(&env, proposal_id)
            .map(|p| p.deposit_refunded)
            .unwrap_or(false)
    }

    /// Get the vote tally for a specific option.
    pub fn get_tally(env: Env, proposal_id: u64, option_index: u32) -> i128 {
        proposal::get_tally(&env, proposal_id, option_index)
    }

    /// Check whether an address has voted on a proposal.
    pub fn has_voted(env: Env, proposal_id: u64, voter: Address) -> bool {
        proposal::has_voted(&env, proposal_id, &voter)
    }

    /// Get the total number of proposals created.
    pub fn proposal_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&ProposalKey::NextId)
            .unwrap_or(0u64)
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    /// Update default governance parameters (admin only).
    pub fn update_config(
        env: Env,
        admin: Address,
        default_voting_period: u64,
        default_grace_period: u64,
        default_quorum_bps: u32,
        default_majority_bps: u32,
        supermajority_bps: u32,
    ) -> Result<(), GovernanceError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&ConfigKey::Admin)
            .ok_or(GovernanceError::NotInitialized)?;
        if stored_admin != admin {
            return Err(GovernanceError::NotAuthorized);
        }

        if default_voting_period > 0 {
            env.storage()
                .instance()
                .set(&ConfigKey::DefaultVotingPeriod, &default_voting_period);
        }
        if default_grace_period > 0 {
            env.storage()
                .instance()
                .set(&ConfigKey::DefaultGracePeriod, &default_grace_period);
        }
        if default_quorum_bps > 0 {
            env.storage()
                .instance()
                .set(&ConfigKey::DefaultQuorumBps, &default_quorum_bps);
        }
        if default_majority_bps > 0 {
            env.storage()
                .instance()
                .set(&ConfigKey::DefaultMajorityBps, &default_majority_bps);
        }
        if supermajority_bps > 0 {
            env.storage()
                .instance()
                .set(&ConfigKey::SupermajorityBps, &supermajority_bps);
        }

        Ok(())
    }
}
