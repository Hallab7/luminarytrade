//! # Delegation Module
//!
//! Handles vote delegation including transitive delegation (A → B → C)
//! and revocation. Delegation is tracked per-delegator and is revocable
//! at any time before the vote is cast.

use soroban_sdk::{contracttype, Address, Env, Vec};

// ============================================================================
// Storage Keys
// ============================================================================

#[contracttype]
pub enum DelegationKey {
    /// Who `delegator` has delegated to
    DelegateTo(Address),
    /// List of addresses that have delegated to `delegate`
    DelegatedFrom(Address),
}

// ============================================================================
// Public API
// ============================================================================

/// Delegate voting power from `delegator` to `delegate`.
/// Overwrites any existing delegation for `delegator`.
/// Prevents self-delegation and circular delegation up to MAX_DEPTH hops.
pub fn delegate(env: &Env, delegator: &Address, delegate: &Address) -> Result<(), DelegationError> {
    if delegator == delegate {
        return Err(DelegationError::SelfDelegation);
    }

    // Detect cycles: walk the chain from `delegate` forward
    if would_create_cycle(env, delegator, delegate) {
        return Err(DelegationError::CircularDelegation);
    }

    // Remove delegator from previous delegate's incoming list (if any)
    if let Some(old_delegate) = get_delegate(env, delegator) {
        remove_from_incoming(env, &old_delegate, delegator);
    }

    // Store new delegation
    env.storage()
        .persistent()
        .set(&DelegationKey::DelegateTo(delegator.clone()), delegate);

    // Add delegator to new delegate's incoming list
    let mut incoming: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DelegationKey::DelegatedFrom(delegate.clone()))
        .unwrap_or_else(|| Vec::new(env));
    if !incoming.contains(delegator) {
        incoming.push_back(delegator.clone());
    }
    env.storage()
        .persistent()
        .set(&DelegationKey::DelegatedFrom(delegate.clone()), &incoming);

    Ok(())
}

/// Revoke the delegation from `delegator`.
pub fn revoke(env: &Env, delegator: &Address) -> Result<(), DelegationError> {
    let delegate = get_delegate(env, delegator).ok_or(DelegationError::NoDelegation)?;

    // Remove from delegate's incoming list
    remove_from_incoming(env, &delegate, delegator);

    // Remove the delegation record
    env.storage()
        .persistent()
        .remove(&DelegationKey::DelegateTo(delegator.clone()));

    Ok(())
}

/// Return the direct delegate of `delegator`, if any.
pub fn get_delegate(env: &Env, delegator: &Address) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&DelegationKey::DelegateTo(delegator.clone()))
}

/// Resolve the effective voter for `voter` by following the delegation chain.
/// Stops at MAX_DEPTH hops to prevent infinite loops.
/// Returns the terminal delegate (the one who will actually cast the vote).
pub fn resolve_delegate(env: &Env, voter: &Address) -> Address {
    const MAX_DEPTH: u32 = 10;
    let mut current = voter.clone();
    let mut depth = 0u32;

    loop {
        if depth >= MAX_DEPTH {
            break;
        }
        match get_delegate(env, &current) {
            Some(next) => {
                current = next;
                depth += 1;
            }
            None => break,
        }
    }

    current
}

/// Return all addresses that have delegated (directly) to `delegate`.
pub fn get_delegators(env: &Env, delegate: &Address) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DelegationKey::DelegatedFrom(delegate.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

// ============================================================================
// Errors
// ============================================================================

#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum DelegationError {
    SelfDelegation = 2001,
    CircularDelegation = 2002,
    NoDelegation = 2003,
}

// ============================================================================
// Internal helpers
// ============================================================================

/// Walk forward from `start` following the delegation chain.
/// Returns true if `origin` appears in the chain (cycle detected).
fn would_create_cycle(env: &Env, origin: &Address, start: &Address) -> bool {
    const MAX_DEPTH: u32 = 10;
    let mut current = start.clone();
    let mut depth = 0u32;

    loop {
        if current == *origin {
            return true;
        }
        if depth >= MAX_DEPTH {
            break;
        }
        match get_delegate(env, &current) {
            Some(next) => {
                current = next;
                depth += 1;
            }
            None => break,
        }
    }
    false
}

fn remove_from_incoming(env: &Env, delegate: &Address, delegator: &Address) {
    let incoming: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DelegationKey::DelegatedFrom(delegate.clone()))
        .unwrap_or_else(|| Vec::new(env));
    let mut updated = Vec::new(env);
    for addr in incoming.iter() {
        if addr != *delegator {
            updated.push_back(addr);
        }
    }
    env.storage()
        .persistent()
        .set(&DelegationKey::DelegatedFrom(delegate.clone()), &updated);
}
