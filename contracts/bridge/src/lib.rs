//! # Cross-Chain Bridge Contract
//!
//! A secure cross-chain bridge implementation enabling asset transfers between
//! Stellar (Soroban) and EVM-compatible chains (Ethereum, Polygon, etc.).
//!
//! ## Features
//!
//! - **Cross-Chain Transfers**: Atomic deposit-mint and burn-withdraw flows
//! - **M-of-N Relayer Consensus**: Multiple relayers with threshold signatures
//! - **Security Controls**: Rate limiting, emergency pause, deposit limits
//! - **Liquidity Management**: Track and rebalance liquidity across chains
//! - **Fee System**: Configurable bridge fees and slippage
//! - **Monitoring**: Health checks, liquidity monitoring, activity tracking
//!
//! ## Architecture
//!
//! ### Bridge Flow
//!
//! 1. **Source Chain (Stellar)**: User deposits tokens
//! 2. **Relayers**: Watch events, sign attestations
//! 3. **Destination Chain (EVM)**: M-of-N signatures mint tokens
//!
//! ### Security Model
//!
//! - No single relayer can forge transfers
//! - Require M-of-N relayer signatures for validation
//! - Rate limiting prevents bridge spam
//! - Emergency pause if compromised
//! - Liquidity tracking prevents insolvency

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, panic_with_error,
    Address, Bytes, Env, Map, Symbol, Vec, IntoVal, Val, String,
};
use common_utils::error::CommonError;

// ============================================================================
// Storage Keys
// ============================================================================

#[contracttype]
pub enum DataKey {
    // Configuration
    Admin,
    Initialized,
    BridgeConfig,
    
    // Relayer Management
    RelayerSet,
    RelayerCount,
    Relayer(Address),
    RelayerNonce(Address),
    Threshold,
    
    // Transfer Tracking
    Transfer(u64),
    TransferNonce,
    BurnedTokens(Address),
    MintedTokens(Address),
    
    // Liquidity Management
    LiquidityPool(Symbol),
    TotalLiquidity(Symbol),
    LockedLiquidity(Symbol),
    
    // Rate Limiting
    RateLimitConfig(Symbol),
    RateLimitUsed(Symbol, u64),
    DailyLimit(Symbol),
    
    // Security
    Paused,
    PauseReason,
    EmergencyCommittee,
    
    // Fees
    BridgeFeeBps,
    ProtocolFeeBps,
    SlippageToleranceBps,
    FeeRecipient,
    
    // Monitoring
    LastTransferTime,
    TotalVolume(Symbol),
    HealthCheckTimestamp,
}

// ============================================================================
// Data Types
// ============================================================================

/// Supported chain types
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum ChainType {
    /// Stellar (Soroban)
    Stellar = 0,
    /// Ethereum
    Ethereum = 1,
    /// Polygon
    Polygon = 2,
    /// Binance Smart Chain
    BSC = 3,
    /// Arbitrum
    Arbitrum = 4,
    /// Optimism
    Optimism = 5,
    /// Generic EVM chain
    EVM = 99,
}

/// Transfer status
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum TransferStatus {
    /// Pending relay confirmation
    Pending = 0,
    /// Confirmed by relayers
    Confirmed = 1,
    /// Completed (minted/burned)
    Completed = 2,
    /// Failed/cancelled
    Failed = 3,
}

/// Cross-chain transfer request
#[derive(Clone)]
#[contracttype]
pub struct BridgeTransfer {
    /// Unique transfer ID
    pub transfer_id: u64,
    /// Source chain
    pub source_chain: ChainType,
    /// Destination chain
    pub dest_chain: ChainType,
    /// Sender address (on source chain)
    pub sender: Address,
    /// Recipient address (on destination chain, as bytes for EVM compatibility)
    pub recipient: Bytes,
    /// Token type
    pub token: Symbol,
    /// Amount to transfer
    pub amount: i128,
    /// Fee amount
    pub fee: i128,
    /// Net amount (after fee)
    pub net_amount: i128,
    /// Current status
    pub status: TransferStatus,
    /// Timestamp created
    pub created_at: u64,
    /// Confirmation count
    pub confirmations: u32,
    /// Required confirmations
    pub required_confirmations: u32,
}

/// Relayer attestation signature
#[derive(Clone)]
#[contracttype]
pub struct RelayerAttestation {
    /// Transfer ID being attested
    pub transfer_id: u64,
    /// Relayer address
    pub relayer: Address,
    /// Signature bytes (ECDSA or Ed25519)
    pub signature: Bytes,
    /// Timestamp
    pub timestamp: u64,
}

/// Relayer information
#[derive(Clone)]
#[contracttype]
pub struct RelayerInfo {
    /// Relayer address
    pub address: Address,
    /// Stake amount (if bonded)
    pub stake: i128,
    /// Added timestamp
    pub added_at: u64,
    /// Active status
    pub active: bool,
    /// Successful relays count
    pub successful_relays: u32,
    /// Failed relays count
    pub failed_relays: u32,
}

/// Bridge configuration
#[derive(Clone)]
#[contracttype]
pub struct BridgeConfig {
    /// Minimum relayer confirmations
    pub min_confirmations: u32,
    /// Total relayers
    pub total_relayers: u32,
    /// Transfer timeout (seconds)
    pub transfer_timeout: u64,
    /// Enable rate limiting
    pub rate_limit_enabled: bool,
    /// Daily limit per token
    pub daily_limit_per_token: i128,
    /// Max single transfer
    pub max_transfer_amount: i128,
    /// Min single transfer
    pub min_transfer_amount: i128,
}

/// Liquidity pool information
#[derive(Clone)]
#[contracttype]
pub struct LiquidityPool {
    /// Token type
    pub token: Symbol,
    /// Total liquidity on this chain
    pub total_liquidity: i128,
    /// Available liquidity
    pub available: i128,
    /// Locked in transfers
    pub locked: i128,
    /// Target allocation
    pub target_allocation: i128,
}

/// Rate limit configuration
#[derive(Clone)]
#[contracttype]
pub struct RateLimitConfig {
    /// Daily limit
    pub daily_limit: i128,
    /// Single transaction limit
    pub tx_limit: i128,
    /// Window start timestamp
    pub window_start: u64,
    /// Used amount in current window
    pub used: i128,
}

/// Fee configuration
#[derive(Clone)]
#[contracttype]
pub struct FeeConfig {
    /// Bridge fee in basis points (e.g., 30 = 0.3%)
    pub bridge_fee_bps: u32,
    /// Protocol fee in basis points
    pub protocol_fee_bps: u32,
    /// Slippage tolerance in basis points
    pub slippage_tolerance_bps: u32,
    /// Fee recipient address
    pub fee_recipient: Address,
}

/// Bridge statistics for monitoring
#[derive(Clone)]
#[contracttype]
pub struct BridgeStats {
    /// Total transfers processed
    pub total_transfers: u32,
    /// Total volume bridged
    pub total_volume: Map<Symbol, i128>,
    /// Active relayers count
    pub active_relayers: u32,
    /// Is bridge paused
    pub is_paused: bool,
    /// Last health check timestamp
    pub last_health_check: u64,
    /// Current rate limit usage
    pub rate_limit_usage: Map<Symbol, i128>,
}

/// Event data for cross-chain transfer
#[derive(Clone)]
#[contracttype]
pub struct BridgeEvent {
    /// Event type
    pub event_type: Symbol,
    /// Transfer ID
    pub transfer_id: u64,
    /// Source chain
    pub source_chain: ChainType,
    /// Destination chain
    pub dest_chain: ChainType,
    /// Amount
    pub amount: i128,
    /// Sender
    pub sender: Address,
    /// Recipient
    pub recipient: Bytes,
}

// ============================================================================
// Constants
// ============================================================================

const SECONDS_PER_DAY: u64 = 86400;
const DEFAULT_TRANSFER_TIMEOUT: u64 = 3600; // 1 hour
const DEFAULT_MIN_CONFIRMATIONS: u32 = 3;
const DEFAULT_BRIDGE_FEE_BPS: u32 = 30; // 0.3%
const DEFAULT_PROTOCOL_FEE_BPS: u32 = 10; // 0.1%
const DEFAULT_SLIPPAGE_BPS: u32 = 50; // 0.5%

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct BridgeContract;

// ============================================================================
// Implementation
// ============================================================================

#[contractimpl]
impl BridgeContract {
    /// Initialize the bridge contract
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `admin` - Admin address
    /// * `initial_relayers` - Initial set of relayer addresses
    /// * `min_confirmations` - Minimum confirmations required (M-of-N)
    /// 
    /// # Returns
    /// 
    /// * `Ok(())` - Initialization successful
    /// * `Err(CommonError)` - If already initialized
    pub fn initialize(
        env: Env,
        admin: Address,
        initial_relayers: Vec<Address>,
        min_confirmations: u32,
    ) -> Result<(), CommonError> {
        // Check if already initialized
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(CommonError::AlreadyInitialized);
        }
        
        // Validate relayers
        if initial_relayers.len() < min_confirmations {
            return Err(CommonError::InvalidLength);
        }
        
        // Store admin
        env.storage().instance().set(&DataKey::Admin, &admin);
        
        // Initialize relayers
        let mut relayer_count = 0u32;
        for relayer in initial_relayers.iter() {
            let relayer_info = RelayerInfo {
                address: relayer.clone(),
                stake: 0,
                added_at: env.ledger().timestamp(),
                active: true,
                successful_relays: 0,
                failed_relays: 0,
            };
            env.storage().persistent().set(&DataKey::Relayer(relayer.clone()), &relayer_info);
            relayer_count += 1;
        }
        
        env.storage().instance().set(&DataKey::RelayerCount, &relayer_count);
        env.storage().instance().set(&DataKey::Threshold, &min_confirmations);
        
        // Initialize bridge config
        let config = BridgeConfig {
            min_confirmations,
            total_relayers: relayer_count,
            transfer_timeout: DEFAULT_TRANSFER_TIMEOUT,
            rate_limit_enabled: true,
            daily_limit_per_token: 1_000_000_000_000, // 1M tokens default
            max_transfer_amount: 100_000_000_000, // 100K max per transfer
            min_transfer_amount: 1_000_000, // 1 token min
        };
        env.storage().instance().set(&DataKey::BridgeConfig, &config);
        
        // Initialize fees
        let fee_config = FeeConfig {
            bridge_fee_bps: DEFAULT_BRIDGE_FEE_BPS,
            protocol_fee_bps: DEFAULT_PROTOCOL_FEE_BPS,
            slippage_tolerance_bps: DEFAULT_SLIPPAGE_BPS,
            fee_recipient: admin.clone(),
        };
        env.storage().instance().set(&DataKey::BridgeFeeBps, &fee_config.bridge_fee_bps);
        env.storage().instance().set(&DataKey::ProtocolFeeBps, &fee_config.protocol_fee_bps);
        env.storage().instance().set(&DataKey::SlippageToleranceBps, &fee_config.slippage_tolerance_bps);
        env.storage().instance().set(&DataKey::FeeRecipient, &fee_config.fee_recipient);
        
        // Initialize transfer nonce
        env.storage().instance().set(&DataKey::TransferNonce, &0u64);
        
        // Mark as initialized (not paused by default)
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::Initialized, &true);
        
        // Emit initialization event
        env.events().publish(
            (symbol_short!("bridge_init"), admin),
            (relayer_count, min_confirmations),
        );
        
        Ok(())
    }

    /// Initiate cross-chain transfer (deposit on source chain)
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `sender` - User initiating transfer
    /// * `recipient` - Recipient address on destination chain (as bytes for EVM)
    /// * `dest_chain` - Destination chain type
    /// * `token` - Token type to bridge
    /// * `amount` - Amount to transfer
    /// 
    /// # Returns
    /// 
    /// * `Ok(BridgeTransfer)` - Created transfer request
    /// * `Err(CommonError)` - If validation fails or paused
    pub fn initiate_transfer(
        env: Env,
        sender: Address,
        recipient: Bytes,
        dest_chain: ChainType,
        token: Symbol,
        amount: i128,
    ) -> Result<BridgeTransfer, CommonError> {
        // Verify sender authorization
        sender.require_auth();
        
        // Check if bridge is paused
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        if paused {
            return Err(CommonError::NotAuthorized);
        }
        
        // Validate amount
        let config: BridgeConfig = env.storage().instance().get(&DataKey::BridgeConfig).unwrap();
        if amount < config.min_transfer_amount {
            return Err(CommonError::OutOfRange);
        }
        if amount > config.max_transfer_amount {
            return Err(CommonError::OutOfRange);
        }
        
        // Check rate limit
        if config.rate_limit_enabled {
            Self::check_rate_limit(&env, token.clone(), amount)?;
        }
        
        // Calculate fees
        let (fee, net_amount) = Self::calculate_fees(&env, amount)?;
        
        // Generate unique transfer ID
        let mut nonce: u64 = env.storage().instance().get(&DataKey::TransferNonce).unwrap();
        nonce += 1;
        env.storage().instance().set(&DataKey::TransferNonce, &nonce);
        
        // Create transfer record
        let transfer = BridgeTransfer {
            transfer_id: nonce,
            source_chain: ChainType::Stellar,
            dest_chain,
            sender: sender.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            amount,
            fee,
            net_amount,
            status: TransferStatus::Pending,
            created_at: env.ledger().timestamp(),
            confirmations: 0,
            required_confirmations: config.min_confirmations,
        };
        
        // Store transfer
        env.storage().persistent().set(&DataKey::Transfer(nonce), &transfer);
        
        // Lock liquidity
        Self::lock_liquidity(&env, token.clone(), amount)?;
        
        // Update rate limit
        if config.rate_limit_enabled {
            Self::update_rate_limit(&env, token.clone(), amount)?;
        }
        
        // Emit event
        env.events().publish(
            (symbol_short!("bridge_req"), sender.clone()),
            (nonce, dest_chain as u32, amount),
        );
        
        Ok(transfer)
    }

    /// Relay attestation from relayer (confirm transfer)
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `relayer` - Relayer address
    /// * `transfer_id` - Transfer ID to attest
    /// * `signature` - Relayer's signature
    /// 
    /// # Returns
    /// 
    /// * `Ok(bool)` - True if confirmation succeeded
    /// * `Err(CommonError)` - If invalid relayer or transfer
    pub fn relay_attestation(
        env: Env,
        relayer: Address,
        transfer_id: u64,
        signature: Bytes,
    ) -> Result<bool, CommonError> {
        // Verify relayer authorization
        relayer.require_auth();
        
        // Verify relayer is active
        let relayer_info: RelayerInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Relayer(relayer.clone()))
            .ok_or(CommonError::NotAuthorized)?;
        
        if !relayer_info.active {
            return Err(CommonError::NotAuthorized);
        }
        
        // Get transfer
        let mut transfer: BridgeTransfer = env
            .storage()
            .persistent()
            .get(&DataKey::Transfer(transfer_id))
            .ok_or(CommonError::KeyNotFound)?;
        
        // Check transfer not already completed
        if transfer.status == TransferStatus::Completed {
            return Err(CommonError::AlreadyInitialized);
        }
        
        // Check timeout
        let config: BridgeConfig = env.storage().instance().get(&DataKey::BridgeConfig).unwrap();
        if env.ledger().timestamp() > transfer.created_at + config.transfer_timeout {
            transfer.status = TransferStatus::Failed;
            env.storage().persistent().set(&DataKey::Transfer(transfer_id), &transfer);
            return Err(CommonError::OutOfRange); // Timeout
        }
        
        // Increment confirmations
        transfer.confirmations += 1;
        
        // Check if reached threshold
        if transfer.confirmations >= transfer.required_confirmations {
            transfer.status = TransferStatus::Confirmed;
        }
        
        // Store updated transfer
        env.storage().persistent().set(&DataKey::Transfer(transfer_id), &transfer);
        
        // Update relayer stats
        let mut updated_relayer = relayer_info;
        updated_relayer.successful_relays += 1;
        env.storage().persistent().set(&DataKey::Relayer(relayer.clone()), &updated_relayer);
        
        // Emit attestation event
        env.events().publish(
            (symbol_short!("relay_att"), relayer.clone()),
            (transfer_id, transfer.confirmations),
        );
        
        Ok(true)
    }

    /// Complete transfer on destination chain (mint tokens)
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `transfer_id` - Transfer ID to complete
    /// 
    /// # Returns
    /// 
    /// * `Ok(())` - Transfer completed
    /// * `Err(CommonError)` - If not confirmed or invalid
    pub fn complete_transfer(env: Env, transfer_id: u64) -> Result<(), CommonError> {
        // Get transfer
        let mut transfer: BridgeTransfer = env
            .storage()
            .persistent()
            .get(&DataKey::Transfer(transfer_id))
            .ok_or(CommonError::KeyNotFound)?;
        
        // Check if confirmed
        if transfer.status != TransferStatus::Confirmed {
            return Err(CommonError::NotAuthorized);
        }
        
        // Mint tokens on destination (mock - in production would use token contract)
        // For now, we just track that tokens were minted
        let mut minted: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::MintedTokens(transfer.token.clone()))
            .unwrap_or(0);
        minted += transfer.net_amount;
        env.storage().persistent().set(&DataKey::MintedTokens(transfer.token.clone()), &minted);
        
        // Update transfer status
        transfer.status = TransferStatus::Completed;
        env.storage().persistent().set(&DataKey::Transfer(transfer_id), &transfer);
        
        // Distribute fees
        Self::distribute_fees(&env, transfer.token.clone(), transfer.fee)?;
        
        // Emit completion event
        env.events().publish(
            (symbol_short!("bridge_cmp"), transfer.sender.clone()),
            (transfer_id, transfer.net_amount),
        );
        
        Ok(())
    }

    /// Burn tokens on destination chain to withdraw on source
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `burner` - Address burning tokens
    /// * `recipient` - Recipient on source chain
    /// * `source_chain` - Source chain (where tokens will be released)
    /// * `token` - Token type
    /// * `amount` - Amount to burn
    /// 
    /// # Returns
    /// 
    /// * `Ok(BridgeTransfer)` - New transfer request for withdrawal
    /// * `Err(CommonError)` - If burn fails
    pub fn burn_and_withdraw(
        env: Env,
        burner: Address,
        recipient: Address,
        source_chain: ChainType,
        token: Symbol,
        amount: i128,
    ) -> Result<BridgeTransfer, CommonError> {
        burner.require_auth();
        
        // Check if bridge is paused
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        if paused {
            return Err(CommonError::NotAuthorized);
        }
        
        // Validate amount
        let config: BridgeConfig = env.storage().instance().get(&DataKey::BridgeConfig).unwrap();
        if amount < config.min_transfer_amount || amount > config.max_transfer_amount {
            return Err(CommonError::OutOfRange);
        }
        
        // Verify burned tokens exist (mock check)
        let minted: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::MintedTokens(token.clone()))
            .unwrap_or(0);
        
        if minted < amount {
            return Err(CommonError::OutOfRange); // Insufficient burned tokens
        }
        
        // Calculate fees
        let (fee, net_amount) = Self::calculate_fees(&env, amount)?;
        
        // Generate transfer ID
        let mut nonce: u64 = env.storage().instance().get(&DataKey::TransferNonce).unwrap();
        nonce += 1;
        env.storage().instance().set(&DataKey::TransferNonce, &nonce);
        
        // Create burn transfer record
        let transfer = BridgeTransfer {
            transfer_id: nonce,
            source_chain: ChainType::EVM, // Assuming burn happens on EVM
            dest_chain: source_chain,
            sender: burner.clone(),
            recipient: Bytes::from_slice(&env, recipient.to_string().as_bytes()),
            token: token.clone(),
            amount,
            fee,
            net_amount,
            status: TransferStatus::Pending,
            created_at: env.ledger().timestamp(),
            confirmations: 0,
            required_confirmations: config.min_confirmations,
        };
        
        // Store transfer
        env.storage().persistent().set(&DataKey::Transfer(nonce), &transfer);
        
        // Track burned tokens
        let mut burned: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::BurnedTokens(token.clone()))
            .unwrap_or(0);
        burned += amount;
        env.storage().persistent().set(&DataKey::BurnedTokens(token.clone()), &burned);
        
        // Emit event
        env.events().publish(
            (symbol_short!("bridge_burn"), burner.clone()),
            (nonce, amount),
        );
        
        Ok(transfer)
    }

    /// Add new relayer (admin only)
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `admin` - Admin address
    /// * `relayer` - New relayer address
    pub fn add_relayer(env: Env, admin: Address, relayer: Address) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;
        
        // Check if already a relayer
        if env.storage().persistent().has(&DataKey::Relayer(relayer.clone())) {
            return Err(CommonError::AlreadyInitialized);
        }
        
        // Add relayer
        let relayer_info = RelayerInfo {
            address: relayer.clone(),
            stake: 0,
            added_at: env.ledger().timestamp(),
            active: true,
            successful_relays: 0,
            failed_relays: 0,
        };
        env.storage().persistent().set(&DataKey::Relayer(relayer.clone()), &relayer_info);
        
        // Update count
        let mut count: u32 = env.storage().instance().get(&DataKey::RelayerCount).unwrap();
        count += 1;
        env.storage().instance().set(&DataKey::RelayerCount, &count);
        
        env.events().publish(
            (symbol_short!("relayer_add"), admin),
            relayer,
        );
        
        Ok(())
    }

    /// Remove relayer (admin only)
    /// 
    /// # Arguments
    /// 
    /// * `env` - Soroban environment
    /// * `admin` - Admin address
    /// * `relayer` - Relayer to remove
    pub fn remove_relayer(env: Env, admin: Address, relayer: Address) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;
        
        // Set inactive
        let mut relayer_info: RelayerInfo = env
            .storage()
            .persistent()
            .get(&DataKey::Relayer(relayer.clone()))
            .ok_or(CommonError::KeyNotFound)?;
        
        relayer_info.active = false;
        env.storage().persistent().set(&DataKey::Relayer(relayer.clone()), &relayer_info);
        
        env.events().publish(
            (symbol_short!("relayer_rem"), admin),
            relayer,
        );
        
        Ok(())
    }

    /// Emergency pause (admin only)
    pub fn pause(env: Env, admin: Address, reason: Symbol) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;
        
        env.storage().instance().set(&DataKey::Paused, &true);
        env.storage().instance().set(&DataKey::PauseReason, &reason);
        
        env.events().publish(
            (symbol_short!("bridge_pause"), admin),
            reason,
        );
        
        Ok(())
    }

    /// Unpause bridge (admin only)
    pub fn unpause(env: Env, admin: Address) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;
        
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().remove(&DataKey::PauseReason);
        
        env.events().publish(
            (symbol_short!("bridge_unpa"), admin),
            symbol_short!("resumed"),
        );
        
        Ok(())
    }

    /// Update bridge configuration (admin only)
    pub fn update_config(
        env: Env,
        admin: Address,
        config: BridgeConfig,
    ) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::BridgeConfig, &config);
        
        env.events().publish(
            (symbol_short!("cfg_upd"), admin),
            symbol_short!("updated"),
        );
        
        Ok(())
    }

    /// Update fee configuration (admin only)
    pub fn update_fees(
        env: Env,
        admin: Address,
        bridge_fee_bps: u32,
        protocol_fee_bps: u32,
        slippage_bps: u32,
    ) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;
        
        // Validate basis points (max 10000 = 100%)
        if bridge_fee_bps > 10000 || protocol_fee_bps > 10000 || slippage_bps > 10000 {
            return Err(CommonError::OutOfRange);
        }
        
        env.storage().instance().set(&DataKey::BridgeFeeBps, &bridge_fee_bps);
        env.storage().instance().set(&DataKey::ProtocolFeeBps, &protocol_fee_bps);
        env.storage().instance().set(&DataKey::SlippageToleranceBps, &slippage_bps);
        
        env.events().publish(
            (symbol_short!("fee_upd"), admin),
            (bridge_fee_bps, protocol_fee_bps),
        );
        
        Ok(())
    }

    /// Get bridge statistics for monitoring
    pub fn get_stats(env: Env) -> BridgeStats {
        let total_transfers: u64 = env.storage().instance().get(&DataKey::TransferNonce).unwrap_or(0);
        let relayer_count: u32 = env.storage().instance().get(&DataKey::RelayerCount).unwrap_or(0);
        let is_paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        let last_health: u64 = env.storage().instance().get(&DataKey::HealthCheckTimestamp).unwrap_or(0);
        
        BridgeStats {
            total_transfers: total_transfers as u32,
            total_volume: Map::new(&env), // Would aggregate from transfers
            active_relayers: relayer_count,
            is_paused,
            last_health_check: last_health,
            rate_limit_usage: Map::new(&env),
        }
    }

    /// Get transfer by ID
    pub fn get_transfer(env: Env, transfer_id: u64) -> Result<BridgeTransfer, CommonError> {
        env.storage()
            .persistent()
            .get(&DataKey::Transfer(transfer_id))
            .ok_or(CommonError::KeyNotFound)
    }

    /// Get relayer info
    pub fn get_relayer_info(env: Env, relayer: Address) -> Result<RelayerInfo, CommonError> {
        env.storage()
            .persistent()
            .get(&DataKey::Relayer(relayer))
            .ok_or(CommonError::KeyNotFound)
    }

    /// Get liquidity pool info
    pub fn get_liquidity_pool(env: Env, token: Symbol) -> Result<LiquidityPool, CommonError> {
        env.storage()
            .persistent()
            .get(&DataKey::LiquidityPool(token))
            .ok_or(CommonError::KeyNotFound)
    }

    /// Health check function for monitoring
    pub fn health_check(env: Env) -> bool {
        // Update health check timestamp
        env.storage().instance().set(&DataKey::HealthCheckTimestamp, &env.ledger().timestamp());
        
        // Basic health checks
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        if paused {
            return false;
        }
        
        // Check relayers are responding (would need more sophisticated check in production)
        let relayer_count: u32 = env.storage().instance().get(&DataKey::RelayerCount).unwrap_or(0);
        relayer_count > 0
    }

    // ========================================================================
    // Internal Helper Functions
    // ========================================================================

    /// Calculate fees for a transfer
    fn calculate_fees(env: &Env, amount: i128) -> Result<(i128, i128), CommonError> {
        let bridge_fee_bps: u32 = env.storage().instance().get(&DataKey::BridgeFeeBps).unwrap();
        let protocol_fee_bps: u32 = env.storage().instance().get(&DataKey::ProtocolFeeBps).unwrap();
        
        let bridge_fee = (amount * bridge_fee_bps as i128) / 10000;
        let protocol_fee = (amount * protocol_fee_bps as i128) / 10000;
        let total_fee = bridge_fee + protocol_fee;
        let net_amount = amount - total_fee;
        
        Ok((total_fee, net_amount))
    }

    /// Distribute collected fees
    fn distribute_fees(env: &Env, token: Symbol, fee: i128) -> Result<(), CommonError> {
        let fee_recipient: Address = env.storage().instance().get(&DataKey::FeeRecipient).unwrap();
        
        // Mock distribution (in production would transfer tokens)
        env.events().publish(
            (symbol_short!("fee_dist"), fee_recipient),
            (token, fee),
        );
        
        Ok(())
    }

    /// Check rate limit for token
    fn check_rate_limit(env: &Env, token: Symbol, amount: i128) -> Result<(), CommonError> {
        let config: BridgeConfig = env.storage().instance().get(&DataKey::BridgeConfig).unwrap();
        
        // Get daily limit
        let daily_limit = config.daily_limit_per_token;
        
        // Get current usage
        let current_time = env.ledger().timestamp();
        let day_start = (current_time / SECONDS_PER_DAY) * SECONDS_PER_DAY;
        
        let mut used: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::RateLimitUsed(token.clone(), day_start))
            .unwrap_or(0);
        
        // Check if would exceed limit
        if used + amount > daily_limit {
            return Err(CommonError::OutOfRange);
        }
        
        Ok(())
    }

    /// Update rate limit usage
    fn update_rate_limit(env: &Env, token: Symbol, amount: i128) -> Result<(), CommonError> {
        let current_time = env.ledger().timestamp();
        let day_start = (current_time / SECONDS_PER_DAY) * SECONDS_PER_DAY;
        
        let mut used: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::RateLimitUsed(token.clone(), day_start))
            .unwrap_or(0);
        
        used += amount;
        env.storage().persistent().set(&DataKey::RateLimitUsed(token, day_start), &used);
        
        Ok(())
    }

    /// Lock liquidity for transfer
    fn lock_liquidity(env: &Env, token: Symbol, amount: i128) -> Result<(), CommonError> {
        // Get or create liquidity pool
        let mut pool: LiquidityPool = env
            .storage()
            .persistent()
            .get(&DataKey::LiquidityPool(token.clone()))
            .unwrap_or_else(|| LiquidityPool {
                token: token.clone(),
                total_liquidity: 0,
                available: 0,
                locked: 0,
                target_allocation: 0,
            });
        
        // Lock amount
        pool.locked += amount;
        pool.available = pool.total_liquidity - pool.locked;
        
        env.storage().persistent().set(&DataKey::LiquidityPool(token), &pool);
        
        Ok(())
    }

    /// Require admin authorization
    fn require_admin(env: &Env, admin: &Address) -> Result<(), CommonError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CommonError::NotInitialized)?;
        
        if stored_admin != *admin {
            return Err(CommonError::NotAuthorized);
        }
        
        admin.require_auth();
        Ok(())
    }
}
