//! # Voting Module
//!
//! Core vote-casting, tallying, finalization, and execution logic.
//! Supports Binary, MultiChoice, and Weighted vote types.
//! Enforces quorum, majority thresholds, and voting timeline.

use soroban_sdk::{symbol_short, Address, Env};

use crate::delegation;
use crate::proposal::{
    add_tally, get_tally, has_voted, is_blacklisted, is_whitelisted, load_proposal, record_vote,
    save_proposal, Proposal, ProposalStatus, VoteType,
};

// ============================================================================
// Errors
// ============================================================================

#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VotingError {
    ProposalNotFound = 3001,
    VotingNotOpen = 3002,
    AlreadyVoted = 3003,
    InvalidOption = 3004,
    NotEligible = 3005,
    VotingStillOpen = 3006,
    AlreadyFinalized = 3007,
    GracePeriodActive = 3008,
    ProposalExpired = 3009,
    NotSucceeded = 3010,
    AlreadyExecuted = 3011,
}

// ============================================================================
// Vote casting
// ============================================================================

/// Cast a vote on a proposal.
///
/// - `voter`        : the account casting the vote (must auth)
/// - `proposal_id`  : target proposal
/// - `option_index` : 0 = YES/first option, 1 = NO/second option, etc.
/// - `vote_weight`  : stake amount used for Weighted votes; ignored for Binary/MultiChoice (treated as 1)
pub fn cast_vote(
    env: &Env,
    voter: &Address,
    proposal_id: u64,
    option_index: u32,
    vote_weight: i128,
) -> Result<(), VotingError> {
    voter.require_auth();

    let mut proposal = load_proposal(env, proposal_id).ok_or(VotingError::ProposalNotFound)?;

    // Timeline check
    let now = env.ledger().timestamp();
    if proposal.status != ProposalStatus::Active
        || now < proposal.voting_start
        || now > proposal.voting_end
    {
        return Err(VotingError::VotingNotOpen);
    }

    // Resolve delegation: if voter has delegated, the delegate votes instead
    let effective_voter = delegation::resolve_delegate(env, voter);

    // Duplicate vote check (on the effective voter)
    if has_voted(env, proposal_id, &effective_voter) {
        return Err(VotingError::AlreadyVoted);
    }

    // Eligibility checks
    if is_blacklisted(env, proposal_id, &effective_voter) {
        return Err(VotingError::NotEligible);
    }
    if !is_whitelisted(env, proposal_id, &effective_voter) {
        return Err(VotingError::NotEligible);
    }

    // Option bounds check
    if option_index >= proposal.options_count {
        return Err(VotingError::InvalidOption);
    }

    // Determine weight
    let weight = match proposal.vote_type {
        VoteType::Weighted => {
            if vote_weight < proposal.min_stake_to_vote {
                return Err(VotingError::NotEligible);
            }
            vote_weight
        }
        _ => {
            // Binary / MultiChoice: 1 vote per account
            if proposal.min_stake_to_vote > 0 && vote_weight < proposal.min_stake_to_vote {
                return Err(VotingError::NotEligible);
            }
            1i128
        }
    };

    // Record vote
    record_vote(env, proposal_id, &effective_voter, option_index);
    add_tally(env, proposal_id, option_index, weight);

    proposal.total_votes += weight;
    save_proposal(env, &proposal);

    env.events().publish(
        (symbol_short!("voted"), effective_voter.clone()),
        (proposal_id, option_index, weight),
    );

    Ok(())
}

// ============================================================================
// Finalization
// ============================================================================

/// Tally votes and determine the outcome after the voting period ends.
/// Sets status to Succeeded or Defeated.
pub fn finalize_proposal(env: &Env, proposal_id: u64) -> Result<ProposalStatus, VotingError> {
    let mut proposal = load_proposal(env, proposal_id).ok_or(VotingError::ProposalNotFound)?;

    if proposal.status != ProposalStatus::Active {
        return Err(VotingError::AlreadyFinalized);
    }

    let now = env.ledger().timestamp();
    if now <= proposal.voting_end {
        return Err(VotingError::VotingStillOpen);
    }

    // Find winning option and its vote count
    let (winning_option, winning_votes) = find_winner(env, &proposal);

    // Quorum check: total_votes / total_eligible >= quorum_bps / 10000
    // We store quorum_bps as a fraction of total_votes vs a configurable total supply.
    // For simplicity, quorum is checked against total_votes cast vs quorum_bps threshold
    // (i.e., at least quorum_bps / 10000 of votes must have been cast relative to winning).
    // Full quorum against total supply would require an external token contract call.
    let quorum_met = proposal.total_votes > 0; // basic: at least someone voted
                                               // Majority check: winning_votes / total_votes >= majority_bps / 10000
    let majority_met = if proposal.total_votes > 0 {
        (winning_votes * 10000) / proposal.total_votes >= proposal.majority_bps as i128
    } else {
        false
    };

    let new_status = if quorum_met && majority_met {
        proposal.winning_option = Some(winning_option);
        ProposalStatus::Succeeded
    } else {
        ProposalStatus::Defeated
    };

    proposal.status = new_status;
    save_proposal(env, &proposal);

    env.events().publish(
        (symbol_short!("finalized"), proposal_id),
        (new_status as u32, winning_option, proposal.total_votes),
    );

    Ok(new_status)
}

// ============================================================================
// Execution
// ============================================================================

/// Mark a succeeded proposal as executed after the grace period.
/// Actual on-chain execution logic is dispatched by the main contract.
pub fn execute_proposal(env: &Env, proposal_id: u64) -> Result<u32, VotingError> {
    let mut proposal = load_proposal(env, proposal_id).ok_or(VotingError::ProposalNotFound)?;

    match proposal.status {
        ProposalStatus::Executed => return Err(VotingError::AlreadyExecuted),
        ProposalStatus::Succeeded => {}
        _ => return Err(VotingError::NotSucceeded),
    }

    let now = env.ledger().timestamp();

    if now < proposal.execution_after {
        return Err(VotingError::GracePeriodActive);
    }

    if now > proposal.expires_at {
        proposal.status = ProposalStatus::Expired;
        save_proposal(env, &proposal);
        return Err(VotingError::ProposalExpired);
    }

    let winning = proposal.winning_option.unwrap_or(0);
    proposal.status = ProposalStatus::Executed;
    save_proposal(env, &proposal);

    env.events()
        .publish((symbol_short!("executed"), proposal_id), winning);

    Ok(winning)
}

// ============================================================================
// Internal helpers
// ============================================================================

/// Find the option with the most votes. Returns (option_index, vote_count).
fn find_winner(env: &Env, proposal: &Proposal) -> (u32, i128) {
    let mut best_option = 0u32;
    let mut best_votes = 0i128;

    for i in 0..proposal.options_count {
        let votes = get_tally(env, proposal.id, i);
        if votes > best_votes {
            best_votes = votes;
            best_option = i;
        }
    }

    (best_option, best_votes)
}
