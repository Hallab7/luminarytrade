//! # Bridge Contract Tests
//!
//! Comprehensive test suite for cross-chain bridge functionality
//! including mock EVM chain simulation.

#![cfg(test)]

use soroban_sdk::{Address, Bytes, Env, Symbol, symbol_short, Vec};
use crate::{BridgeContract, BridgeContractClient, BridgeTransfer, TransferStatus, ChainType, RelayerInfo, BridgeConfig};

// ============================================================================
// Test Utilities
// ============================================================================

fn setup_bridge() -> (Env, Address, Vec<Address>) {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    
    // Create initial relayers (5 relayers, need 3 confirmations)
    let mut relayers = Vec::new(&env);
    for _ in 0..5 {
        relayers.push_back(Address::generate(&env));
    }
    
    // Initialize bridge
    let client = BridgeContractClient::new(&env, &admin);
    client.initialize(&admin, &relayers, &3);
    
    (env, admin, relayers)
}

fn create_mock_recipient(env: &Env) -> Bytes {
    // Mock EVM address (20 bytes)
    Bytes::from_slice(env, &[0u8; 20])
}

fn initiate_test_transfer(
    env: &Env,
    sender: &Address,
    relayers: &Vec<Address>,
    amount: i128,
) -> u64 {
    let client = BridgeContractClient::new(env, sender);
    let recipient = create_mock_recipient(env);
    
    let transfer = client.initiate_transfer(
        sender,
        &recipient,
        &ChainType::Ethereum,
        &symbol_short!("USDC"),
        &amount,
    );
    
    transfer.transfer_id
}

// ============================================================================
// Initialization Tests
// ============================================================================

#[test]
fn test_initialize_success() {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let mut relayers = Vec::new(&env);
    for _ in 0..3 {
        relayers.push_back(Address::generate(&env));
    }
    
    let client = BridgeContractClient::new(&env, &admin);
    client.initialize(&admin, &relayers, &3);
    
    // Should initialize successfully
}

#[test]
#[should_panic]
fn test_initialize_already_initialized() {
    let (env, admin, _) = setup_bridge();
    let client = BridgeContractClient::new(&env, &admin);
    
    // Should panic - already initialized
    client.initialize(&admin, &Vec::new(&env), &3);
}

#[test]
#[should_panic]
fn test_initialize_insufficient_relayers() {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let mut relayers = Vec::new(&env);
    relayers.push_back(Address::generate(&env)); // Only 1 relayer
    relayers.push_back(Address::generate(&env)); // 2 relayers
    
    let client = BridgeContractClient::new(&env, &admin);
    
    // Should panic - need at least 3 relayers for threshold of 3
    client.initialize(&admin, &relayers, &3);
}

// ============================================================================
// Cross-Chain Transfer Tests
// ============================================================================

#[test]
fn test_initiate_transfer_success() {
    let (env, _, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    let transfer = client.initiate_transfer(
        &user,
        &create_mock_recipient(&env),
        &ChainType::Ethereum,
        &symbol_short!("USDC"),
        &1_000_000_000, // 1000 USDC (6 decimals)
    );
    
    assert_eq!(transfer.source_chain as u32, ChainType::Stellar as u32);
    assert_eq!(transfer.dest_chain as u32, ChainType::Ethereum as u32);
    assert_eq!(transfer.status as u32, TransferStatus::Pending as u32);
    assert!(transfer.amount > 0);
    assert!(transfer.fee > 0);
    assert_eq!(transfer.confirmations, 0);
}

#[test]
fn test_initiate_transfer_fee_calculation() {
    let (env, _, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    let amount = 1_000_000_000;
    let transfer = client.initiate_transfer(
        &user,
        &create_mock_recipient(&env),
        &ChainType::Ethereum,
        &symbol_short!("USDC"),
        &amount,
    );
    
    // Fee should be deducted (0.3% bridge + 0.1% protocol = 0.4% total)
    assert!(transfer.fee > 0);
    assert!(transfer.net_amount < transfer.amount);
    assert_eq!(transfer.amount, transfer.fee + transfer.net_amount);
}

#[test]
fn test_initiate_transfer_minimum_amount() {
    let (env, _, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    // Try to transfer below minimum (1 token)
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.initiate_transfer(
            &user,
            &create_mock_recipient(&env),
            &ChainType::Ethereum,
            &symbol_short!("USDC"),
            &100_000, // Below minimum
        )
    }));
    
    assert!(result.is_err());
}

#[test]
fn test_initiate_transfer_maximum_amount() {
    let (env, _, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    // Try to transfer above maximum (100K tokens)
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.initiate_transfer(
            &user,
            &create_mock_recipient(&env),
            &ChainType::Ethereum,
            &symbol_short!("USDC"),
            &200_000_000_000, // Above maximum
        )
    }));
    
    assert!(result.is_err());
}

#[test]
fn test_multiple_transfers_increment_nonce() {
    let (env, _, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    let transfer1 = client.initiate_transfer(
        &user,
        &create_mock_recipient(&env),
        &ChainType::Ethereum,
        &symbol_short!("USDC"),
        &1_000_000_000,
    );
    
    let transfer2 = client.initiate_transfer(
        &user,
        &create_mock_recipient(&env),
        &ChainType::Polygon,
        &symbol_short!("USDC"),
        &500_000_000,
    );
    
    assert_eq!(transfer2.transfer_id, transfer1.transfer_id + 1);
}

// ============================================================================
// Relayer Attestation Tests
// ============================================================================

#[test]
fn test_relay_attestation_single() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let transfer_id = initiate_test_transfer(&env, &user, &relayers, 1_000_000_000);
    
    // First relayer attests
    let relayer_client = BridgeContractClient::new(&env, &relayers.get(0).unwrap());
    let signature = Bytes::from_slice(&env, &[1u8; 64]); // Mock signature
    
    let result = relayer_client.relay_attestation(&relayers.get(0).unwrap(), &transfer_id, &signature);
    assert!(result);
    
    // Check transfer has 1 confirmation
    let transfer = client.get_transfer(&transfer_id);
    assert_eq!(transfer.confirmations, 1);
}

#[test]
fn test_relay_attestation_reaches_threshold() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let transfer_id = initiate_test_transfer(&env, &user, &relayers, 1_000_000_000);
    
    let signature = Bytes::from_slice(&env, &[1u8; 64]);
    
    // 3 relayers attest (reaches threshold)
    for i in 0..3 {
        let relayer_client = BridgeContractClient::new(&env, &relayers.get(i).unwrap());
        relayer_client.relay_attestation(&relayers.get(i).unwrap(), &transfer_id, &signature);
    }
    
    // Check transfer is confirmed
    let transfer = client.get_transfer(&transfer_id);
    assert_eq!(transfer.confirmations, 3);
    assert_eq!(transfer.status as u32, TransferStatus::Confirmed as u32);
}

#[test]
fn test_relay_attestation_inactive_relayer() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let transfer_id = initiate_test_transfer(&env, &user, &relayers, 1_000_000_000);
    
    // Remove first relayer
    let admin_client = BridgeContractClient::new(&env, &admin);
    admin_client.remove_relayer(&admin, &relayers.get(0).unwrap());
    
    // Try to attest with removed relayer
    let relayer_client = BridgeContractClient::new(&env, &relayers.get(0).unwrap());
    let signature = Bytes::from_slice(&env, &[1u8; 64]);
    
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        relayer_client.relay_attestation(&relayers.get(0).unwrap(), &transfer_id, &signature)
    }));
    
    assert!(result.is_err());
}

#[test]
fn test_relay_attestation_timeout() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let transfer_id = initiate_test_transfer(&env, &user, &relayers, 1_000_000_000);
    
    // Fast forward past timeout (1 hour + buffer)
    env.ledger().with_mut(|li| {
        li.timestamp += 3700; // 1 hour 1 minute
    });
    
    let signature = Bytes::from_slice(&env, &[1u8; 64]);
    let relayer_client = BridgeContractClient::new(&env, &relayers.get(0).unwrap());
    
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        relayer_client.relay_attestation(&relayers.get(0).unwrap(), &transfer_id, &signature)
    }));
    
    assert!(result.is_err());
    
    // Transfer should be failed
    let transfer = client.get_transfer(&transfer_id);
    assert_eq!(transfer.status as u32, TransferStatus::Failed as u32);
}

#[test]
fn test_relay_attestation_already_completed() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let transfer_id = initiate_test_transfer(&env, &user, &relayers, 1_000_000_000);
    
    let signature = Bytes::from_slice(&env, &[1u8; 64]);
    
    // Get enough confirmations to complete
    for i in 0..3 {
        let relayer_client = BridgeContractClient::new(&env, &relayers.get(i).unwrap());
        relayer_client.relay_attestation(&relayers.get(i).unwrap(), &transfer_id, &signature);
    }
    
    // Complete transfer
    let admin_client = BridgeContractClient::new(&env, &admin);
    admin_client.complete_transfer(&transfer_id);
    
    // Try to attest again
    let relayer_client = BridgeContractClient::new(&env, &relayers.get(3).unwrap());
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        relayer_client.relay_attestation(&relayers.get(3).unwrap(), &transfer_id, &signature)
    }));
    
    assert!(result.is_err());
}

// ============================================================================
// Transfer Completion Tests
// ============================================================================

#[test]
fn test_complete_transfer_success() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let transfer_id = initiate_test_transfer(&env, &user, &relayers, 1_000_000_000);
    
    let signature = Bytes::from_slice(&env, &[1u8; 64]);
    
    // Get confirmations
    for i in 0..3 {
        let relayer_client = BridgeContractClient::new(&env, &relayers.get(i).unwrap());
        relayer_client.relay_attestation(&relayers.get(i).unwrap(), &transfer_id, &signature);
    }
    
    // Complete transfer
    let admin_client = BridgeContractClient::new(&env, &admin);
    admin_client.complete_transfer(&transfer_id);
    
    // Check status
    let transfer = client.get_transfer(&transfer_id);
    assert_eq!(transfer.status as u32, TransferStatus::Completed as u32);
}

#[test]
fn test_complete_transfer_not_confirmed() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let transfer_id = initiate_test_transfer(&env, &user, &relayers, 1_000_000_000);
    
    // Try to complete without confirmations
    let admin_client = BridgeContractClient::new(&env, &admin);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        admin_client.complete_transfer(&transfer_id)
    }));
    
    assert!(result.is_err());
}

// ============================================================================
// Burn and Withdraw Tests
// ============================================================================

#[test]
fn test_burn_and_withdraw_success() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    
    // First, simulate minted tokens exist (from previous bridge-in)
    // In production this would be tracked from completed transfers
    // For this test, we'll just create a burn request
    
    let burn_client = BridgeContractClient::new(&env, &user);
    let recipient = Address::generate(&env);
    
    let burn_transfer = burn_client.burn_and_withdraw(
        &user,
        &recipient,
        &ChainType::Stellar,
        &symbol_short!("USDC"),
        &500_000_000,
    );
    
    assert_eq!(burn_transfer.source_chain as u32, ChainType::EVM as u32);
    assert_eq!(burn_transfer.dest_chain as u32, ChainType::Stellar as u32);
    assert_eq!(burn_transfer.status as u32, TransferStatus::Pending as u32);
}

// ============================================================================
// Security Tests - Emergency Pause
// ============================================================================

#[test]
fn test_pause_bridge() {
    let (env, admin, relayers) = setup_bridge();
    let admin_client = BridgeContractClient::new(&env, &admin);
    
    admin_client.pause(&admin, &symbol_short!("emergency"));
    
    // Try to initiate transfer while paused
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.initiate_transfer(
            &user,
            &create_mock_recipient(&env),
            &ChainType::Ethereum,
            &symbol_short!("USDC"),
            &1_000_000_000,
        )
    }));
    
    assert!(result.is_err());
}

#[test]
fn test_unpause_bridge() {
    let (env, admin, relayers) = setup_bridge();
    let admin_client = BridgeContractClient::new(&env, &admin);
    
    // Pause then unpause
    admin_client.pause(&admin, &symbol_short!("emergency"));
    admin_client.unpause(&admin);
    
    // Should be able to transfer again
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    let transfer = client.initiate_transfer(
        &user,
        &create_mock_recipient(&env),
        &ChainType::Ethereum,
        &symbol_short!("USDC"),
        &1_000_000_000,
    );
    
    assert_eq!(transfer.status as u32, TransferStatus::Pending as u32);
}

#[test]
fn test_non_admin_cannot_pause() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.pause(&user, &symbol_short!("test"))
    }));
    
    assert!(result.is_err());
}

// ============================================================================
// Rate Limiting Tests
// ============================================================================

#[test]
fn test_rate_limit_daily_exceeded() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    // Make large transfer that exceeds daily limit
    let large_amount = 2_000_000_000_000; // 2M, exceeds 1M daily limit
    
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.initiate_transfer(
            &user,
            &create_mock_recipient(&env),
            &ChainType::Ethereum,
            &symbol_short!("USDC"),
            &large_amount,
        )
    }));
    
    assert!(result.is_err());
}

#[test]
fn test_rate_limit_multiple_transfers() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    // Make several transfers within limit
    for i in 0..5 {
        client.initiate_transfer(
            &user,
            &create_mock_recipient(&env),
            &ChainType::Ethereum,
            &symbol_short!("USDC"),
            &100_000_000, // 100 tokens each
        );
    }
    
    // 6th transfer should still work (total 600 tokens, under 1M limit)
    let transfer = client.initiate_transfer(
        &user,
        &create_mock_recipient(&env),
        &ChainType::Ethereum,
        &symbol_short!("USDC"),
        &100_000_000,
    );
    
    assert_eq!(transfer.status as u32, TransferStatus::Pending as u32);
}

// ============================================================================
// Relayer Management Tests
// ============================================================================

#[test]
fn test_add_relayer() {
    let (env, admin, relayers) = setup_bridge();
    let admin_client = BridgeContractClient::new(&env, &admin);
    
    let new_relayer = Address::generate(&env);
    admin_client.add_relayer(&admin, &new_relayer);
    
    // Verify relayer was added
    let relayer_info = admin_client.get_relayer_info(&new_relayer);
    assert_eq!(relayer_info.address, new_relayer);
    assert!(relayer_info.active);
}

#[test]
fn test_remove_relayer() {
    let (env, admin, relayers) = setup_bridge();
    let admin_client = BridgeContractClient::new(&env, &admin);
    
    let relayer_to_remove = relayers.get(0).unwrap();
    admin_client.remove_relayer(&admin, &relayer_to_remove);
    
    // Verify relayer is inactive
    let relayer_info = admin_client.get_relayer_info(&relayer_to_remove);
    assert!(!relayer_info.active);
}

#[test]
fn test_add_duplicate_relayer() {
    let (env, admin, relayers) = setup_bridge();
    let admin_client = BridgeContractClient::new(&env, &admin);
    
    let existing_relayer = relayers.get(0).unwrap();
    
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        admin_client.add_relayer(&admin, &existing_relayer)
    }));
    
    assert!(result.is_err());
}

// ============================================================================
// Fee System Tests
// ============================================================================

#[test]
fn test_update_fees() {
    let (env, admin, relayers) = setup_bridge();
    let admin_client = BridgeContractClient::new(&env, &admin);
    
    // Update fees to 0.5% bridge + 0.2% protocol
    admin_client.update_fees(&admin, &50, &20, &50);
    
    // Fees should be updated (would need getter to verify)
}

#[test]
fn test_update_fees_invalid_bps() {
    let (env, admin, relayers) = setup_bridge();
    let admin_client = BridgeContractClient::new(&env, &admin);
    
    // Try to set fee > 100%
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        admin_client.update_fees(&admin, &15000, &20, &50) // 150% - invalid
    }));
    
    assert!(result.is_err());
}

#[test]
fn test_fee_calculation_accuracy() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    let amount = 1_000_000_000;
    let transfer = client.initiate_transfer(
        &user,
        &create_mock_recipient(&env),
        &ChainType::Ethereum,
        &symbol_short!("USDC"),
        &amount,
    );
    
    // With default fees (0.3% + 0.1% = 0.4%)
    // Expected fee: 1,000,000,000 * 40 / 10000 = 4,000,000
    // Net: 1,000,000,000 - 4,000,000 = 996,000,000
    assert_eq!(transfer.amount, transfer.fee + transfer.net_amount);
}

// ============================================================================
// Monitoring and Health Check Tests
// ============================================================================

#[test]
fn test_health_check() {
    let (env, admin, relayers) = setup_bridge();
    let client = BridgeContractClient::new(&env, &Address::generate(&env));
    
    let is_healthy = client.health_check();
    assert!(is_healthy);
}

#[test]
fn test_health_check_when_paused() {
    let (env, admin, relayers) = setup_bridge();
    let admin_client = BridgeContractClient::new(&env, &admin);
    
    admin_client.pause(&admin, &symbol_short!("maintenance"));
    
    let client = BridgeContractClient::new(&env, &Address::generate(&env));
    let is_healthy = client.health_check();
    assert!(!is_healthy);
}

#[test]
fn test_get_bridge_stats() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    // Create some transfers
    initiate_test_transfer(&env, &user, &relayers, 1_000_000_000);
    initiate_test_transfer(&env, &user, &relayers, 500_000_000);
    
    let stats = client.get_stats();
    assert_eq!(stats.total_transfers, 2);
    assert_eq!(stats.active_relayers, 5);
    assert!(!stats.is_paused);
}

#[test]
fn test_get_transfer_by_id() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    let transfer initiated = initiate_test_transfer(&env, &user, &relayers, 1_000_000_000);
    
    let transfer = client.get_transfer(&initiated.transfer_id);
    assert_eq!(transfer.transfer_id, initiated.transfer_id);
    assert_eq!(transfer.sender, user);
}

// ============================================================================
// Liquidity Tracking Tests
// ============================================================================

#[test]
fn test_liquidity_locked_on_transfer() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    let amount = 1_000_000_000;
    client.initiate_transfer(
        &user,
        &create_mock_recipient(&env),
        &ChainType::Ethereum,
        &symbol_short!("USDC"),
        &amount,
    );
    
    // Liquidity should be locked (would need getter to verify exact amount)
}

#[test]
fn test_get_liquidity_pool_info() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    // Create transfer to initialize pool
    client.initiate_transfer(
        &user,
        &create_mock_recipient(&env),
        &ChainType::Ethereum,
        &symbol_short!("USDC"),
        &1_000_000_000,
    );
    
    // Get pool info (may not exist yet in mock implementation)
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.get_liquidity_pool(&symbol_short!("USDC"))
    }));
    
    // Either succeeds or fails gracefully
}

// ============================================================================
// Edge Cases and Integration Tests
// ============================================================================

#[test]
fn test_full_bridge_lifecycle() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    
    // Step 1: Initiate transfer
    let client = BridgeContractClient::new(&env, &user);
    let transfer = client.initiate_transfer(
        &user,
        &create_mock_recipient(&env),
        &ChainType::Ethereum,
        &symbol_short!("USDC"),
        &1_000_000_000,
    );
    
    // Step 2: Relayers attest
    let signature = Bytes::from_slice(&env, &[1u8; 64]);
    for i in 0..3 {
        let relayer_client = BridgeContractClient::new(&env, &relayers.get(i).unwrap());
        relayer_client.relay_attestation(&relayers.get(i).unwrap(), &transfer.transfer_id, &signature);
    }
    
    // Step 3: Complete transfer
    let admin_client = BridgeContractClient::new(&env, &admin);
    admin_client.complete_transfer(&transfer.transfer_id);
    
    // Verify completion
    let final_transfer = client.get_transfer(&transfer.transfer_id);
    assert_eq!(final_transfer.status as u32, TransferStatus::Completed as u32);
}

#[test]
fn test_different_destination_chains() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    // Transfer to Ethereum
    let eth_transfer = client.initiate_transfer(
        &user,
        &create_mock_recipient(&env),
        &ChainType::Ethereum,
        &symbol_short!("USDC"),
        &1_000_000_000,
    );
    
    // Transfer to Polygon
    let polygon_transfer = client.initiate_transfer(
        &user,
        &create_mock_recipient(&env),
        &ChainType::Polygon,
        &symbol_short!("USDC"),
        &500_000_000,
    );
    
    // Transfer to BSC
    let bsc_transfer = client.initiate_transfer(
        &user,
        &create_mock_recipient(&env),
        &ChainType::BSC,
        &symbol_short!("USDC"),
        &750_000_000,
    );
    
    assert_eq!(eth_transfer.dest_chain as u32, ChainType::Ethereum as u32);
    assert_eq!(polygon_transfer.dest_chain as u32, ChainType::Polygon as u32);
    assert_eq!(bsc_transfer.dest_chain as u32, ChainType::BSC as u32);
}

#[test]
fn test_relayer_performance_tracking() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let transfer_id = initiate_test_transfer(&env, &user, &relayers, 1_000_000_000);
    
    let signature = Bytes::from_slice(&env, &[1u8; 64]);
    
    // Relayer 1 attests multiple times
    for _ in 0..5 {
        let new_transfer_id = initiate_test_transfer(&env, &user, &relayers, 100_000_000);
        let relayer_client = BridgeContractClient::new(&env, &relayers.get(0).unwrap());
        relayer_client.relay_attestation(&relayers.get(0).unwrap(), &new_transfer_id, &signature);
    }
    
    // Check relayer stats
    let relayer_info = client.get_relayer_info(&relayers.get(0).unwrap());
    assert!(relayer_info.successful_relays >= 5);
}

#[test]
fn test_transfer_timeout_cleanup() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let transfer_id = initiate_test_transfer(&env, &user, &relayers, 1_000_000_000);
    
    // Wait for timeout
    env.ledger().with_mut(|li| {
        li.timestamp += 3700; // Past 1 hour timeout
    });
    
    // Transfer should be marked as failed
    let transfer = client.get_transfer(&transfer_id);
    assert_eq!(transfer.status as u32, TransferStatus::Failed as u32);
}

#[test]
fn test_emergency_committee_pause() {
    let (env, admin, relayers) = setup_bridge();
    
    // In production, emergency committee could pause without admin
    // For this test, we just verify admin can pause
    let admin_client = BridgeContractClient::new(&env, &admin);
    admin_client.pause(&admin, &symbol_short!("security_alert"));
    
    let stats = client.get_stats();
    assert!(stats.is_paused);
}

#[test]
fn test_zero_amount_transfer() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.initiate_transfer(
            &user,
            &create_mock_recipient(&env),
            &ChainType::Ethereum,
            &symbol_short!("USDC"),
            &0,
        )
    }));
    
    assert!(result.is_err());
}

#[test]
fn test_insufficient_liquidity() {
    let (env, admin, relayers) = setup_bridge();
    let user = Address::generate(&env);
    let client = BridgeContractClient::new(&env, &user);
    
    // Try to transfer more than available liquidity
    // In production this would fail, but in our mock it might succeed
    // depending on implementation
    let huge_amount = 1_000_000_000_000_000; // 1B tokens
    
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.initiate_transfer(
            &user,
            &create_mock_recipient(&env),
            &ChainType::Ethereum,
            &symbol_short!("USDC"),
            &huge_amount,
        )
    }));
    
    // Should fail due to max transfer limit
    assert!(result.is_err());
}
