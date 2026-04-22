//! # Proposal Module
//!
//! Defines proposal types, lifecycle states, and storage structures
//! for the governance voting system.

use soroban_sdk::{contracttype, Address, Env, String, Vec};

// ============================================================================
// Proposal Types
// ============================================================================

/// The type of vote options available for a proposal
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum VoteType {
    /// YES / NO binary vote
    Binary = 0,
    /// Multiple discrete options (index-based)
    MultiChoice = 1,
    /// Votes weighted by staked amount
    Weighted = 2,
}

/// The subject matter / category of a governance proposal
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum ProposalCategory {
    ParameterChange = 0,
    NewOracle = 1,
    EmergencyPause = 2,
    ContractUpgrade = 3,
    TreasuryAllocation = 4,
    Other = 5,
}

/// Lifecycle state of a proposal
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum ProposalStatus {
    /// Accepting votes
    Active = 0,
    /// Voting ended, awaiting execution
    Succeeded = 1,
    /// Voting ended, quorum/majority not met
    Defeated = 2,
    /// Executed on-chain
    Executed = 3,
    /// Cancelled by proposer or admin
    Cancelled = 4,
    /// Grace period expired without execution
    Expired = 5,
}

// ============================================================================
// Proposal Data Structures
// ============================================================================

/// Core proposal record stored on-chain
#[derive(Clone, Debug)]
#[contracttype]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub title: String,
    pub description: String,
    pub category: ProposalCategory,
    pub vote_type: VoteType,
    /// Number of options (2 for Binary, N for MultiChoice/Weighted)
    pub options_count: u32,
    /// Minimum stake required to vote (0 = no minimum)
    pub min_stake_to_vote: i128,
    /// Timestamp when voting opens
    pub voting_start: u64,
    /// Timestamp when voting closes
    pub voting_end: u64,
    /// Timestamp after which execution is allowed (voting_end + grace_period)
    pub execution_after: u64,
    /// Timestamp after which the proposal expires if not executed
    pub expires_at: u64,
    /// Minimum % of total eligible votes required (basis points, 10000 = 100%)
    pub quorum_bps: u32,
    /// Majority threshold in basis points (5000 = 50%, 6600 = 66%)
    pub majority_bps: u32,
    pub status: ProposalStatus,
    /// Index of the winning option (set after finalization)
    pub winning_option: Option<u32>,
    /// Total votes cast (sum across all options)
    pub total_votes: i128,
}

/// Per-option vote tally
#[derive(Clone, Debug)]
#[contracttype]
pub struct VoteTally {
    pub proposal_id: u64,
    pub option_index: u32,
    pub vote_count: i128,
}

// ============================================================================
// Storage Keys
// ============================================================================

#[contracttype]
pub enum ProposalKey {
    /// Next proposal ID counter
    NextId,
    /// Proposal by ID
    Proposal(u64),
    /// Vote tally for (proposal_id, option_index)
    Tally(u64, u32),
    /// Whether a voter has voted on a proposal
    HasVoted(u64, Address),
    /// Which option a voter chose
    VoterChoice(u64, Address),
    /// Whitelist for a proposal (empty = open to all eligible)
    Whitelist(u64),
    /// Blacklist for a proposal
    Blacklist(u64),
}

// ============================================================================
// Helpers
// ============================================================================

/// Allocate the next proposal ID (auto-increment)
pub fn next_proposal_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&ProposalKey::NextId)
        .unwrap_or(0u64);
    env.storage()
        .instance()
        .set(&ProposalKey::NextId, &(id + 1));
    id
}

/// Persist a proposal
pub fn save_proposal(env: &Env, proposal: &Proposal) {
    env.storage()
        .persistent()
        .set(&ProposalKey::Proposal(proposal.id), proposal);
}

/// Load a proposal, returning None if not found
pub fn load_proposal(env: &Env, id: u64) -> Option<Proposal> {
    env.storage().persistent().get(&ProposalKey::Proposal(id))
}

/// Add votes to an option tally
pub fn add_tally(env: &Env, proposal_id: u64, option_index: u32, weight: i128) {
    let key = ProposalKey::Tally(proposal_id, option_index);
    let current: i128 = env.storage().persistent().get(&key).unwrap_or(0i128);
    env.storage().persistent().set(&key, &(current + weight));
}

/// Read the tally for a specific option
pub fn get_tally(env: &Env, proposal_id: u64, option_index: u32) -> i128 {
    env.storage()
        .persistent()
        .get(&ProposalKey::Tally(proposal_id, option_index))
        .unwrap_or(0i128)
}

/// Mark that a voter has voted and record their choice
pub fn record_vote(env: &Env, proposal_id: u64, voter: &Address, option_index: u32) {
    env.storage()
        .persistent()
        .set(&ProposalKey::HasVoted(proposal_id, voter.clone()), &true);
    env.storage().persistent().set(
        &ProposalKey::VoterChoice(proposal_id, voter.clone()),
        &option_index,
    );
}

/// Check whether a voter has already voted on a proposal
pub fn has_voted(env: &Env, proposal_id: u64, voter: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&ProposalKey::HasVoted(proposal_id, voter.clone()))
        .unwrap_or(false)
}

/// Check if an address is blacklisted for a proposal
pub fn is_blacklisted(env: &Env, proposal_id: u64, voter: &Address) -> bool {
    let blacklist: Vec<Address> = env
        .storage()
        .persistent()
        .get(&ProposalKey::Blacklist(proposal_id))
        .unwrap_or_else(|| Vec::new(env));
    blacklist.contains(voter)
}

/// Check if a whitelist exists and whether the voter is on it
/// Returns true if voter is allowed (either no whitelist, or voter is listed)
pub fn is_whitelisted(env: &Env, proposal_id: u64, voter: &Address) -> bool {
    let whitelist: Vec<Address> = env
        .storage()
        .persistent()
        .get(&ProposalKey::Whitelist(proposal_id))
        .unwrap_or_else(|| Vec::new(env));
    // Empty whitelist means open to all
    whitelist.is_empty() || whitelist.contains(voter)
}
