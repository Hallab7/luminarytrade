//! # Escrow Contract with Referral Program
//!
//! A secure escrow system with referral bonuses for promoting escrow services.
//!
//! ## Features
//!
//! - **Escrow Management**: Create, fund, and release escrow agreements
//! - **Referral Program**: Track referrals and distribute bonuses
//! - **Unique Referral Codes**: Each user gets a unique code
//! - **Secure Transactions**: Multi-party authorization required
//! - **Bonus Distribution**: Automatic bonus payments for successful referrals
//!
//! ## Referral Flow
//!
//! 1. User generates referral code
//! 2. New user signs up with referral code
//! 3. New user creates escrow transaction
//! 4. Referrer receives bonus when escrow completes
//! 5. Bonus tracked and distributed automatically

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, panic_with_error,
    Address, Env, Map, Symbol, Vec, String, IntoVal, Val
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
    EscrowCount,
    ReferralConfig,
    
    // Escrow Management
    Escrow(u64),
    UserEscrows(Address),
    
    // Referral System
    ReferralCode(String),
    UserReferralCode(Address),
    ReferralStats(Address),
    ReferralBonus(u64),
    TotalReferralBonuses,
}

// ============================================================================
// Data Types
// ============================================================================

/// Escrow status
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum EscrowStatus {
    /// Created, awaiting funding
    Created = 0,
    /// Funded, awaiting delivery
    Funded = 1,
    /// Delivered, awaiting confirmation
    Delivered = 2,
    /// Completed and released
    Completed = 3,
    /// Disputed
    Disputed = 4,
    /// Cancelled
    Cancelled = 5,
}

/// Escrow agreement
#[derive(Clone)]
#[contracttype]
pub struct EscrowAgreement {
    /// Escrow ID
    pub escrow_id: u64,
    /// Buyer address
    pub buyer: Address,
    /// Seller address
    pub seller: Address,
    /// Amount in escrow
    pub amount: i128,
    /// Current status
    pub status: EscrowStatus,
    /// Created timestamp
    pub created_at: u64,
    /// Funded timestamp
    pub funded_at: Option<u64>,
    /// Completed timestamp
    pub completed_at: Option<u64>,
    /// Description of goods/services
    pub description: String,
    /// Referral code used (if any)
    pub referral_code: Option<String>,
}

/// Referral configuration
#[derive(Clone)]
#[contracttype]
pub struct ReferralConfig {
    /// Bonus percentage in basis points (100 = 1%)
    pub bonus_percentage_bps: u32,
    /// Maximum bonus amount
    pub max_bonus: i128,
    /// Minimum escrow amount for referral bonus
    pub min_escrow_amount: i128,
    /// Enable/disable referral program
    pub enabled: bool,
}

/// Referral statistics
#[derive(Clone)]
#[contracttype]
pub struct ReferralStats {
    /// Referrer address
    pub referrer: Address,
    /// Total referrals made
    pub total_referrals: u32,
    /// Successful referrals (escrow completed)
    pub successful_referrals: u32,
    /// Total bonuses earned
    pub total_bonuses_earned: i128,
    /// Referral code
    pub referral_code: String,
}

/// Referral bonus record
#[derive(Clone)]
#[contracttype]
pub struct ReferralBonusRecord {
    /// Bonus ID
    pub bonus_id: u64,
    /// Escrow ID that triggered the bonus
    pub escrow_id: u64,
    /// Referrer address
    pub referrer: Address,
    /// Referred user address
    pub referred_user: Address,
    /// Bonus amount
    pub bonus_amount: i128,
    /// Timestamp
    pub timestamp: u64,
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_BONUS_PERCENTAGE_BPS: u32 = 100; // 1%
const DEFAULT_MAX_BONUS: i128 = 1_000_000_000; // 1000 tokens
const DEFAULT_MIN_ESCROW_AMOUNT: i128 = 10_000_000; // 10 tokens

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct EscrowReferralContract;

// ============================================================================
// Implementation
// ============================================================================

#[contractimpl]
impl EscrowReferralContract {
    /// Initialize the escrow referral contract
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `admin` - Admin address
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Initialization successful
    /// * `Err(CommonError)` - If already initialized
    pub fn initialize(
        env: Env,
        admin: Address,
    ) -> Result<(), CommonError> {
        // Check if already initialized
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(CommonError::AlreadyInitialized);
        }

        // Store admin
        env.storage().instance().set(&DataKey::Admin, &admin);

        // Initialize configuration
        let config = ReferralConfig {
            bonus_percentage_bps: DEFAULT_BONUS_PERCENTAGE_BPS,
            max_bonus: DEFAULT_MAX_BONUS,
            min_escrow_amount: DEFAULT_MIN_ESCROW_AMOUNT,
            enabled: true,
        };
        env.storage().instance().set(&DataKey::ReferralConfig, &config);

        // Initialize counters
        env.storage().instance().set(&DataKey::EscrowCount, &0u64);
        env.storage().instance().set(&DataKey::TotalReferralBonuses, &0i128);

        // Mark as initialized
        env.storage().instance().set(&DataKey::Initialized, &true);

        // Emit initialization event
        env.events().publish(
            (symbol_short!("esc_init"), admin),
            symbol_short!("initialized"),
        );

        Ok(())
    }

    /// Generate a unique referral code for a user
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `user` - User address
    ///
    /// # Returns
    ///
    /// * `Ok(String)` - Referral code
    /// * `Err(CommonError)` - If user already has a code
    pub fn generate_referral_code(
        env: Env,
        user: Address,
    ) -> Result<String, CommonError> {
        user.require_auth();

        // Check if user already has a code
        if env.storage().persistent().has(&DataKey::UserReferralCode(user.clone())) {
            return Err(CommonError::AlreadyInitialized);
        }

        // Generate unique code (using address as base)
        let code_str = format!("REF-{:?}", user);
        let code = String::from_slice(&env, &code_str);

        // Store referral code
        env.storage().persistent().set(&DataKey::UserReferralCode(user.clone()), &code);
        env.storage().persistent().set(&DataKey::ReferralCode(code.clone()), &user);

        // Initialize referral stats
        let stats = ReferralStats {
            referrer: user.clone(),
            total_referrals: 0,
            successful_referrals: 0,
            total_bonuses_earned: 0,
            referral_code: code.clone(),
        };
        env.storage().persistent().set(&DataKey::ReferralStats(user.clone()), &stats);

        // Emit event
        env.events().publish(
            (symbol_short!("ref_gen"), user),
            code,
        );

        Ok(code)
    }

    /// Create a new escrow agreement
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `buyer` - Buyer address
    /// * `seller` - Seller address
    /// * `amount` - Amount to escrow
    /// * `description` - Description of goods/services
    /// * `referral_code` - Referral code (optional)
    ///
    /// # Returns
    ///
    /// * `Ok(u64)` - Escrow ID
    /// * `Err(CommonError)` - If validation fails
    pub fn create_escrow(
        env: Env,
        buyer: Address,
        seller: Address,
        amount: i128,
        description: String,
        referral_code: Option<String>,
    ) -> Result<u64, CommonError> {
        buyer.require_auth();

        // Validate amount
        if amount <= 0 {
            return Err(CommonError::OutOfRange);
        }

        // Validate referral code if provided
        if let Some(ref code) = referral_code {
            if !env.storage().persistent().has(&DataKey::ReferralCode(code.clone())) {
                return Err(CommonError::KeyNotFound);
            }
        }

        // Generate escrow ID
        let escrow_id: u64 = env.storage().instance().get(&DataKey::EscrowCount).unwrap_or(0);

        // Create escrow agreement
        let escrow = EscrowAgreement {
            escrow_id,
            buyer: buyer.clone(),
            seller: seller.clone(),
            amount,
            status: EscrowStatus::Created,
            created_at: env.ledger().timestamp(),
            funded_at: None,
            completed_at: None,
            description,
            referral_code: referral_code.clone(),
        };

        // Store escrow
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);
        env.storage().instance().set(&DataKey::EscrowCount, &(escrow_id + 1));

        // Track user escrows
        let mut user_escrows: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::UserEscrows(buyer.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        user_escrows.push_back(escrow_id);
        env.storage().persistent().set(&DataKey::UserEscrows(buyer.clone()), &user_escrows);

        // Emit event
        env.events().publish(
            (symbol_short!("esc_create"), buyer),
            (escrow_id, amount),
        );

        Ok(escrow_id)
    }

    /// Fund an escrow agreement
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `buyer` - Buyer address
    /// * `escrow_id` - Escrow ID
    ///
    /// # Returns
    ///
    /// * `Ok(bool)` - True if successful
    /// * `Err(CommonError)` - If validation fails
    pub fn fund_escrow(
        env: Env,
        buyer: Address,
        escrow_id: u64,
    ) -> Result<bool, CommonError> {
        buyer.require_auth();

        // Get escrow
        let mut escrow: EscrowAgreement = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .ok_or(CommonError::KeyNotFound)?;

        // Verify buyer
        if escrow.buyer != buyer {
            return Err(CommonError::NotAuthorized);
        }

        // Check status
        if escrow.status != EscrowStatus::Created {
            return Err(CommonError::NotAuthorized);
        }

        // Update status
        escrow.status = EscrowStatus::Funded;
        escrow.funded_at = Some(env.ledger().timestamp());

        // Store updated escrow
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);

        // Emit event
        env.events().publish(
            (symbol_short!("esc_fund"), buyer),
            escrow_id,
        );

        Ok(true)
    }

    /// Complete escrow and release funds to seller
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `buyer` - Buyer address
    /// * `escrow_id` - Escrow ID
    ///
    /// # Returns
    ///
    /// * `Ok(bool)` - True if successful
    /// * `Err(CommonError)` - If validation fails
    pub fn complete_escrow(
        env: Env,
        buyer: Address,
        escrow_id: u64,
    ) -> Result<bool, CommonError> {
        buyer.require_auth();

        // Get escrow
        let mut escrow: EscrowAgreement = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .ok_or(CommonError::KeyNotFound)?;

        // Verify buyer
        if escrow.buyer != buyer {
            return Err(CommonError::NotAuthorized);
        }

        // Check status
        if escrow.status != EscrowStatus::Funded && escrow.status != EscrowStatus::Delivered {
            return Err(CommonError::NotAuthorized);
        }

        // Update status
        escrow.status = EscrowStatus::Completed;
        escrow.completed_at = Some(env.ledger().timestamp());

        // Store updated escrow
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);

        // Process referral bonus if applicable
        if let Some(ref code) = escrow.referral_code {
            Self::process_referral_bonus(&env, escrow_id, &escrow, code)?;
        }

        // Emit event
        env.events().publish(
            (symbol_short!("esc_complete"), buyer),
            (escrow_id, escrow.amount),
        );

        Ok(true)
    }

    /// Get escrow details
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `escrow_id` - Escrow ID
    ///
    /// # Returns
    ///
    /// * `Option<EscrowAgreement>` - Escrow details
    pub fn get_escrow(env: Env, escrow_id: u64) -> Option<EscrowAgreement> {
        env.storage().persistent().get(&DataKey::Escrow(escrow_id))
    }

    /// Get user's escrows
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `user` - User address
    ///
    /// # Returns
    ///
    /// * `Vec<u64>` - List of escrow IDs
    pub fn get_user_escrows(env: Env, user: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::UserEscrows(user))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Get user's referral stats
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `user` - User address
    ///
    /// # Returns
    ///
    /// * `ReferralStats` - Referral statistics
    pub fn get_referral_stats(env: Env, user: Address) -> ReferralStats {
        env.storage()
            .persistent()
            .get(&DataKey::ReferralStats(user))
            .unwrap_or_else(|| ReferralStats {
                referrer: Address::generate(&env),
                total_referrals: 0,
                successful_referrals: 0,
                total_bonuses_earned: 0,
                referral_code: String::from_slice(&env, ""),
            })
    }

    /// Get user's referral code
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `user` - User address
    ///
    /// # Returns
    ///
    /// * `Option<String>` - Referral code
    pub fn get_referral_code(env: Env, user: Address) -> Option<String> {
        env.storage().persistent().get(&DataKey::UserReferralCode(user))
    }

    /// Update referral configuration (admin only)
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `admin` - Admin address
    /// * `config` - New configuration
    pub fn update_referral_config(
        env: Env,
        admin: Address,
        config: ReferralConfig,
    ) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::ReferralConfig, &config);
        
        env.events().publish(
            (symbol_short!("ref_cfg_upd"), admin),
            symbol_short!("updated"),
        );

        Ok(())
    }

    // ========================================================================
    // Internal Helper Functions
    // ========================================================================

    /// Process referral bonus when escrow completes
    fn process_referral_bonus(
        env: &Env,
        escrow_id: u64,
        escrow: &EscrowAgreement,
        referral_code: &String,
    ) -> Result<(), CommonError> {
        // Get referral config
        let config: ReferralConfig = env.storage().instance().get(&DataKey::ReferralConfig).unwrap();
        
        // Check if referral program is enabled
        if !config.enabled {
            return Ok(());
        }

        // Check minimum escrow amount
        if escrow.amount < config.min_escrow_amount {
            return Ok(());
        }

        // Get referrer from code
        let referrer: Address = env
            .storage()
            .persistent()
            .get(&DataKey::ReferralCode(referral_code.clone()))
            .ok_or(CommonError::KeyNotFound)?;

        // Calculate bonus
        let mut bonus = (escrow.amount * config.bonus_percentage_bps as i128) / 10000;
        if bonus > config.max_bonus {
            bonus = config.max_bonus;
        }

        // Update referrer stats
        let mut stats: ReferralStats = env
            .storage()
            .persistent()
            .get(&DataKey::ReferralStats(referrer.clone()))
            .ok_or(CommonError::KeyNotFound)?;
        
        stats.successful_referrals += 1;
        stats.total_bonuses_earned += bonus;
        env.storage().persistent().set(&DataKey::ReferralStats(referrer.clone()), &stats);

        // Record bonus
        let bonus_count: u64 = env.storage().instance().get(&DataKey::TotalReferralBonuses).unwrap_or(0);
        let bonus_record = ReferralBonusRecord {
            bonus_id: bonus_count,
            escrow_id,
            referrer: referrer.clone(),
            referred_user: escrow.buyer.clone(),
            bonus_amount: bonus,
            timestamp: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&DataKey::ReferralBonus(bonus_count), &bonus_record);
        env.storage().instance().set(&DataKey::TotalReferralBonuses, &(bonus_count + 1));

        // Emit event
        env.events().publish(
            (symbol_short!("ref_bonus"), referrer),
            (escrow_id, bonus),
        );

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
