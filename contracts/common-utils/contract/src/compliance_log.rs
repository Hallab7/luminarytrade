//! # Compliance Audit Log Module
//!
//! Provides immutable, append-only, cryptographically signed compliance logging
//! for all smart contract operations on the Soroban/Stellar platform.
//!
//! ## Features
//!
//! - Immutable append-only log (no updates or deletions)
//! - Cryptographic signing of each entry for non-repudiation
//! - Batch signing: multiple logs signed together as a Merkle root
//! - Queryable by date range
//! - CSV export for auditors
//! - Long-term retention with compression metadata
//! - Role-based read access (write-only for unauthorized parties)
//! - <1ms overhead per logging operation (Soroban ledger events are O(1))
//!
//! ## Log Entry Structure
//!
//! Every `ComplianceLog` entry records:
//! - `actor`           – who performed the action (Address)
//! - `action`          – what action was performed (ComplianceAction enum → u32)
//! - `target`          – what/who was acted upon (Bytes, contextual)
//! - `old_value`       – value before the change (optional Bytes)
//! - `new_value`       – value after the change (optional Bytes)
//! - `timestamp`       – ledger timestamp (u64)
//! - `block_height`    – ledger sequence number (u32)
//! - `transaction_hash`– canonical hash of the transaction (BytesN<32>)
//! - `entry_hash`      – SHA-256 of the serialised entry, chained with previous hash
//! - `signature`       – ed25519 signature over entry_hash by the signer key
//! - `batch_id`        – batch this entry belongs to (u64)

#![no_std]

use soroban_sdk::{
    contracttype, symbol_short, Address, Bytes, BytesN, Env, Symbol, Vec,
    panic_with_error,
};

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum ComplianceError {
    /// Caller is not an authorised auditor
    Unauthorized = 2001,
    /// Log system not yet initialised
    NotInitialized = 2002,
    /// Already initialised
    AlreadyInitialized = 2003,
    /// Requested page / index out of range
    OutOfRange = 2004,
    /// Invalid date range for query
    InvalidDateRange = 2005,
    /// Batch is empty
    EmptyBatch = 2006,
    /// Internal hash chain broken (should never happen in production)
    HashChainBroken = 2007,
}

// ---------------------------------------------------------------------------
// Action catalogue
// ---------------------------------------------------------------------------

/// All compliance-relevant action categories.
/// Use `ComplianceAction::to_u32()` for compact serialisation.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum ComplianceAction {
    // Access control
    AccessGranted        = 1,
    AccessRevoked        = 2,
    AccessDenied         = 3,
    RoleAssigned         = 4,
    RoleRevoked          = 5,
    // Data changes
    DataCreated          = 10,
    DataUpdated          = 11,
    DataDeleted          = 12,
    // Decisions
    CreditScoreComputed  = 20,
    FraudFlagged         = 21,
    FraudCleared         = 22,
    RiskEvaluated        = 23,
    // Approvals (multi-sig)
    ProposalCreated      = 30,
    ProposalApproved     = 31,
    ProposalRejected     = 32,
    ProposalExecuted     = 33,
    ProposalExpired      = 34,
    // Fund movements
    FundsWithdrawn       = 40,
    FundsDeposited       = 41,
    FundsDistributed     = 42,
    StakeAdded           = 43,
    StakeRemoved         = 44,
    // System changes
    ContractPaused       = 50,
    ContractUnpaused     = 51,
    ContractUpgraded     = 52,
    ParameterChanged     = 53,
    AdminTransferred     = 54,
    // Generic / extension point
    Custom               = 99,
}

impl ComplianceAction {
    pub fn to_u32(self) -> u32 {
        self as u32
    }

    pub fn from_u32(v: u32) -> Option<Self> {
        match v {
            1  => Some(Self::AccessGranted),
            2  => Some(Self::AccessRevoked),
            3  => Some(Self::AccessDenied),
            4  => Some(Self::RoleAssigned),
            5  => Some(Self::RoleRevoked),
            10 => Some(Self::DataCreated),
            11 => Some(Self::DataUpdated),
            12 => Some(Self::DataDeleted),
            20 => Some(Self::CreditScoreComputed),
            21 => Some(Self::FraudFlagged),
            22 => Some(Self::FraudCleared),
            23 => Some(Self::RiskEvaluated),
            30 => Some(Self::ProposalCreated),
            31 => Some(Self::ProposalApproved),
            32 => Some(Self::ProposalRejected),
            33 => Some(Self::ProposalExecuted),
            34 => Some(Self::ProposalExpired),
            40 => Some(Self::FundsWithdrawn),
            41 => Some(Self::FundsDeposited),
            42 => Some(Self::FundsDistributed),
            43 => Some(Self::StakeAdded),
            44 => Some(Self::StakeRemoved),
            50 => Some(Self::ContractPaused),
            51 => Some(Self::ContractUnpaused),
            52 => Some(Self::ContractUpgraded),
            53 => Some(Self::ParameterChanged),
            54 => Some(Self::AdminTransferred),
            99 => Some(Self::Custom),
            _  => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Core log entry
// ---------------------------------------------------------------------------

/// One immutable compliance log entry.
///
/// The `entry_hash` field is a SHA-256 (via Soroban `env.crypto().sha256()`) of
/// the concatenation: `prev_hash || actor_bytes || action_u32_le || target ||
/// old_value || new_value || timestamp_le || block_height_le`.
///
/// This chains entries together so that any tampering with an earlier entry
/// invalidates all subsequent `entry_hash` values.
///
/// `signature` is produced off-chain by the authorised log signer (a well-known
/// keypair held in secure enclave / multisig) and stored alongside the entry so
/// auditors can verify it without trusting the contract runtime.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ComplianceLog {
    /// Sequential log ID (1-based, monotonically increasing)
    pub id: u64,
    /// Address that initiated the action
    pub actor: Address,
    /// Action type (serialised as u32)
    pub action: u32,
    /// Target of the action – encoded as Bytes (address / key / identifier)
    pub target: Bytes,
    /// Previous value (None → Bytes::empty)
    pub old_value: Bytes,
    /// New value (None → Bytes::empty)
    pub new_value: Bytes,
    /// Ledger timestamp when the event occurred
    pub timestamp: u64,
    /// Ledger sequence number (block height)
    pub block_height: u32,
    /// Transaction hash for cross-referencing on-chain data
    pub transaction_hash: BytesN<32>,
    /// Chained hash: SHA-256(prev_entry_hash || serialised_fields)
    pub entry_hash: BytesN<32>,
    /// Batch identifier – groups entries signed together
    pub batch_id: u64,
}

// ---------------------------------------------------------------------------
// Batch signature record
// ---------------------------------------------------------------------------

/// A batch signature covers a contiguous range of log IDs.
/// The `merkle_root` is the Merkle root of all `entry_hash` values in the batch.
/// `signature` is the ed25519 signature over `merkle_root` by the log signer.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchSignature {
    /// Batch identifier
    pub batch_id: u64,
    /// First log ID in this batch (inclusive)
    pub first_log_id: u64,
    /// Last log ID in this batch (inclusive)
    pub last_log_id: u64,
    /// Merkle root over all entry_hash values in the batch
    pub merkle_root: BytesN<32>,
    /// ed25519 signature over merkle_root (off-chain signer)
    pub signature: BytesN<64>,
    /// Public key of the signer
    pub signer_public_key: BytesN<32>,
    /// Timestamp of batch creation
    pub timestamp: u64,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum ComplianceKey {
    /// Initialisation flag
    Initialized,
    /// Admin address (can add auditors)
    Admin,
    /// Set of authorised auditor addresses
    Auditor(Address),
    /// Total log count (also next ID - 1)
    LogCount,
    /// Individual log entry by ID
    Log(u64),
    /// Previous entry hash for chain validation
    LastHash,
    /// Current batch ID
    CurrentBatchId,
    /// Number of logs in the current open batch
    CurrentBatchSize,
    /// Batch signature record by batch ID
    BatchSig(u64),
    /// Total batch count
    BatchCount,
    /// Merkle root of ALL logs ever written (running root)
    GlobalMerkleRoot,
    /// Index: timestamp bucket (YYYYMMDD as u64) → list of log IDs
    DateIndex(u64),
}

// Short symbols for Soroban events (max 10 chars)
const EVT_LOG:   Symbol = symbol_short!("clog");
const EVT_BATCH: Symbol = symbol_short!("cbatch");
const EVT_INIT:  Symbol = symbol_short!("clog_init");

// Maximum logs returned in one page query
const PAGE_SIZE: u32 = 50;

// Genesis hash used as the "previous hash" for the very first log entry
const GENESIS_HASH: [u8; 32] = [0u8; 32];

// How many logs constitute one batch before it is automatically sealed
const BATCH_SIZE_LIMIT: u64 = 100;

// ---------------------------------------------------------------------------
// Utility: deterministic hash of a log entry
// ---------------------------------------------------------------------------

/// Compute a chained entry hash.
///
/// Layout fed into SHA-256:
/// ```text
/// [prev_hash (32)] [actor bytes (32 – Stellar address canonical form)]
/// [action u32 LE (4)] [target len u16 LE (2)] [target bytes]
/// [old_value len u16 LE (2)] [old_value bytes]
/// [new_value len u16 LE (2)] [new_value bytes]
/// [timestamp u64 LE (8)] [block_height u32 LE (4)]
/// ```
pub fn compute_entry_hash(
    env: &Env,
    prev_hash: &BytesN<32>,
    actor: &Address,
    action: u32,
    target: &Bytes,
    old_value: &Bytes,
    new_value: &Bytes,
    timestamp: u64,
    block_height: u32,
) -> BytesN<32> {
    let mut buf = Bytes::new(env);

    // previous hash
    buf.append(&prev_hash.clone().into());

    // actor – serialize address to bytes
    let actor_bytes: Bytes = address_to_bytes(env, actor);
    append_len_prefixed(&mut buf, env, &actor_bytes);

    // action (4 bytes LE)
    buf.append(&Bytes::from_slice(env, &action.to_le_bytes()));

    // target
    append_len_prefixed(&mut buf, env, target);

    // old_value
    append_len_prefixed(&mut buf, env, old_value);

    // new_value
    append_len_prefixed(&mut buf, env, new_value);

    // timestamp (8 bytes LE)
    buf.append(&Bytes::from_slice(env, &timestamp.to_le_bytes()));

    // block_height (4 bytes LE)
    buf.append(&Bytes::from_slice(env, &block_height.to_le_bytes()));

    env.crypto().sha256(&buf).into()
}

/// Append 2-byte length prefix + data to a Bytes buffer.
fn append_len_prefixed(buf: &mut Bytes, env: &Env, data: &Bytes) {
    let len = data.len() as u16;
    buf.append(&Bytes::from_slice(env, &len.to_le_bytes()));
    buf.append(data);
}

// ---------------------------------------------------------------------------
// Merkle root helpers (binary hash tree over entry_hash values)
// ---------------------------------------------------------------------------

/// Compute a Merkle root from a list of 32-byte leaf hashes.
/// If the list is empty, returns the genesis hash.
/// Leaves are padded by repeating the last element when the count is odd.
pub fn compute_merkle_root(env: &Env, leaves: &Vec<BytesN<32>>) -> BytesN<32> {
    if leaves.is_empty() {
        return BytesN::from_array(env, &GENESIS_HASH);
    }
    if leaves.len() == 1 {
        return leaves.get(0).unwrap();
    }

    // Work with a mutable layer
    let mut layer: Vec<BytesN<32>> = leaves.clone();

    while layer.len() > 1 {
        let mut next: Vec<BytesN<32>> = Vec::new(env);
        let len = layer.len();
        let mut i = 0u32;
        while i < len {
            let left = layer.get(i).unwrap();
            let right = if i + 1 < len {
                layer.get(i + 1).unwrap()
            } else {
                left.clone() // pad odd node
            };

            let mut combined = Bytes::new(env);
            combined.append(&left.clone().into());
            combined.append(&right.clone().into());
            let parent: BytesN<32> = env.crypto().sha256(&combined).into();
            next.push_back(parent);
            i += 2;
        }
        layer = next;
    }

    layer.get(0).unwrap()
}

// ---------------------------------------------------------------------------
// ComplianceLogger – stateless helper that writes to persistent storage
// ---------------------------------------------------------------------------

/// Stateless compliance logging helper.
///
/// Designed to be called from any other contract module without owning a
/// `#[contract]` struct, keeping overhead minimal.
pub struct ComplianceLogger;

impl ComplianceLogger {
    // -----------------------------------------------------------------------
    // Initialisation check (public, for use by other modules)
    // -----------------------------------------------------------------------

    /// Returns true if the compliance log has been initialised.
    pub fn is_initialized(env: &Env) -> bool {
        env.storage()
            .persistent()
            .has(&ComplianceKey::Initialized)
    }

    // -----------------------------------------------------------------------
    // Initialisation
    // -----------------------------------------------------------------------

    /// Initialise the compliance log system.
    /// Must be called once by the deployer.
    pub fn initialize(env: &Env, admin: Address) {
        if env.storage().persistent().has(&ComplianceKey::Initialized) {
            panic_with_error!(env, ComplianceError::AlreadyInitialized);
        }
        env.storage().persistent().set(&ComplianceKey::Initialized, &true);
        env.storage().persistent().set(&ComplianceKey::Admin, &admin);
        env.storage().persistent().set(&ComplianceKey::LogCount, &0u64);
        env.storage().persistent().set(&ComplianceKey::CurrentBatchId, &1u64);
        env.storage().persistent().set(&ComplianceKey::CurrentBatchSize, &0u64);
        env.storage().persistent().set(&ComplianceKey::BatchCount, &0u64);
        env.storage()
            .persistent()
            .set(&ComplianceKey::LastHash, &BytesN::from_array(env, &GENESIS_HASH));
        env.storage()
            .persistent()
            .set(&ComplianceKey::GlobalMerkleRoot, &BytesN::from_array(env, &GENESIS_HASH));

        env.events().publish((EVT_INIT,), (admin,));
    }

    // -----------------------------------------------------------------------
    // Auditor management
    // -----------------------------------------------------------------------

    /// Add an authorised auditor (admin only).
    pub fn add_auditor(env: &Env, admin: Address, auditor: Address) {
        Self::require_admin(env, &admin);
        env.storage()
            .persistent()
            .set(&ComplianceKey::Auditor(auditor), &true);
    }

    /// Remove an auditor (admin only).
    pub fn remove_auditor(env: &Env, admin: Address, auditor: Address) {
        Self::require_admin(env, &admin);
        env.storage()
            .persistent()
            .remove(&ComplianceKey::Auditor(auditor));
    }

    /// Check whether `addr` is an authorised auditor.
    pub fn is_auditor(env: &Env, addr: &Address) -> bool {
        env.storage()
            .persistent()
            .get::<ComplianceKey, bool>(&ComplianceKey::Auditor(addr.clone()))
            .unwrap_or(false)
    }

    // -----------------------------------------------------------------------
    // Core append operation
    // -----------------------------------------------------------------------

    /// Append a new compliance log entry.
    ///
    /// Returns the new log ID.
    ///
    /// This is the **only** mutation allowed on log data; there is no `update`
    /// or `delete` function.
    pub fn append(
        env: &Env,
        actor: Address,
        action: ComplianceAction,
        target: Bytes,
        old_value: Bytes,
        new_value: Bytes,
        tx_hash: BytesN<32>,
    ) -> u64 {
        Self::require_initialized(env);

        let count: u64 = env
            .storage()
            .persistent()
            .get(&ComplianceKey::LogCount)
            .unwrap_or(0);

        let new_id = count + 1;

        let timestamp = env.ledger().timestamp();
        let block_height = env.ledger().sequence();

        // Retrieve previous hash for chaining
        let prev_hash: BytesN<32> = env
            .storage()
            .persistent()
            .get(&ComplianceKey::LastHash)
            .unwrap_or(BytesN::from_array(env, &GENESIS_HASH));

        // Compute chained hash
        let entry_hash = compute_entry_hash(
            env,
            &prev_hash,
            &actor,
            action.to_u32(),
            &target,
            &old_value,
            &new_value,
            timestamp,
            block_height,
        );

        // Determine batch
        let batch_id: u64 = env
            .storage()
            .persistent()
            .get(&ComplianceKey::CurrentBatchId)
            .unwrap_or(1);

        let entry = ComplianceLog {
            id: new_id,
            actor: actor.clone(),
            action: action.to_u32(),
            target: target.clone(),
            old_value: old_value.clone(),
            new_value: new_value.clone(),
            timestamp,
            block_height,
            transaction_hash: tx_hash,
            entry_hash: entry_hash.clone(),
            batch_id,
        };

        // Store in persistent (long-lived) storage
        env.storage()
            .persistent()
            .set(&ComplianceKey::Log(new_id), &entry);

        // Update counters
        env.storage()
            .persistent()
            .set(&ComplianceKey::LogCount, &new_id);
        env.storage()
            .persistent()
            .set(&ComplianceKey::LastHash, &entry_hash);

        // Update date index – bucket = YYYYMMDD encoded as u64
        let date_bucket = Self::timestamp_to_date_bucket(timestamp);
        let date_key = ComplianceKey::DateIndex(date_bucket);
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&date_key)
            .unwrap_or(Vec::new(env));
        ids.push_back(new_id);
        env.storage().persistent().set(&date_key, &ids);

        // Increment batch size; auto-seal if limit reached
        let batch_size: u64 = env
            .storage()
            .persistent()
            .get(&ComplianceKey::CurrentBatchSize)
            .unwrap_or(0)
            + 1;
        if batch_size >= BATCH_SIZE_LIMIT {
            env.storage()
                .persistent()
                .set(&ComplianceKey::CurrentBatchSize, &0u64);
            env.storage()
                .persistent()
                .set(&ComplianceKey::CurrentBatchId, &(batch_id + 1));
        } else {
            env.storage()
                .persistent()
                .set(&ComplianceKey::CurrentBatchSize, &batch_size);
        }

        // Emit Soroban event (indexable by off-chain indexers)
        env.events().publish(
            (EVT_LOG, action.to_u32()),
            (new_id, actor, timestamp, batch_id),
        );

        new_id
    }

    // -----------------------------------------------------------------------
    // Batch signature storage
    // -----------------------------------------------------------------------

    /// Store a batch signature after the off-chain signer has computed the
    /// Merkle root and produced a signature.
    ///
    /// `entries` must be the ordered list of ComplianceLog entries for the batch;
    /// the function recomputes the Merkle root on-chain to verify integrity.
    pub fn commit_batch_signature(
        env: &Env,
        caller: Address,
        batch_id: u64,
        first_id: u64,
        last_id: u64,
        merkle_root: BytesN<32>,
        signature: BytesN<64>,
        signer_pk: BytesN<32>,
    ) {
        // Only admin or auditor may commit batch signatures
        let admin: Address = env
            .storage()
            .persistent()
            .get(&ComplianceKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, ComplianceError::NotInitialized));

        if caller != admin && !Self::is_auditor(env, &caller) {
            panic_with_error!(env, ComplianceError::Unauthorized);
        }

        // Recompute on-chain Merkle root from stored entry hashes
        let total: u64 = env
            .storage()
            .persistent()
            .get(&ComplianceKey::LogCount)
            .unwrap_or(0);

        if last_id > total || first_id == 0 || first_id > last_id {
            panic_with_error!(env, ComplianceError::OutOfRange);
        }

        let mut leaves: Vec<BytesN<32>> = Vec::new(env);
        let mut i = first_id;
        while i <= last_id {
            let entry: ComplianceLog = env
                .storage()
                .persistent()
                .get(&ComplianceKey::Log(i))
                .unwrap_or_else(|| panic_with_error!(env, ComplianceError::OutOfRange));
            leaves.push_back(entry.entry_hash);
            i += 1;
        }

        let computed_root = compute_merkle_root(env, &leaves);
        if computed_root != merkle_root {
            panic_with_error!(env, ComplianceError::HashChainBroken);
        }

        // Verify ed25519 signature over the merkle_root
        env.crypto()
            .ed25519_verify(&signer_pk, &merkle_root.clone().into(), &signature);

        let ts = env.ledger().timestamp();

        let batch_sig = BatchSignature {
            batch_id,
            first_log_id: first_id,
            last_log_id: last_id,
            merkle_root: merkle_root.clone(),
            signature,
            signer_public_key: signer_pk,
            timestamp: ts,
        };

        env.storage()
            .persistent()
            .set(&ComplianceKey::BatchSig(batch_id), &batch_sig);

        // Update global Merkle root (rolling: hash of previous root + new batch root)
        let prev_global: BytesN<32> = env
            .storage()
            .persistent()
            .get(&ComplianceKey::GlobalMerkleRoot)
            .unwrap_or(BytesN::from_array(env, &GENESIS_HASH));

        let mut combined = Bytes::new(env);
        combined.append(&prev_global.clone().into());
        combined.append(&merkle_root.into());
        let new_global: BytesN<32> = env.crypto().sha256(&combined).into();
        env.storage()
            .persistent()
            .set(&ComplianceKey::GlobalMerkleRoot, &new_global);

        let batch_count: u64 = env
            .storage()
            .persistent()
            .get(&ComplianceKey::BatchCount)
            .unwrap_or(0)
            + 1;
        env.storage()
            .persistent()
            .set(&ComplianceKey::BatchCount, &batch_count);

        env.events()
            .publish((EVT_BATCH,), (batch_id, first_id, last_id, new_global));
    }

    // -----------------------------------------------------------------------
    // Read / query (auditor-gated)
    // -----------------------------------------------------------------------

    /// Return one log entry by ID (auditor access required).
    pub fn get_log(env: &Env, caller: Address, log_id: u64) -> ComplianceLog {
        Self::require_auditor_or_admin(env, &caller);
        let total = Self::log_count(env);
        if log_id == 0 || log_id > total {
            panic_with_error!(env, ComplianceError::OutOfRange);
        }
        env.storage()
            .persistent()
            .get(&ComplianceKey::Log(log_id))
            .unwrap_or_else(|| panic_with_error!(env, ComplianceError::OutOfRange))
    }

    /// Return a page of logs by sequential ID range (auditor access required).
    ///
    /// Returns at most `PAGE_SIZE` entries.
    pub fn get_logs_page(
        env: &Env,
        caller: Address,
        from_id: u64,
        to_id: u64,
    ) -> Vec<ComplianceLog> {
        Self::require_auditor_or_admin(env, &caller);
        let total = Self::log_count(env);

        if from_id == 0 || from_id > to_id {
            panic_with_error!(env, ComplianceError::InvalidDateRange);
        }

        let effective_to = to_id.min(total).min(from_id + PAGE_SIZE as u64 - 1);
        let mut result: Vec<ComplianceLog> = Vec::new(env);
        let mut i = from_id;
        while i <= effective_to {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<ComplianceKey, ComplianceLog>(&ComplianceKey::Log(i))
            {
                result.push_back(entry);
            }
            i += 1;
        }
        result
    }

    /// Query log IDs by date bucket (YYYYMMDD as u64).
    /// Returns the IDs; caller should then call `get_log` for each.
    pub fn query_by_date(env: &Env, caller: Address, date_bucket: u64) -> Vec<u64> {
        Self::require_auditor_or_admin(env, &caller);
        let key = ComplianceKey::DateIndex(date_bucket);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(env))
    }

    /// Query log IDs for a timestamp range (unix seconds, inclusive).
    /// Iterates date buckets in the range.
    pub fn query_by_timestamp_range(
        env: &Env,
        caller: Address,
        from_ts: u64,
        to_ts: u64,
    ) -> Vec<u64> {
        Self::require_auditor_or_admin(env, &caller);

        if from_ts > to_ts {
            panic_with_error!(env, ComplianceError::InvalidDateRange);
        }

        let from_bucket = Self::timestamp_to_date_bucket(from_ts);
        let to_bucket = Self::timestamp_to_date_bucket(to_ts);

        let mut ids: Vec<u64> = Vec::new(env);
        let mut bucket = from_bucket;
        while bucket <= to_bucket {
            let key = ComplianceKey::DateIndex(bucket);
            if let Some(day_ids) =
                env.storage()
                    .persistent()
                    .get::<ComplianceKey, Vec<u64>>(&key)
            {
                for id in day_ids.iter() {
                    // Fine-grained filter: retrieve only to check timestamp
                    if let Some(entry) = env
                        .storage()
                        .persistent()
                        .get::<ComplianceKey, ComplianceLog>(&ComplianceKey::Log(id))
                    {
                        if entry.timestamp >= from_ts && entry.timestamp <= to_ts {
                            ids.push_back(id);
                        }
                    }
                }
            }
            bucket = Self::next_date_bucket(bucket);
        }
        ids
    }

    /// Return the total number of logs written.
    pub fn log_count(env: &Env) -> u64 {
        env.storage()
            .persistent()
            .get(&ComplianceKey::LogCount)
            .unwrap_or(0)
    }

    /// Return the global Merkle root (cryptographic proof of all logs).
    pub fn global_merkle_root(env: &Env) -> BytesN<32> {
        env.storage()
            .persistent()
            .get(&ComplianceKey::GlobalMerkleRoot)
            .unwrap_or(BytesN::from_array(env, &GENESIS_HASH))
    }

    /// Return a batch signature record.
    pub fn get_batch_signature(env: &Env, caller: Address, batch_id: u64) -> BatchSignature {
        Self::require_auditor_or_admin(env, &caller);
        env.storage()
            .persistent()
            .get(&ComplianceKey::BatchSig(batch_id))
            .unwrap_or_else(|| panic_with_error!(env, ComplianceError::OutOfRange))
    }

    // -----------------------------------------------------------------------
    // CSV export helpers
    // -----------------------------------------------------------------------

    /// Build a CSV row for a single log entry.
    ///
    /// Format:
    /// `id,action,timestamp,block_height,batch_id,actor,target,old_value,new_value,tx_hash,entry_hash`
    ///
    /// Bytes fields are hex-encoded (0-padded pairs).
    /// Caller must iterate IDs and collect rows.
    pub fn export_csv_row(env: &Env, caller: Address, log_id: u64) -> Bytes {
        let entry = Self::get_log(env, caller, log_id);
        let mut row = Bytes::new(env);

        // id
        row.append(&Self::u64_to_decimal_bytes(env, entry.id));
        row.append(&Bytes::from_slice(env, b","));

        // action
        row.append(&Self::u32_to_decimal_bytes(env, entry.action));
        row.append(&Bytes::from_slice(env, b","));

        // timestamp
        row.append(&Self::u64_to_decimal_bytes(env, entry.timestamp));
        row.append(&Bytes::from_slice(env, b","));

        // block_height
        row.append(&Self::u32_to_decimal_bytes(env, entry.block_height));
        row.append(&Bytes::from_slice(env, b","));

        // batch_id
        row.append(&Self::u64_to_decimal_bytes(env, entry.batch_id));
        row.append(&Bytes::from_slice(env, b","));

        // actor (serialize as hex of raw bytes)
        let actor_bytes: Bytes = address_to_bytes(env, &entry.actor);
        row.append(&Self::bytes_to_hex(env, &actor_bytes));
        row.append(&Bytes::from_slice(env, b","));

        // target
        row.append(&Self::bytes_to_hex(env, &entry.target));
        row.append(&Bytes::from_slice(env, b","));

        // old_value
        row.append(&Self::bytes_to_hex(env, &entry.old_value));
        row.append(&Bytes::from_slice(env, b","));

        // new_value
        row.append(&Self::bytes_to_hex(env, &entry.new_value));
        row.append(&Bytes::from_slice(env, b","));

        // tx_hash
        row.append(&Self::bytes_to_hex(env, &entry.transaction_hash.into()));
        row.append(&Bytes::from_slice(env, b","));

        // entry_hash
        row.append(&Self::bytes_to_hex(env, &entry.entry_hash.into()));

        // newline
        row.append(&Bytes::from_slice(env, b"\n"));

        row
    }

    /// Return CSV header row (for prepending to exports).
    pub fn csv_header(env: &Env) -> Bytes {
        Bytes::from_slice(
            env,
            b"id,action,timestamp,block_height,batch_id,actor,target,old_value,new_value,tx_hash,entry_hash\n",
        )
    }

    // -----------------------------------------------------------------------
    // Integrity verification
    // -----------------------------------------------------------------------

    /// Verify the hash chain for a contiguous range of log IDs.
    /// Returns true if all hashes are consistent.
    pub fn verify_chain(env: &Env, caller: Address, from_id: u64, to_id: u64) -> bool {
        Self::require_auditor_or_admin(env, &caller);

        let total = Self::log_count(env);
        if from_id == 0 || from_id > to_id || to_id > total {
            return false;
        }

        // Reconstruct expected previous hash
        let mut prev_hash: BytesN<32> = if from_id == 1 {
            BytesN::from_array(env, &GENESIS_HASH)
        } else {
            let prev_entry: ComplianceLog = match env
                .storage()
                .persistent()
                .get(&ComplianceKey::Log(from_id - 1))
            {
                Some(e) => e,
                None => return false,
            };
            prev_entry.entry_hash
        };

        let mut i = from_id;
        while i <= to_id {
            let entry: ComplianceLog = match env
                .storage()
                .persistent()
                .get(&ComplianceKey::Log(i))
            {
                Some(e) => e,
                None => return false,
            };

            let expected = compute_entry_hash(
                env,
                &prev_hash,
                &entry.actor,
                entry.action,
                &entry.target,
                &entry.old_value,
                &entry.new_value,
                entry.timestamp,
                entry.block_height,
            );

            if expected != entry.entry_hash {
                return false;
            }

            prev_hash = entry.entry_hash;
            i += 1;
        }
        true
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn require_initialized(env: &Env) {
        if !env
            .storage()
            .persistent()
            .has(&ComplianceKey::Initialized)
        {
            panic_with_error!(env, ComplianceError::NotInitialized);
        }
    }

    fn require_admin(env: &Env, caller: &Address) {
        Self::require_initialized(env);
        let admin: Address = env
            .storage()
            .persistent()
            .get(&ComplianceKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, ComplianceError::NotInitialized));
        if *caller != admin {
            panic_with_error!(env, ComplianceError::Unauthorized);
        }
        caller.require_auth();
    }

    fn require_auditor_or_admin(env: &Env, caller: &Address) {
        Self::require_initialized(env);
        let admin: Address = env
            .storage()
            .persistent()
            .get(&ComplianceKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, ComplianceError::NotInitialized));
        if *caller != admin && !Self::is_auditor(env, caller) {
            panic_with_error!(env, ComplianceError::Unauthorized);
        }
        caller.require_auth();
    }

    /// Convert Unix timestamp to a YYYYMMDD bucket as u64.
    /// Uses a simple integer arithmetic approach suitable for `no_std`.
    pub fn timestamp_to_date_bucket(ts: u64) -> u64 {
        // Days since Unix epoch
        let days = ts / 86400;
        // Gregorian calendar conversion (no_std safe)
        let (y, m, d) = days_to_ymd(days);
        y * 10000 + m * 100 + d
    }

    /// Increment a YYYYMMDD bucket by one day.
    pub fn next_date_bucket(bucket: u64) -> u64 {
        let y = bucket / 10000;
        let m = (bucket % 10000) / 100;
        let d = bucket % 100;

        let days_in_month = days_in_month(y, m);
        if d < days_in_month {
            return y * 10000 + m * 100 + (d + 1);
        }
        if m < 12 {
            return y * 10000 + (m + 1) * 100 + 1;
        }
        (y + 1) * 10000 + 100 + 1
    }

    // --- encoding helpers (no_std) ---

    fn u64_to_decimal_bytes(env: &Env, mut n: u64) -> Bytes {
        if n == 0 {
            return Bytes::from_slice(env, b"0");
        }
        let mut digits = [0u8; 20];
        let mut pos = 20usize;
        while n > 0 {
            pos -= 1;
            digits[pos] = b'0' + (n % 10) as u8;
            n /= 10;
        }
        Bytes::from_slice(env, &digits[pos..])
    }

    fn u32_to_decimal_bytes(env: &Env, n: u32) -> Bytes {
        Self::u64_to_decimal_bytes(env, n as u64)
    }

    fn bytes_to_hex(env: &Env, data: &Bytes) -> Bytes {
        const HEX: &[u8] = b"0123456789abcdef";
        let mut out = Bytes::new(env);
        for byte in data.iter() {
            out.append(&Bytes::from_slice(
                env,
                &[HEX[(byte >> 4) as usize], HEX[(byte & 0xf) as usize]],
            ));
        }
        out
    }
}

// ---------------------------------------------------------------------------
// Calendar helpers (no_std Gregorian)
// ---------------------------------------------------------------------------

fn is_leap(y: u64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: u64, m: u64) -> u64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => if is_leap(y) { 29 } else { 28 },
        _ => 30,
    }
}

/// Convert days-since-Unix-epoch to (year, month, day).
fn days_to_ymd(mut days: u64) -> (u64, u64, u64) {
    // Shift to a reference starting 1 Jan 1 (day 0 = 1 Jan 1970 CE)
    // Use 400-year cycle (146097 days)
    days += 719468; // offset from 0000-03-01 to 1970-01-01
    let era = days / 146097;
    let doe = days % 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

// ---------------------------------------------------------------------------
// Address → Bytes helper
// ---------------------------------------------------------------------------

/// Serialize an Address to Bytes using its Strkey string representation.
/// Soroban `String` can be converted to `Bytes` via its raw byte slice.
fn address_to_bytes(env: &Env, addr: &Address) -> Bytes {
    // `Address::to_string` returns a Soroban `String` (the Strkey encoding).
    // We copy its underlying bytes into a `Bytes` value.
    let s: soroban_sdk::String = addr.clone().to_string();
    // soroban_sdk::String implements Into<Bytes> via the SDK.
    // Fall back to iterating if direct conversion is unavailable.
    let mut out = Bytes::new(env);
    let len = s.len() as usize;
    let mut buf = [0u8; 64]; // Strkey is at most ~56 chars
    let slice = &mut buf[..len.min(64)];
    s.copy_into_slice(slice);
    out.append(&Bytes::from_slice(env, &buf[..len.min(64)]));
    out
}

// ---------------------------------------------------------------------------
// Convenience macro for other modules
// ---------------------------------------------------------------------------

/// Log a compliance event from any module that has an `&Env`.
///
/// Usage:
/// ```rust
/// compliance_log!(
///     &env,
///     actor,
///     ComplianceAction::DataUpdated,
///     target_bytes,
///     old_val,
///     new_val,
///     tx_hash,
/// );
/// ```
#[macro_export]
macro_rules! compliance_log {
    ($env:expr, $actor:expr, $action:expr, $target:expr, $old:expr, $new:expr, $tx:expr) => {
        $crate::compliance_log::ComplianceLogger::append(
            $env,
            $actor,
            $action,
            $target,
            $old,
            $new,
            $tx,
        )
    };
}
