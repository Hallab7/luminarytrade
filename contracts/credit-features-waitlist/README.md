# Credit Features Waitlist Contract

A waitlist management system for advanced credit features with early access capabilities on Stellar/Soroban.

## Overview

This contract enables controlled rollout of credit-related features through a queue-based waitlist system. Users can join waitlists, receive priority based on credit scores, and get early access to new features before full launch.

## Features

- **Queue Management**: Ordered waitlist with position tracking
- **Priority System**: Credit score-based priority for faster access
- **Early Access**: Controlled rollout with configurable slot limits
- **Auto-Grant**: Automatic early access based on queue position
- **Notification System**: Status updates for waitlist position and access grants
- **Feature Lifecycle**: Development → Waitlist → Early Access → Full Launch

## Contract Functions

### Initialization
- `initialize(admin, default_early_access_slots)` - Initialize the contract

### Feature Management
- `add_feature(creator, name, description, early_access_slots)` - Add new credit feature
- `launch_feature(admin, feature_id)` - Launch feature to all waitlisted users

### Waitlist Management
- `join_waitlist(user, feature_id, credit_score)` - Join waitlist for a feature
- `grant_early_access(admin, feature_id, users)` - Grant early access to specific users
- `auto_grant_early_access(admin, feature_id)` - Auto-grant based on queue position

### Query Functions
- `get_feature(feature_id)` - Get feature information
- `get_waitlist_users(feature_id)` - Get all waitlisted users
- `get_early_access_users(feature_id)` - Get early access users
- `get_queue_position(user, feature_id)` - Get user's queue position
- `has_early_access(user, feature_id)` - Check if user has early access

### Notifications
- `update_notification_prefs(user, enabled, notify_on_position_change, notify_on_access_granted)` - Update preferences
- `get_user_notifications(user)` - Get user's notifications

### Configuration
- `update_config(admin, config)` - Update waitlist configuration

## Data Structures

### CreditFeature
```rust
pub struct CreditFeature {
    pub feature_id: u64,
    pub name: Symbol,
    pub description: String,
    pub status: FeatureStatus,
    pub waitlist_count: u32,
    pub early_access_slots: u32,
    pub access_granted_count: u32,
    pub created_at: u64,
    pub early_access_at: Option<u64>,
    pub launched_at: Option<u64>,
    pub created_by: Address,
}
```

### FeatureStatus
- `Development` - Feature in development
- `WaitlistOpen` - Accepting waitlist registrations
- `EarlyAccess` - Early access phase active
- `Launched` - Fully launched to all users
- `Paused` - Temporarily paused

### UserRegistration
```rust
pub struct UserRegistration {
    pub user: Address,
    pub registered_at: u64,
    pub credit_score: Option<u32>,
    pub priority: u32,
    pub access_granted: bool,
    pub feature_ids: Vec<u64>,
}
```

## Usage Example

```rust
// Initialize contract
client.initialize(&admin, &100);

// Add new credit feature
let feature_id = client.add_feature(
    &creator, 
    &Symbol::new(&env, "ADVANCED_CREDIT"), 
    &String::from_str(&env, "Advanced credit scoring"), 
    &50
);

// Users join waitlist
let position1 = client.join_waitlist(&user1, &feature_id, &Some(750)); // Credit score 750
let position2 = client.join_waitlist(&user2, &feature_id, &None);

// Grant early access to specific users
let mut users = Vec::new(&env);
users.push_back(user1.clone());
users.push_back(user2.clone());
client.grant_early_access(&admin, &feature_id, &users);

// Or auto-grant based on queue position
client.auto_grant_early_access(&admin, &feature_id);

// Launch feature to all waitlisted users
client.launch_feature(&admin, &feature_id);
```

## Events

- `cfw_init` - Contract initialized
- `cfw_add` - New feature added
- `cfw_join` - User joined waitlist
- `cfw_grant` - Early access granted
- `cfw_launch` - Feature launched
- `cfw_cfg_upd` - Configuration updated

## Priority System

Users with higher credit scores receive higher priority in the waitlist:
- Credit score is divided by 10 to calculate priority level
- Higher priority users can be granted access first
- Priority is considered during auto-grant operations

## Security Considerations

- Authentication required for all state-changing operations
- One registration per user per feature
- Admin controls for feature management and access grants
- Configurable limits prevent abuse

## Testing

Run tests with:
```bash
cargo test
```

## Deployment

Build the contract:
```bash
soroban contract build
```

Deploy to testnet:
```bash
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/credit_features_waitlist.wasm
```
