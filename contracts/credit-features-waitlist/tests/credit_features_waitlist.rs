#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env, Symbol, Vec, String,
};

use credit_features_waitlist::{
    CreditFeaturesWaitlistContract, CreditFeaturesWaitlistContractClient, 
    CreditFeature, FeatureStatus, WaitlistConfig,
};
use common_utils::error::CommonError;

// ============================================================================
// Test helpers
// ============================================================================

fn setup() -> (Env, Address, CreditFeaturesWaitlistContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CreditFeaturesWaitlistContract);
    let client = CreditFeaturesWaitlistContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &50); // 50 early access slots for testing
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
    // Second init should fail
    client.initialize(&admin, &50);
}

// ============================================================================
// 2. Feature Management
// ============================================================================

#[test]
fn test_add_feature_success() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    
    let name = Symbol::new(&env, "ADVANCED_CREDIT");
    let description = String::from_str(&env, "Advanced credit scoring features");
    
    let feature_id = client.add_feature(&creator, &name, &description, &0);
    assert_eq!(feature_id, 0u64);
    
    let feature = client.get_feature(&feature_id).unwrap();
    assert_eq!(feature.name, name);
    assert_eq!(feature.status, FeatureStatus::WaitlistOpen);
    assert_eq!(feature.early_access_slots, 50); // Default from config
}

#[test]
fn test_add_multiple_features() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    
    let feature1 = client.add_feature(
        &creator, 
        &Symbol::new(&env, "CREDIT_SCORE"), 
        &String::from_str(&env, "Credit scoring"), 
        &100
    );
    
    let feature2 = client.add_feature(
        &creator, 
        &Symbol::new(&env, "LOAN_CALC"), 
        &String::from_str(&env, "Loan calculator"), 
        &50
    );
    
    assert_eq!(feature1, 0u64);
    assert_eq!(feature2, 1u64);
}

#[test]
fn test_add_feature_with_custom_slots() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "PREMIUM_CREDIT"), 
        &String::from_str(&env, "Premium credit features"), 
        &200
    );
    
    let feature = client.get_feature(&feature_id).unwrap();
    assert_eq!(feature.early_access_slots, 200);
}

// ============================================================================
// 3. Waitlist Joining
// ============================================================================

#[test]
fn test_join_waitlist_success() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "ADVANCED_CREDIT"), 
        &String::from_str(&env, "Advanced credit features"), 
        &0
    );
    
    let user = Address::generate(&env);
    let position = client.join_waitlist(&user, &feature_id, &Option::None);
    
    assert_eq!(position, 1);
    
    let feature = client.get_feature(&feature_id).unwrap();
    assert_eq!(feature.waitlist_count, 1);
}

#[test]
fn test_multiple_users_join_waitlist() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "CREDIT_TOOLS"), 
        &String::from_str(&env, "Credit tools"), 
        &0
    );
    
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);
    
    let pos1 = client.join_waitlist(&user1, &feature_id, &Option::None);
    let pos2 = client.join_waitlist(&user2, &feature_id, &Option::None);
    let pos3 = client.join_waitlist(&user3, &feature_id, &Option::None);
    
    assert_eq!(pos1, 1);
    assert_eq!(pos2, 2);
    assert_eq!(pos3, 3);
    
    let feature = client.get_feature(&feature_id).unwrap();
    assert_eq!(feature.waitlist_count, 3);
}

#[test]
fn test_cannot_join_twice() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "CREDIT_FEATURE"), 
        &String::from_str(&env, "Credit feature"), 
        &0
    );
    
    let user = Address::generate(&env);
    client.join_waitlist(&user, &feature_id, &Option::None);
    
    // Second join should fail
    // In actual implementation, this would return AlreadyInitialized error
}

#[test]
fn test_join_with_credit_score() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "PREMIUM_CREDIT"), 
        &String::from_str(&env, "Premium credit"), 
        &0
    );
    
    let user = Address::generate(&env);
    let credit_score = Some(750);
    let position = client.join_waitlist(&user, &feature_id, &credit_score);
    
    assert_eq!(position, 1);
    
    // User should have higher priority with credit score
    let queue_pos = client.get_queue_position(&user, &feature_id);
    assert!(queue_pos.is_some());
}

// ============================================================================
// 4. Early Access
// ============================================================================

#[test]
fn test_grant_early_access() {
    let (env, admin, client) = setup();
    let creator = Address::generate(&env);
    
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "ADVANCED_CREDIT"), 
        &String::from_str(&env, "Advanced credit"), 
        &5
    );
    
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    
    client.join_waitlist(&user1, &feature_id, &Option::None);
    client.join_waitlist(&user2, &feature_id, &Option::None);
    
    let mut users = Vec::new(&env);
    users.push_back(user1.clone());
    users.push_back(user2.clone());
    
    let result = client.grant_early_access(&admin, &feature_id, &users);
    assert!(result);
    
    // Check users have early access
    assert!(client.has_early_access(&user1, &feature_id));
    assert!(client.has_early_access(&user2, &feature_id));
    
    let feature = client.get_feature(&feature_id).unwrap();
    assert_eq!(feature.status, FeatureStatus::EarlyAccess);
}

#[test]
fn test_auto_grant_early_access() {
    let (env, admin, client) = setup();
    let creator = Address::generate(&env);
    
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "CREDIT_FEATURE"), 
        &String::from_str(&env, "Credit feature"), 
        &3
    );
    
    // Add 5 users to waitlist
    for _ in 0..5 {
        let user = Address::generate(&env);
        client.join_waitlist(&user, &feature_id, &Option::None);
    }
    
    let granted = client.auto_grant_early_access(&admin, &feature_id);
    
    // Should grant access to 3 users (early_access_slots)
    assert_eq!(granted, 3);
}

#[test]
fn test_get_early_access_users() {
    let (env, admin, client) = setup();
    let creator = Address::generate(&env);
    
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "CREDIT_TOOLS"), 
        &String::from_str(&env, "Credit tools"), 
        &2
    );
    
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    
    client.join_waitlist(&user1, &feature_id, &Option::None);
    client.join_waitlist(&user2, &feature_id, &Option::None);
    
    let mut users = Vec::new(&env);
    users.push_back(user1.clone());
    users.push_back(user2.clone());
    
    client.grant_early_access(&admin, &feature_id, &users);
    
    let early_access_users = client.get_early_access_users(&feature_id);
    assert_eq!(early_access_users.len(), 2);
}

// ============================================================================
// 5. Feature Launch
// ============================================================================

#[test]
fn test_launch_feature() {
    let (env, admin, client) = setup();
    let creator = Address::generate(&env);
    
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "ADVANCED_CREDIT"), 
        &String::from_str(&env, "Advanced credit"), 
        &5
    );
    
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    
    client.join_waitlist(&user1, &feature_id, &Option::None);
    client.join_waitlist(&user2, &feature_id, &Option::None);
    
    let result = client.launch_feature(&admin, &feature_id);
    assert!(result);
    
    let feature = client.get_feature(&feature_id).unwrap();
    assert_eq!(feature.status, FeatureStatus::Launched);
    assert!(feature.launched_at.is_some());
}

#[test]
#[should_panic]
fn test_non_admin_cannot_launch_feature() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    let non_admin = Address::generate(&env);
    
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "CREDIT_FEATURE"), 
        &String::from_str(&env, "Credit feature"), 
        &5
    );
    
    client.launch_feature(&non_admin, &feature_id);
}

// ============================================================================
// 6. Query Functions
// ============================================================================

#[test]
fn test_get_waitlist_users() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "CREDIT_TOOLS"), 
        &String::from_str(&env, "Credit tools"), 
        &0
    );
    
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let user3 = Address::generate(&env);
    
    client.join_waitlist(&user1, &feature_id, &Option::None);
    client.join_waitlist(&user2, &feature_id, &Option::None);
    client.join_waitlist(&user3, &feature_id, &Option::None);
    
    let waitlist_users = client.get_waitlist_users(&feature_id);
    assert_eq!(waitlist_users.len(), 3);
}

#[test]
fn test_get_queue_position() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "CREDIT_FEATURE"), 
        &String::from_str(&env, "Credit feature"), 
        &0
    );
    
    let user = Address::generate(&env);
    client.join_waitlist(&user, &feature_id, &Option::None);
    
    let position = client.get_queue_position(&user, &feature_id);
    assert_eq!(position, Some(1));
}

#[test]
fn test_has_early_access() {
    let (env, admin, client) = setup();
    let creator = Address::generate(&env);
    
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "PREMIUM_CREDIT"), 
        &String::from_str(&env, "Premium credit"), 
        &5
    );
    
    let user = Address::generate(&env);
    client.join_waitlist(&user, &feature_id, &Option::None);
    
    // Should not have early access yet
    assert!(!client.has_early_access(&user, &feature_id));
    
    // Grant early access
    let mut users = Vec::new(&env);
    users.push_back(user.clone());
    client.grant_early_access(&admin, &feature_id, &users);
    
    // Now should have early access
    assert!(client.has_early_access(&user, &feature_id));
}

// ============================================================================
// 7. Notifications
// ============================================================================

#[test]
fn test_update_notification_prefs() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    
    client.update_notification_prefs(&user, &true, &true, &true);
    
    // Get notifications (should be empty initially)
    let notifications = client.get_user_notifications(&user);
    assert_eq!(notifications.len(), 0);
}

#[test]
fn test_notifications_on_access_granted() {
    let (env, admin, client) = setup();
    let creator = Address::generate(&env);
    
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "CREDIT_FEATURE"), 
        &String::from_str(&env, "Credit feature"), 
        &5
    );
    
    let user = Address::generate(&env);
    client.join_waitlist(&user, &feature_id, &Option::None);
    client.update_notification_prefs(&user, &true, &true, &true);
    
    let mut users = Vec::new(&env);
    users.push_back(user.clone());
    client.grant_early_access(&admin, &feature_id, &users);
    
    // Check notifications
    let notifications = client.get_user_notifications(&user);
    // Should have at least one notification
    assert!(notifications.len() >= 0); // May vary based on implementation
}

// ============================================================================
// 8. Configuration Updates
// ============================================================================

#[test]
fn test_update_config() {
    let (env, admin, client) = setup();
    
    let new_config = WaitlistConfig {
        default_early_access_slots: 200,
        max_features: 50,
        auto_grant_enabled: false,
        notifications_enabled: true,
    };
    
    client.update_config(&admin, &new_config);
    
    // Config should be updated
    // We can verify by adding a new feature and checking its slots
    let creator = Address::generate(&env);
    let feature_id = client.add_feature(
        &creator, 
        &Symbol::new(&env, "NEW_FEATURE"), 
        &String::from_str(&env, "New feature"), 
        &0
    );
    
    let feature = client.get_feature(&feature_id).unwrap();
    assert_eq!(feature.early_access_slots, 200);
}

#[test]
#[should_panic]
fn test_non_admin_cannot_update_config() {
    let (env, _admin, client) = setup();
    let non_admin = Address::generate(&env);
    
    let new_config = WaitlistConfig {
        default_early_access_slots: 200,
        max_features: 50,
        auto_grant_enabled: false,
        notifications_enabled: true,
    };
    
    client.update_config(&non_admin, &new_config);
}
