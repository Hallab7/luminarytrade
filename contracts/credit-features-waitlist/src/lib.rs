//! # Credit Features Waitlist Contract
//!
//! A waitlist management system for advanced credit features with early access capabilities.
//!
//! ## Features
//!
//! - **Queue Management**: Ordered waitlist with priority system
//! - **Early Access**: Controlled rollout of credit features
//! - **User Onboarding**: Streamlined process for feature access
//! - **Notifications**: Status updates for waitlist position and access grants
//!
//! ## Architecture
//!
//! ### Waitlist Flow
//!
//! 1. **Registration**: Users join the waitlist contract
//! 2. **Queue Position**: Users receive a position in the queue
//! 3. **Early Access**: Selected users get early access to features
//! 4. **Full Launch**: Features become available to all waitlisted users
//! 5. **Notifications**: Users notified of status changes

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
    WaitlistConfig,
    
    // Feature Management
    FeatureCount,
    Feature(u64),
    FeatureIndex(Symbol),
    
    // User Management
    UserRegistrations(Address),
    FeatureWaitlist(u64),
    EarlyAccessUsers(u64),
    UserQueuePosition(Address, u64),
    
    // Access Control
    AccessGranted(u64),
    TotalSlots,
    AvailableSlots,
    
    // Notifications
    NotificationCount,
    Notification(u64),
    UserNotificationPrefs(Address),
}

// ============================================================================
// Data Types
// ============================================================================

/// Status of a credit feature
#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum FeatureStatus {
    /// Feature in development
    Development = 0,
    /// Waitlist open
    WaitlistOpen = 1,
    /// Early access phase
    EarlyAccess = 2,
    /// Fully launched
    Launched = 3,
    /// Paused
    Paused = 4,
}

/// Credit feature information
#[derive(Clone)]
#[contracttype]
pub struct CreditFeature {
    /// Unique feature ID
    pub feature_id: u64,
    /// Feature name/identifier
    pub name: Symbol,
    /// Feature description
    pub description: String,
    /// Current status
    pub status: FeatureStatus,
    /// Total waitlist count
    pub waitlist_count: u32,
    /// Early access slots
    pub early_access_slots: u32,
    /// Granted access count
    pub access_granted_count: u32,
    /// Created timestamp
    pub created_at: u64,
    /// Early access start timestamp
    pub early_access_at: Option<u64>,
    /// Full launch timestamp
    pub launched_at: Option<u64>,
    /// Created by
    pub created_by: Address,
}

/// Waitlist configuration
#[derive(Clone)]
#[contracttype]
pub struct WaitlistConfig {
    /// Default early access slots per feature
    pub default_early_access_slots: u32,
    /// Maximum features in waitlist
    pub max_features: u32,
    /// Enable auto-grant access
    pub auto_grant_enabled: bool,
    /// Notification enabled
    pub notifications_enabled: bool,
}

/// User registration information
#[derive(Clone)]
#[contracttype]
pub struct UserRegistration {
    /// User address
    pub user: Address,
    /// Registered timestamp
    pub registered_at: u64,
    /// Credit score (if available)
    pub credit_score: Option<u32>,
    /// Priority level (higher = more priority)
    pub priority: u32,
    /// Access granted status
    pub access_granted: bool,
    /// Features registered for
    pub feature_ids: Vec<u64>,
}

/// Notification for users
#[derive(Clone)]
#[contracttype]
pub struct Notification {
    /// Notification ID
    pub notification_id: u64,
    /// Recipient address
    pub recipient: Address,
    /// Notification type
    pub notification_type: Symbol,
    /// Message content
    pub message: String,
    /// Timestamp
    pub created_at: u64,
    /// Read status
    pub read: bool,
}

/// User notification preferences
#[derive(Clone)]
#[contracttype]
pub struct NotificationPrefs {
    /// Enable notifications
    pub enabled: bool,
    /// Notify on position change
    pub notify_on_position_change: bool,
    /// Notify on access granted
    pub notify_on_access_granted: bool,
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_EARLY_ACCESS_SLOTS: u32 = 100;
const DEFAULT_MAX_FEATURES: u32 = 20;

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct CreditFeaturesWaitlistContract;

// ============================================================================
// Implementation
// ============================================================================

#[contractimpl]
impl CreditFeaturesWaitlistContract {
    /// Initialize the waitlist contract
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `admin` - Admin address
    /// * `default_early_access_slots` - Default number of early access slots
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Initialization successful
    /// * `Err(CommonError)` - If already initialized
    pub fn initialize(
        env: Env,
        admin: Address,
        default_early_access_slots: u32,
    ) -> Result<(), CommonError> {
        // Check if already initialized
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(CommonError::AlreadyInitialized);
        }

        // Store admin
        env.storage().instance().set(&DataKey::Admin, &admin);

        // Initialize configuration
        let config = WaitlistConfig {
            default_early_access_slots: if default_early_access_slots > 0 { 
                default_early_access_slots 
            } else { 
                DEFAULT_EARLY_ACCESS_SLOTS 
            },
            max_features: DEFAULT_MAX_FEATURES,
            auto_grant_enabled: true,
            notifications_enabled: true,
        };
        env.storage().instance().set(&DataKey::WaitlistConfig, &config);

        // Initialize counters
        env.storage().instance().set(&DataKey::FeatureCount, &0u64);
        env.storage().instance().set(&DataKey::NotificationCount, &0u64);

        // Mark as initialized
        env.storage().instance().set(&DataKey::Initialized, &true);

        // Emit initialization event
        env.events().publish(
            (symbol_short!("cfw_init"), admin),
            (config.default_early_access_slots,),
        );

        Ok(())
    }

    /// Add a new credit feature to the waitlist system
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `creator` - Address creating the feature
    /// * `name` - Feature name
    /// * `description` - Feature description
    /// * `early_access_slots` - Number of early access slots (0 for default)
    ///
    /// # Returns
    ///
    /// * `Ok(u64)` - Feature ID if successful
    /// * `Err(CommonError)` - If validation fails
    pub fn add_feature(
        env: Env,
        creator: Address,
        name: Symbol,
        description: String,
        early_access_slots: u32,
    ) -> Result<u64, CommonError> {
        creator.require_auth();

        // Check if already initialized
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(CommonError::NotInitialized);
        }

        // Check feature limit
        let config: WaitlistConfig = env.storage().instance().get(&DataKey::WaitlistConfig).unwrap();
        let feature_count: u64 = env.storage().instance().get(&DataKey::FeatureCount).unwrap();
        
        if feature_count >= config.max_features as u64 {
            return Err(CommonError::OutOfRange);
        }

        // Check if feature already exists
        if env.storage().persistent().has(&DataKey::FeatureIndex(name.clone())) {
            return Err(CommonError::AlreadyInitialized);
        }

        // Determine early access slots
        let slots = if early_access_slots > 0 { 
            early_access_slots 
        } else { 
            config.default_early_access_slots 
        };

        // Generate feature ID
        let feature_id = feature_count;
        
        // Create credit feature
        let feature = CreditFeature {
            feature_id,
            name: name.clone(),
            description,
            status: FeatureStatus::WaitlistOpen,
            waitlist_count: 0,
            early_access_slots: slots,
            access_granted_count: 0,
            created_at: env.ledger().timestamp(),
            early_access_at: None,
            launched_at: None,
            created_by: creator.clone(),
        };

        // Store feature
        env.storage().persistent().set(&DataKey::Feature(feature_id), &feature);
        env.storage().persistent().set(&DataKey::FeatureIndex(name), &feature_id);
        env.storage().instance().set(&DataKey::FeatureCount, &(feature_id + 1));

        // Initialize waitlist
        let waitlist: Vec<Address> = Vec::new(&env);
        env.storage().persistent().set(&DataKey::FeatureWaitlist(feature_id), &waitlist);

        // Initialize early access list
        let early_access: Vec<Address> = Vec::new(&env);
        env.storage().persistent().set(&DataKey::EarlyAccessUsers(feature_id), &early_access);

        // Emit event
        env.events().publish(
            (symbol_short!("cfw_add"), creator),
            (feature_id, name, slots),
        );

        Ok(feature_id)
    }

    /// Join the waitlist for a credit feature
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `user` - User address joining waitlist
    /// * `feature_id` - Feature ID to join
    /// * `credit_score` - Optional credit score for priority
    ///
    /// # Returns
    ///
    /// * `Ok(u32)` - Queue position if successful
    /// * `Err(CommonError)` - If validation fails or already registered
    pub fn join_waitlist(
        env: Env,
        user: Address,
        feature_id: u64,
        credit_score: Option<u32>,
    ) -> Result<u32, CommonError> {
        user.require_auth();

        // Get feature
        let mut feature: CreditFeature = env
            .storage()
            .persistent()
            .get(&DataKey::Feature(feature_id))
            .ok_or(CommonError::KeyNotFound)?;

        // Check feature is accepting waitlist
        if feature.status != FeatureStatus::WaitlistOpen {
            return Err(CommonError::NotAuthorized);
        }

        // Check if already registered
        let mut waitlist: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::FeatureWaitlist(feature_id))
            .unwrap_or_else(|| Vec::new(&env));

        for existing_user in waitlist.iter() {
            if existing_user == user {
                return Err(CommonError::AlreadyInitialized);
            }
        }

        // Calculate priority based on credit score
        let priority = match credit_score {
            Some(score) => score / 10, // Higher credit score = higher priority
            None => 0,
        };

        // Add to waitlist
        waitlist.push_back(user.clone());
        feature.waitlist_count += 1;

        // Store updated data
        env.storage().persistent().set(&DataKey::Feature(feature_id), &feature);
        env.storage().persistent().set(&DataKey::FeatureWaitlist(feature_id), &waitlist);

        // Store queue position
        let position = feature.waitlist_count;
        env.storage().persistent().set(
            &DataKey::UserQueuePosition(user.clone(), feature_id), 
            &position
        );

        // Create or update user registration
        let mut registration: UserRegistration = env
            .storage()
            .persistent()
            .get(&DataKey::UserRegistrations(user.clone()))
            .unwrap_or_else(|| UserRegistration {
                user: user.clone(),
                registered_at: env.ledger().timestamp(),
                credit_score,
                priority,
                access_granted: false,
                feature_ids: Vec::new(&env),
            });

        registration.feature_ids.push_back(feature_id);
        registration.credit_score = credit_score;
        registration.priority = priority;
        env.storage().persistent().set(&DataKey::UserRegistrations(user.clone()), &registration);

        // Emit event
        env.events().publish(
            (symbol_short!("cfw_join"), user),
            (feature_id, position),
        );

        Ok(position)
    }

    /// Grant early access to users (admin only)
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `admin` - Admin address
    /// * `feature_id` - Feature ID
    /// * `users` - List of users to grant access
    ///
    /// # Returns
    ///
    /// * `Ok(bool)` - True if access granted successfully
    /// * `Err(CommonError)` - If validation fails
    pub fn grant_early_access(
        env: Env,
        admin: Address,
        feature_id: u64,
        users: Vec<Address>,
    ) -> Result<bool, CommonError> {
        Self::require_admin(&env, &admin)?;

        // Get feature
        let mut feature: CreditFeature = env
            .storage()
            .persistent()
            .get(&DataKey::Feature(feature_id))
            .ok_or(CommonError::KeyNotFound)?;

        // Check feature exists and has waitlist
        if feature.waitlist_count == 0 {
            return Err(CommonError::OutOfRange);
        }

        // Update early access list
        let mut early_access: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::EarlyAccessUsers(feature_id))
            .unwrap_or_else(|| Vec::new(&env));

        let mut granted_count = 0u32;

        for user in users.iter() {
            // Check if user is on waitlist
            let mut is_on_waitlist = false;
            for wl_user in waitlist.iter() {
                if wl_user == user {
                    is_on_waitlist = true;
                    break;
                }
            }

            if !is_on_waitlist {
                continue;
            }

            // Add to early access if not already there
            let mut already_granted = false;
            for ea_user in early_access.iter() {
                if ea_user == user {
                    already_granted = true;
                    break;
                }
            }

            if !already_granted {
                early_access.push_back(user.clone());
                granted_count += 1;

                // Update user registration
                if let Some(mut registration) = env.storage().persistent().get::<_, UserRegistration>(
                    &DataKey::UserRegistrations(user.clone())
                ) {
                    registration.access_granted = true;
                    env.storage().persistent().set(
                        &DataKey::UserRegistrations(user.clone()), 
                        &registration
                    );
                }

                // Notify user
                if let Err(_) = Self::notify_user_access_granted(&env, user.clone(), feature_id, &feature.name) {
                    // Continue even if notification fails
                }
            }
        }

        // Store updated early access list
        env.storage().persistent().set(&DataKey::EarlyAccessUsers(feature_id), &early_access);

        // Update feature stats
        feature.access_granted_count += granted_count;
        
        // Update status if early access granted
        if granted_count > 0 && feature.status == FeatureStatus::WaitlistOpen {
            feature.status = FeatureStatus::EarlyAccess;
            feature.early_access_at = Some(env.ledger().timestamp());
        }

        env.storage().persistent().set(&DataKey::Feature(feature_id), &feature);

        // Track access granted
        let mut access_granted: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::AccessGranted(feature_id))
            .unwrap_or_else(|| Vec::new(&env));
        access_granted.push_back(env.ledger().timestamp());
        env.storage().persistent().set(&DataKey::AccessGranted(feature_id), &access_granted);

        // Emit event
        env.events().publish(
            (symbol_short!("cfw_grant"), admin),
            (feature_id, granted_count),
        );

        Ok(true)
    }

    /// Auto-grant early access based on queue position and priority
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `admin` - Admin address
    /// * `feature_id` - Feature ID
    ///
    /// # Returns
    ///
    /// * `Ok(u32)` - Number of users granted access
    /// * `Err(CommonError)` - If validation fails
    pub fn auto_grant_early_access(
        env: Env,
        admin: Address,
        feature_id: u64,
    ) -> Result<u32, CommonError> {
        Self::require_admin(&env, &admin)?;

        // Check if auto-grant is enabled
        let config: WaitlistConfig = env.storage().instance().get(&DataKey::WaitlistConfig).unwrap();
        if !config.auto_grant_enabled {
            return Err(CommonError::NotAuthorized);
        }

        // Get feature
        let feature: CreditFeature = env
            .storage()
            .persistent()
            .get(&DataKey::Feature(feature_id))
            .ok_or(CommonError::KeyNotFound)?;

        // Get waitlist
        let waitlist: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::FeatureWaitlist(feature_id))
            .unwrap_or_else(|| Vec::new(&env));

        // Grant access up to early access slots
        let slots = feature.early_access_slots as u32;
        let mut granted = 0u32;
        let mut users_to_grant: Vec<Address> = Vec::new(&env);

        for user in waitlist.iter() {
            if granted >= slots {
                break;
            }

            // Check if already granted
            let early_access: Vec<Address> = env
                .storage()
                .persistent()
                .get(&DataKey::EarlyAccessUsers(feature_id))
                .unwrap_or_else(|| Vec::new(&env));

            let mut already_granted = false;
            for ea_user in early_access.iter() {
                if ea_user == user {
                    already_granted = true;
                    break;
                }
            }

            if !already_granted {
                users_to_grant.push_back(user.clone());
                granted += 1;
            }
        }

        // Grant access
        if granted > 0 {
            Self::grant_early_access(env.clone(), admin, feature_id, users_to_grant)?;
        }

        Ok(granted)
    }

    /// Launch feature to all waitlisted users
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `admin` - Admin address
    /// * `feature_id` - Feature ID to launch
    ///
    /// # Returns
    ///
    /// * `Ok(bool)` - True if launch successful
    /// * `Err(CommonError)` - If validation fails
    pub fn launch_feature(
        env: Env,
        admin: Address,
        feature_id: u64,
    ) -> Result<bool, CommonError> {
        Self::require_admin(&env, &admin)?;

        // Get feature
        let mut feature: CreditFeature = env
            .storage()
            .persistent()
            .get(&DataKey::Feature(feature_id))
            .ok_or(CommonError::KeyNotFound)?;

        // Update status
        feature.status = FeatureStatus::Launched;
        feature.launched_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&DataKey::Feature(feature_id), &feature);

        // Notify all waitlisted users
        let waitlist: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::FeatureWaitlist(feature_id))
            .unwrap_or_else(|| Vec::new(&env));

        Self::notify_all_users_feature_launched(&env, feature_id, &waitlist, &feature.name)?;

        // Emit event
        env.events().publish(
            (symbol_short!("cfw_launch"), admin),
            (feature_id, feature.name),
        );

        Ok(true)
    }

    /// Get user's waitlist position for a feature
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `user` - User address
    /// * `feature_id` - Feature ID
    ///
    /// # Returns
    ///
    /// * `Option<u32>` - Queue position if registered
    pub fn get_queue_position(env: Env, user: Address, feature_id: u64) -> Option<u32> {
        env.storage().persistent().get(&DataKey::UserQueuePosition(user, feature_id))
    }

    /// Get feature information
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `feature_id` - Feature ID
    ///
    /// # Returns
    ///
    /// * `Option<CreditFeature>` - Feature information if exists
    pub fn get_feature(env: Env, feature_id: u64) -> Option<CreditFeature> {
        env.storage().persistent().get(&DataKey::Feature(feature_id))
    }

    /// Get all waitlisted users for a feature
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `feature_id` - Feature ID
    ///
    /// # Returns
    ///
    /// * `Vec<Address>` - List of waitlisted users
    pub fn get_waitlist_users(env: Env, feature_id: u64) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::FeatureWaitlist(feature_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Get early access users for a feature
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `feature_id` - Feature ID
    ///
    /// # Returns
    ///
    /// * `Vec<Address>` - List of early access users
    pub fn get_early_access_users(env: Env, feature_id: u64) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::EarlyAccessUsers(feature_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Check if user has early access
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `user` - User address
    /// * `feature_id` - Feature ID
    ///
    /// # Returns
    ///
    /// * `bool` - True if user has early access
    pub fn has_early_access(env: Env, user: Address, feature_id: u64) -> bool {
        let early_access: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::EarlyAccessUsers(feature_id))
            .unwrap_or_else(|| Vec::new(&env));

        for ea_user in early_access.iter() {
            if ea_user == user {
                return true;
            }
        }
        false
    }

    /// Get user notifications
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `user` - User address
    ///
    /// # Returns
    ///
    /// * `Vec<Notification>` - User's notifications
    pub fn get_user_notifications(env: Env, user: Address) -> Vec<Notification> {
        let mut notifications = Vec::new(&env);
        let notif_count: u64 = env.storage().instance().get(&DataKey::NotificationCount).unwrap_or(0);

        for i in 0..notif_count {
            if let Some(notif) = env.storage().persistent().get(&DataKey::Notification(i)) {
                let n: Notification = notif;
                if n.recipient == user {
                    notifications.push_back(n);
                }
            }
        }

        notifications
    }

    /// Update notification preferences
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `user` - User address
    /// * `enabled` - Enable notifications
    /// * `notify_on_position_change` - Notify on position change
    /// * `notify_on_access_granted` - Notify on access granted
    pub fn update_notification_prefs(
        env: Env,
        user: Address,
        enabled: bool,
        notify_on_position_change: bool,
        notify_on_access_granted: bool,
    ) -> Result<(), CommonError> {
        user.require_auth();

        let prefs = NotificationPrefs {
            enabled,
            notify_on_position_change,
            notify_on_access_granted,
        };

        env.storage().persistent().set(&DataKey::UserNotificationPrefs(user), &prefs);

        Ok(())
    }

    /// Update waitlist configuration (admin only)
    ///
    /// # Arguments
    ///
    /// * `env` - Soroban environment
    /// * `admin` - Admin address
    /// * `config` - New configuration
    pub fn update_config(
        env: Env,
        admin: Address,
        config: WaitlistConfig,
    ) -> Result<(), CommonError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::WaitlistConfig, &config);
        
        env.events().publish(
            (symbol_short!("cfw_cfg_upd"), admin),
            symbol_short!("updated"),
        );

        Ok(())
    }

    // ========================================================================
    // Internal Helper Functions
    // ========================================================================

    /// Notify user that access has been granted
    fn notify_user_access_granted(
        env: &Env,
        user: Address,
        feature_id: u64,
        feature_name: &Symbol,
    ) -> Result<(), CommonError> {
        // Check notification preferences
        if let Some(prefs) = env.storage().persistent().get::<_, NotificationPrefs>(
            &DataKey::UserNotificationPrefs(user.clone())
        ) {
            if !prefs.enabled || !prefs.notify_on_access_granted {
                return Ok(());
            }
        }

        let mut notif_count: u64 = env.storage().instance().get(&DataKey::NotificationCount).unwrap_or(0);

        let message = String::from_str(
            env,
            format!("You've been granted early access to feature: {:?}", feature_name).as_str()
        );

        let notification = Notification {
            notification_id: notif_count,
            recipient: user,
            notification_type: symbol_short!("access"),
            message,
            created_at: env.ledger().timestamp(),
            read: false,
        };

        env.storage().persistent().set(&DataKey::Notification(notif_count), &notification);
        env.storage().instance().set(&DataKey::NotificationCount, &(notif_count + 1));

        Ok(())
    }

    /// Notify all users that feature has been launched
    fn notify_all_users_feature_launched(
        env: &Env,
        feature_id: u64,
        users: &Vec<Address>,
        feature_name: &Symbol,
    ) -> Result<(), CommonError> {
        let mut notif_count: u64 = env.storage().instance().get(&DataKey::NotificationCount).unwrap_or(0);

        for user in users.iter() {
            // Check notification preferences
            if let Some(prefs) = env.storage().persistent().get::<_, NotificationPrefs>(
                &DataKey::UserNotificationPrefs(user.clone())
            ) {
                if !prefs.enabled {
                    continue;
                }
            }

            let message = String::from_str(
                env,
                format!("Feature {:?} has been launched! You now have full access.", feature_name).as_str()
            );

            let notification = Notification {
                notification_id: notif_count,
                recipient: user.clone(),
                notification_type: symbol_short!("launch"),
                message,
                created_at: env.ledger().timestamp(),
                read: false,
            };

            env.storage().persistent().set(&DataKey::Notification(notif_count), &notification);
            notif_count += 1;
        }

        env.storage().instance().set(&DataKey::NotificationCount, &notif_count);

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
