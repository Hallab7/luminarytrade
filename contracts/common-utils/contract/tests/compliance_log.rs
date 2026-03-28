//! # Compliance Log Integration Tests
//!
//! Standalone integration-test suite for `ComplianceLogger`.
//! This file lives in `contracts/common-utils/tests/compliance_log.rs`
//! and is compiled as part of the `common-utils` crate's `[dev-dependencies]`
//! integration tests.
//!
//! Run with:
//!   cd contracts/common-utils/contract && cargo test

#![cfg(test)]

use common_utils::compliance_log::{
    ComplianceAction, ComplianceLogger, compute_merkle_root,
};
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, Vec};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn env_and_admin() -> (Env, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    ComplianceLogger::initialize(&env, admin.clone());
    (env, admin)
}

fn tx(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0xcd; 32])
}

fn empty(env: &Env) -> Bytes {
    Bytes::new(env)
}

fn bytes_u32(env: &Env, n: u32) -> Bytes {
    Bytes::from_slice(env, &n.to_le_bytes())
}

fn tgt(env: &Env, s: &[u8]) -> Bytes {
    Bytes::from_slice(env, s)
}

// ---------------------------------------------------------------------------
// Smoke test: full lifecycle
// ---------------------------------------------------------------------------

#[test]
fn integration_full_lifecycle() {
    let (env, admin) = env_and_admin();
    let actor = Address::generate(&env);
    let auditor = Address::generate(&env);

    // Add auditor
    ComplianceLogger::add_auditor(&env, admin.clone(), auditor.clone());

    // Append multiple event types
    let id1 = ComplianceLogger::append(
        &env, actor.clone(), ComplianceAction::RoleAssigned,
        tgt(&env, b"alice"), empty(&env), bytes_u32(&env, 2), tx(&env),
    );
    let id2 = ComplianceLogger::append(
        &env, actor.clone(), ComplianceAction::CreditScoreComputed,
        tgt(&env, b"alice"), bytes_u32(&env, 600), bytes_u32(&env, 720), tx(&env),
    );
    let id3 = ComplianceLogger::append(
        &env, actor.clone(), ComplianceAction::ProposalCreated,
        tgt(&env, b"prop_42"), empty(&env), empty(&env), tx(&env),
    );

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(id3, 3);
    assert_eq!(ComplianceLogger::log_count(&env), 3);

    // Auditor can read
    let log = ComplianceLogger::get_log(&env, auditor.clone(), 2);
    assert_eq!(log.action, ComplianceAction::CreditScoreComputed.to_u32());

    // Admin can verify chain
    assert!(ComplianceLogger::verify_chain(&env, admin.clone(), 1, 3));

    // Page query
    let page = ComplianceLogger::get_logs_page(&env, admin.clone(), 1, 3);
    assert_eq!(page.len(), 3);
}

// ---------------------------------------------------------------------------
// Immutability: no update / delete exposed
// ---------------------------------------------------------------------------

#[test]
fn integration_immutability_only_append() {
    let (env, admin) = env_and_admin();
    let actor = Address::generate(&env);

    ComplianceLogger::append(
        &env, actor.clone(), ComplianceAction::DataCreated,
        tgt(&env, b"k"), empty(&env), bytes_u32(&env, 10), tx(&env),
    );

    let before = ComplianceLogger::get_log(&env, admin.clone(), 1);

    // Append second entry
    ComplianceLogger::append(
        &env, actor.clone(), ComplianceAction::DataUpdated,
        tgt(&env, b"k"), bytes_u32(&env, 10), bytes_u32(&env, 20), tx(&env),
    );

    // First log must be unchanged
    let after = ComplianceLogger::get_log(&env, admin.clone(), 1);
    assert_eq!(before.entry_hash, after.entry_hash);
    assert_eq!(before.new_value, after.new_value);
}

// ---------------------------------------------------------------------------
// Date index query
// ---------------------------------------------------------------------------

#[test]
fn integration_date_index_query() {
    let (env, admin) = env_and_admin();
    let actor = Address::generate(&env);

    // Set timestamp to a fixed day: 2024-01-15 00:00:00 UTC = 1705276800
    env.ledger().with_mut(|l| l.timestamp = 1_705_276_800);

    ComplianceLogger::append(
        &env, actor.clone(), ComplianceAction::AccessGranted,
        tgt(&env, b"r"), empty(&env), empty(&env), tx(&env),
    );
    ComplianceLogger::append(
        &env, actor.clone(), ComplianceAction::FraudFlagged,
        tgt(&env, b"u"), empty(&env), bytes_u32(&env, 90), tx(&env),
    );

    let bucket = ComplianceLogger::timestamp_to_date_bucket(1_705_276_800);
    let ids = ComplianceLogger::query_by_date(&env, admin.clone(), bucket);
    assert_eq!(ids.len(), 2);
}

// ---------------------------------------------------------------------------
// Batch signature: valid flow
// ---------------------------------------------------------------------------

#[test]
fn integration_batch_commit_and_retrieve() {
    let (env, admin) = env_and_admin();
    let actor = Address::generate(&env);

    for _ in 0u32..4 {
        ComplianceLogger::append(
            &env, actor.clone(), ComplianceAction::DataUpdated,
            tgt(&env, b"x"), empty(&env), empty(&env), tx(&env),
        );
    }

    // Build Merkle root from stored entry hashes
    let mut leaves: Vec<BytesN<32>> = Vec::new(&env);
    for i in 1u64..=4 {
        let log = ComplianceLogger::get_log(&env, admin.clone(), i);
        leaves.push_back(log.entry_hash);
    }
    let merkle_root = compute_merkle_root(&env, &leaves);

    // Produce real ed25519 signature
    use soroban_sdk::testutils::ed25519::Sign;
    let kp = soroban_sdk::testutils::ed25519::generate(&env);
    let sig_bytes: [u8; 64] = kp.sign(merkle_root.to_array().as_slice());
    let signature = BytesN::from_array(&env, &sig_bytes);
    let pk = BytesN::from_array(&env, kp.public_key());

    ComplianceLogger::commit_batch_signature(
        &env, admin.clone(), 1, 1, 4, merkle_root.clone(), signature, pk,
    );

    let batch = ComplianceLogger::get_batch_signature(&env, admin.clone(), 1);
    assert_eq!(batch.first_log_id, 1);
    assert_eq!(batch.last_log_id, 4);
    assert_eq!(batch.merkle_root, merkle_root);
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

#[test]
fn integration_csv_export_multi_row() {
    let (env, admin) = env_and_admin();
    let actor = Address::generate(&env);

    for i in 0u32..5 {
        ComplianceLogger::append(
            &env, actor.clone(), ComplianceAction::DataUpdated,
            tgt(&env, b"score"), bytes_u32(&env, i * 10), bytes_u32(&env, (i + 1) * 10), tx(&env),
        );
    }

    let header = ComplianceLogger::csv_header(&env);
    assert!(header.len() > 0);

    let mut total_bytes = header.len();
    for id in 1u64..=5 {
        let row = ComplianceLogger::export_csv_row(&env, admin.clone(), id);
        assert!(row.len() > 0);
        total_bytes += row.len();
    }
    assert!(total_bytes > 0);
}

// ---------------------------------------------------------------------------
// Verify chain across multiple appends
// ---------------------------------------------------------------------------

#[test]
fn integration_verify_chain_long() {
    let (env, admin) = env_and_admin();
    let actor = Address::generate(&env);

    for _ in 0..20 {
        ComplianceLogger::append(
            &env, actor.clone(), ComplianceAction::DataCreated,
            tgt(&env, b"item"), empty(&env), empty(&env), tx(&env),
        );
    }

    assert!(ComplianceLogger::verify_chain(&env, admin.clone(), 1, 20));
    // Sub-range also valid
    assert!(ComplianceLogger::verify_chain(&env, admin.clone(), 5, 15));
}

// ---------------------------------------------------------------------------
// All compliance event categories covered
// ---------------------------------------------------------------------------

#[test]
fn integration_all_event_categories() {
    let (env, admin) = env_and_admin();
    let actor = Address::generate(&env);

    let actions = [
        // Access control
        ComplianceAction::AccessGranted,
        ComplianceAction::AccessRevoked,
        ComplianceAction::AccessDenied,
        ComplianceAction::RoleAssigned,
        ComplianceAction::RoleRevoked,
        // Data changes
        ComplianceAction::DataCreated,
        ComplianceAction::DataUpdated,
        ComplianceAction::DataDeleted,
        // Decisions
        ComplianceAction::CreditScoreComputed,
        ComplianceAction::FraudFlagged,
        ComplianceAction::FraudCleared,
        ComplianceAction::RiskEvaluated,
        // Approvals
        ComplianceAction::ProposalCreated,
        ComplianceAction::ProposalApproved,
        ComplianceAction::ProposalRejected,
        ComplianceAction::ProposalExecuted,
        ComplianceAction::ProposalExpired,
        // Fund movements
        ComplianceAction::FundsWithdrawn,
        ComplianceAction::FundsDeposited,
        ComplianceAction::FundsDistributed,
        ComplianceAction::StakeAdded,
        ComplianceAction::StakeRemoved,
        // System changes
        ComplianceAction::ContractPaused,
        ComplianceAction::ContractUnpaused,
        ComplianceAction::ContractUpgraded,
        ComplianceAction::ParameterChanged,
        ComplianceAction::AdminTransferred,
        ComplianceAction::Custom,
    ];

    for action in &actions {
        ComplianceLogger::append(
            &env, actor.clone(), *action,
            tgt(&env, b"target"), empty(&env), empty(&env), tx(&env),
        );
    }

    let count = ComplianceLogger::log_count(&env);
    assert_eq!(count, actions.len() as u64);

    // Verify the entire chain is intact
    assert!(ComplianceLogger::verify_chain(&env, admin.clone(), 1, count));
}

// ---------------------------------------------------------------------------
// Long-term retention: logs persist (persistent storage) without eviction
// ---------------------------------------------------------------------------

#[test]
fn integration_persistent_storage_retention() {
    let (env, admin) = env_and_admin();
    let actor = Address::generate(&env);

    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    for _ in 0..10 {
        ComplianceLogger::append(
            &env, actor.clone(), ComplianceAction::DataCreated,
            tgt(&env, b"k"), empty(&env), empty(&env), tx(&env),
        );
    }

    // Advance ledger far into the future (simulate 7+ years)
    env.ledger().with_mut(|l| l.timestamp = 1_000_000 + 7 * 365 * 86400);

    // Logs written 7 years ago must still be accessible (persistent storage)
    let log = ComplianceLogger::get_log(&env, admin.clone(), 1);
    assert_eq!(log.id, 1);
    assert_eq!(ComplianceLogger::log_count(&env), 10);
}
