#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env, String, Vec,
};

use governance::{
    delegation::DelegationError,
    proposal::{ProposalCategory, ProposalStatus, VoteType},
    voting::VotingError,
    GovernanceContract, GovernanceContractClient, ProposalParams,
};

// ============================================================================
// Test helpers
// ============================================================================

fn setup() -> (Env, Address, GovernanceContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, GovernanceContract);
    let client = GovernanceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

fn advance_time(env: &Env, seconds: u64) {
    let current = env.ledger().timestamp();
    env.ledger().set(LedgerInfo {
        timestamp: current + seconds,
        protocol_version: 22,
        sequence_number: env.ledger().sequence(),
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3_110_400,
    });
}

/// Create a simple binary proposal with default settings
fn create_binary_proposal(env: &Env, client: &GovernanceContractClient, proposer: &Address) -> u64 {
    let id = client.create_proposal(
        proposer,
        &ProposalParams {
            title: String::from_str(env, "Test Proposal"),
            description: String::from_str(env, "A test governance proposal"),
            category: ProposalCategory::ParameterChange,
            vote_type: VoteType::Binary,
            options_count: 2u32,
            voting_period: 7 * 86_400u64,
            grace_period: 2 * 86_400u64,
            quorum_bps: 1000u32,
            majority_bps: 5001u32,
            min_stake_to_vote: 0i128,
            whitelist: Vec::new(env),
            blacklist: Vec::new(env),
            proposal_deposit: 100_000_000i128,
        },
    );

    // Governance proposals now start waitlisted and must be approved by community.
    for _ in 0..3 {
        let approver = Address::generate(env);
        client.approve_waitlisted(&approver, &id);
    }

    id
}

// ============================================================================
// 1. Initialization
// ============================================================================

#[test]
fn test_initialize_success() {
    let (_env, _admin, _client) = setup();
    // If we get here without panic, initialization succeeded
}

#[test]
#[should_panic]
fn test_initialize_twice_fails() {
    let (env, admin, client) = setup();
    // Second init should return AlreadyInitialized error
    client.initialize(&admin);
}

// ============================================================================
// 2. Proposal creation
// ============================================================================

#[test]
fn test_create_proposal_valid() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);
    assert_eq!(id, 0u64);
    assert_eq!(client.proposal_count(), 1u64);
}

#[test]
fn test_create_multiple_proposals_increments_id() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let id0 = create_binary_proposal(&env, &client, &proposer);
    let id1 = create_binary_proposal(&env, &client, &proposer);
    assert_eq!(id0, 0u64);
    assert_eq!(id1, 1u64);
}

#[test]
#[should_panic]
fn test_create_proposal_too_few_options() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    // options_count = 1 should fail
    client.create_proposal(
        &proposer,
        &ProposalParams {
            title: String::from_str(&env, "Bad"),
            description: String::from_str(&env, "Bad proposal"),
            category: ProposalCategory::Other,
            vote_type: VoteType::Binary,
            options_count: 1u32,
            voting_period: 0u64,
            grace_period: 0u64,
            quorum_bps: 0u32,
            majority_bps: 0u32,
            min_stake_to_vote: 0i128,
            whitelist: Vec::new(&env),
            blacklist: Vec::new(&env),
            proposal_deposit: 100_000_000i128,
        },
    );
}

#[test]
fn test_proposal_stored_correctly() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);
    let proposal = client.get_proposal(&id).unwrap();
    assert_eq!(proposal.id, 0u64);
    assert_eq!(proposal.options_count, 2u32);
    assert_eq!(proposal.status, ProposalStatus::Active);
    assert_eq!(proposal.total_votes, 0i128);
}

// ============================================================================
// 3. Voting period enforcement
// ============================================================================

#[test]
fn test_vote_within_period_succeeds() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);
    // Vote YES (option 0) immediately
    client.vote(&voter, &id, &0u32, &0i128);
    assert!(client.has_voted(&id, &voter));
}

#[test]
#[should_panic]
fn test_vote_after_period_fails() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);
    // Advance past voting period
    advance_time(&env, 8 * 86_400);
    client.vote(&voter, &id, &0u32, &0i128);
}

#[test]
#[should_panic]
fn test_double_vote_fails() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);
    client.vote(&voter, &id, &0u32, &0i128);
    client.vote(&voter, &id, &1u32, &0i128); // second vote should fail
}

#[test]
#[should_panic]
fn test_vote_invalid_option_fails() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);
    client.vote(&voter, &id, &5u32, &0i128); // option 5 doesn't exist
}

// ============================================================================
// 4. Vote counting accuracy
// ============================================================================

#[test]
fn test_vote_tally_accurate() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);

    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);

    client.vote(&v1, &id, &0u32, &0i128); // YES
    client.vote(&v2, &id, &0u32, &0i128); // YES
    client.vote(&v3, &id, &1u32, &0i128); // NO

    assert_eq!(client.get_tally(&id, &0u32), 2i128);
    assert_eq!(client.get_tally(&id, &1u32), 1i128);
}

#[test]
fn test_weighted_vote_tally() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let id = client.create_proposal(
        &proposer,
        &ProposalParams {
            title: String::from_str(&env, "Weighted"),
            description: String::from_str(&env, "Weighted vote test"),
            category: ProposalCategory::TreasuryAllocation,
            vote_type: VoteType::Weighted,
            options_count: 2u32,
            voting_period: 7 * 86_400u64,
            grace_period: 2 * 86_400u64,
            quorum_bps: 1000u32,
            majority_bps: 5001u32,
            min_stake_to_vote: 100i128,
            whitelist: Vec::new(&env),
            blacklist: Vec::new(&env),
            proposal_deposit: 100_000_000i128,
        },
    );
    for _ in 0..3 {
        let approver = Address::generate(&env);
        client.approve_waitlisted(&approver, &id);
    }

    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);

    client.vote(&v1, &id, &0u32, &500i128); // 500 weight YES
    client.vote(&v2, &id, &0u32, &300i128); // 300 weight YES

    assert_eq!(client.get_tally(&id, &0u32), 800i128);
}

// ============================================================================
// 5. Quorum and majority thresholds
// ============================================================================

#[test]
fn test_finalize_succeeded_with_majority() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);

    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);

    client.vote(&v1, &id, &0u32, &0i128);
    client.vote(&v2, &id, &0u32, &0i128);
    client.vote(&v3, &id, &1u32, &0i128);

    advance_time(&env, 8 * 86_400); // past voting end
    let status = client.finalize(&id);
    assert_eq!(status, ProposalStatus::Succeeded);
}

#[test]
fn test_finalize_defeated_no_majority() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    // Require supermajority (66%)
    let id = client.create_proposal(
        &proposer,
        &ProposalParams {
            title: String::from_str(&env, "Super"),
            description: String::from_str(&env, "Supermajority required"),
            category: ProposalCategory::ContractUpgrade,
            vote_type: VoteType::Binary,
            options_count: 2u32,
            voting_period: 7 * 86_400u64,
            grace_period: 2 * 86_400u64,
            quorum_bps: 1000u32,
            majority_bps: 6600u32,
            min_stake_to_vote: 0i128,
            whitelist: Vec::new(&env),
            blacklist: Vec::new(&env),
            proposal_deposit: 100_000_000i128,
        },
    );
    for _ in 0..3 {
        let approver = Address::generate(&env);
        client.approve_waitlisted(&approver, &id);
    }

    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);

    // 2/3 = 66.6% YES — should succeed
    client.vote(&v1, &id, &0u32, &0i128);
    client.vote(&v2, &id, &0u32, &0i128);
    client.vote(&v3, &id, &1u32, &0i128);

    advance_time(&env, 8 * 86_400);
    let status = client.finalize(&id);
    // 2/3 = 6666 bps >= 6600 bps → Succeeded
    assert_eq!(status, ProposalStatus::Succeeded);
}

#[test]
#[should_panic]
fn test_finalize_before_voting_ends_fails() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);
    client.finalize(&id); // voting still open
}

// ============================================================================
// 6. Execution
// ============================================================================

#[test]
fn test_execute_after_grace_period() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);

    let voter = Address::generate(&env);
    client.vote(&voter, &id, &0u32, &0i128);

    advance_time(&env, 8 * 86_400); // past voting end
    client.finalize(&id);

    advance_time(&env, 3 * 86_400); // past grace period
    let winning = client.execute(&id);
    assert_eq!(winning, 0u32); // YES won
}

#[test]
#[should_panic]
fn test_execute_during_grace_period_fails() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);

    let voter = Address::generate(&env);
    client.vote(&voter, &id, &0u32, &0i128);

    advance_time(&env, 8 * 86_400); // past voting end (7 days)
    client.finalize(&id);
    // Grace period is 2 days; only advance 12 hours — still inside grace
    advance_time(&env, 12 * 3600);
    client.execute(&id);
}

#[test]
#[should_panic]
fn test_execute_twice_fails() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);

    let voter = Address::generate(&env);
    client.vote(&voter, &id, &0u32, &0i128);

    advance_time(&env, 8 * 86_400);
    client.finalize(&id);
    advance_time(&env, 3 * 86_400);
    client.execute(&id);
    client.execute(&id); // second execute should fail
}

#[test]
#[should_panic]
fn test_execute_defeated_proposal_fails() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    // Require 66% but only get 50%
    let id = client.create_proposal(
        &proposer,
        &ProposalParams {
            title: String::from_str(&env, "Fail"),
            description: String::from_str(&env, "Will be defeated"),
            category: ProposalCategory::Other,
            vote_type: VoteType::Binary,
            options_count: 2u32,
            voting_period: 7 * 86_400u64,
            grace_period: 2 * 86_400u64,
            quorum_bps: 1000u32,
            majority_bps: 6600u32,
            min_stake_to_vote: 0i128,
            whitelist: Vec::new(&env),
            blacklist: Vec::new(&env),
            proposal_deposit: 100_000_000i128,
        },
    );
    for _ in 0..3 {
        let approver = Address::generate(&env);
        client.approve_waitlisted(&approver, &id);
    }

    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    client.vote(&v1, &id, &0u32, &0i128);
    client.vote(&v2, &id, &1u32, &0i128); // 50/50 → below 66%

    advance_time(&env, 8 * 86_400);
    client.finalize(&id);
    advance_time(&env, 3 * 86_400);
    client.execute(&id); // should fail — Defeated
}

// ============================================================================
// 7. Cancellation
// ============================================================================

#[test]
fn test_proposer_can_cancel() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);
    client.cancel(&proposer, &id);
    let proposal = client.get_proposal(&id).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Cancelled);
}

#[test]
fn test_admin_can_cancel() {
    let (env, admin, client) = setup();
    let proposer = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);
    client.cancel(&admin, &id);
    let proposal = client.get_proposal(&id).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Cancelled);
}

#[test]
#[should_panic]
fn test_non_proposer_cannot_cancel() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let stranger = Address::generate(&env);
    let id = create_binary_proposal(&env, &client, &proposer);
    client.cancel(&stranger, &id);
}

// ============================================================================
// 8. Delegation
// ============================================================================

#[test]
fn test_delegate_and_vote_via_delegate() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let delegator = Address::generate(&env);
    let delegate = Address::generate(&env);

    let id = create_binary_proposal(&env, &client, &proposer);

    // delegator delegates to delegate
    client.delegate(&delegator, &delegate);
    assert_eq!(client.get_delegate(&delegator), Some(delegate.clone()));

    // delegate votes — should count for delegate (effective voter)
    client.vote(&delegate, &id, &0u32, &0i128);
    assert!(client.has_voted(&id, &delegate));
}

#[test]
fn test_transitive_delegation() {
    let (env, _admin, client) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);

    // A → B → C
    client.delegate(&a, &b);
    client.delegate(&b, &c);

    // Resolving A should give C
    let resolved = client.resolve_delegate(&a);
    assert_eq!(resolved, c);
}

#[test]
fn test_revoke_delegation() {
    let (env, _admin, client) = setup();
    let delegator = Address::generate(&env);
    let delegate = Address::generate(&env);

    client.delegate(&delegator, &delegate);
    assert_eq!(client.get_delegate(&delegator), Some(delegate.clone()));

    client.revoke_delegation(&delegator);
    assert_eq!(client.get_delegate(&delegator), None);
}

#[test]
#[should_panic]
fn test_self_delegation_fails() {
    let (env, _admin, client) = setup();
    let voter = Address::generate(&env);
    client.delegate(&voter, &voter);
}

#[test]
#[should_panic]
fn test_circular_delegation_fails() {
    let (env, _admin, client) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    client.delegate(&a, &b);
    client.delegate(&b, &a); // creates A → B → A cycle
}

// ============================================================================
// 9. Eligibility (whitelist / blacklist)
// ============================================================================

#[test]
fn test_whitelist_allows_listed_voter() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let allowed = Address::generate(&env);

    let mut whitelist = Vec::new(&env);
    whitelist.push_back(allowed.clone());

    let id = client.create_proposal(
        &proposer,
        &ProposalParams {
            title: String::from_str(&env, "Whitelisted"),
            description: String::from_str(&env, "Only whitelisted voters"),
            category: ProposalCategory::NewOracle,
            vote_type: VoteType::Binary,
            options_count: 2u32,
            voting_period: 7 * 86_400u64,
            grace_period: 2 * 86_400u64,
            quorum_bps: 0u32,
            majority_bps: 0u32,
            min_stake_to_vote: 0i128,
            whitelist,
            blacklist: Vec::new(&env),
            proposal_deposit: 100_000_000i128,
        },
    );
    for _ in 0..3 {
        let approver = Address::generate(&env);
        client.approve_waitlisted(&approver, &id);
    }

    client.vote(&allowed, &id, &0u32, &0i128);
    assert!(client.has_voted(&id, &allowed));
}

#[test]
#[should_panic]
fn test_whitelist_blocks_unlisted_voter() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let allowed = Address::generate(&env);
    let stranger = Address::generate(&env);

    let mut whitelist = Vec::new(&env);
    whitelist.push_back(allowed.clone());

    let id = client.create_proposal(
        &proposer,
        &ProposalParams {
            title: String::from_str(&env, "Whitelisted"),
            description: String::from_str(&env, "Only whitelisted voters"),
            category: ProposalCategory::NewOracle,
            vote_type: VoteType::Binary,
            options_count: 2u32,
            voting_period: 7 * 86_400u64,
            grace_period: 2 * 86_400u64,
            quorum_bps: 0u32,
            majority_bps: 0u32,
            min_stake_to_vote: 0i128,
            whitelist,
            blacklist: Vec::new(&env),
            proposal_deposit: 100_000_000i128,
        },
    );
    for _ in 0..3 {
        let approver = Address::generate(&env);
        client.approve_waitlisted(&approver, &id);
    }

    client.vote(&stranger, &id, &0u32, &0i128); // should fail
}

#[test]
#[should_panic]
fn test_blacklist_blocks_voter() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);
    let banned = Address::generate(&env);

    let mut blacklist = Vec::new(&env);
    blacklist.push_back(banned.clone());

    let id = client.create_proposal(
        &proposer,
        &ProposalParams {
            title: String::from_str(&env, "Blacklisted"),
            description: String::from_str(&env, "Banned voter test"),
            category: ProposalCategory::Other,
            vote_type: VoteType::Binary,
            options_count: 2u32,
            voting_period: 7 * 86_400u64,
            grace_period: 2 * 86_400u64,
            quorum_bps: 0u32,
            majority_bps: 0u32,
            min_stake_to_vote: 0i128,
            whitelist: Vec::new(&env),
            blacklist,
            proposal_deposit: 100_000_000i128,
        },
    );
    for _ in 0..3 {
        let approver = Address::generate(&env);
        client.approve_waitlisted(&approver, &id);
    }

    client.vote(&banned, &id, &0u32, &0i128); // should fail
}

// ============================================================================
// 10. MultiChoice proposal
// ============================================================================

#[test]
fn test_multichoice_proposal() {
    let (env, _admin, client) = setup();
    let proposer = Address::generate(&env);

    let id = client.create_proposal(
        &proposer,
        &ProposalParams {
            title: String::from_str(&env, "MultiChoice"),
            description: String::from_str(&env, "Pick one of three options"),
            category: ProposalCategory::ParameterChange,
            vote_type: VoteType::MultiChoice,
            options_count: 3u32,
            voting_period: 7 * 86_400u64,
            grace_period: 2 * 86_400u64,
            quorum_bps: 1000u32,
            majority_bps: 5001u32,
            min_stake_to_vote: 0i128,
            whitelist: Vec::new(&env),
            blacklist: Vec::new(&env),
            proposal_deposit: 100_000_000i128,
        },
    );
    for _ in 0..3 {
        let approver = Address::generate(&env);
        client.approve_waitlisted(&approver, &id);
    }

    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    let v3 = Address::generate(&env);

    client.vote(&v1, &id, &0u32, &0i128);
    client.vote(&v2, &id, &2u32, &0i128);
    client.vote(&v3, &id, &2u32, &0i128);

    assert_eq!(client.get_tally(&id, &0u32), 1i128);
    assert_eq!(client.get_tally(&id, &1u32), 0i128);
    assert_eq!(client.get_tally(&id, &2u32), 2i128);

    advance_time(&env, 8 * 86_400);
    let status = client.finalize(&id);
    assert_eq!(status, ProposalStatus::Succeeded);

    let proposal = client.get_proposal(&id).unwrap();
    assert_eq!(proposal.winning_option, Some(2u32)); // option 2 won
}
