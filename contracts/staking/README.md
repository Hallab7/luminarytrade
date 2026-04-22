# Oracle Staking Contract

A comprehensive staking system for oracles with rewards distribution and slashing mechanisms.

## Overview

This contract implements a game-theoretic incentive system to ensure oracle reliability and data quality through:

- **Collateral Staking**: Oracles must stake tokens to participate
- **Quality Rewards**: Accurate data providers earn higher rewards
- **Slashing Penalties**: Malicious or lazy oracles lose their stake
- **Reputation System**: Higher performers gain better tiers and rewards

## Features

### 🎯 Core Functionality

- **Stake**: Deposit collateral to become an oracle
- **Unstake**: Request withdrawal (7-day lockup + 1-day grace period)
- **Earn Rewards**: Collect tokens for providing accurate data
- **Get Slashed**: Lose stake for downtime or false data
- **Claim**: Withdraw rewards or unstaked collateral

### 🏆 Tier System

| Tier | Minimum Stake | Reward Bonus |
|------|--------------|--------------|
| Bronze | 1,000 tokens | 0% |
| Silver | 5,000 tokens | +5% |
| Gold | 20,000 tokens | +15% |
| Platinum | 50,000 tokens | +30% |

Higher tiers earn better rewards and have more reputation.

### 💰 Reward Structure

**Base Rate**: 100 tokens per day

**Quality Adjustments**:
- ✅ **+10%** bonus for ≥99% accuracy
- ⚠️ **-20%** penalty for <95% accuracy
- ➖ No adjustment for 95-98% accuracy

**Example Daily Rewards**:
- Bronze oracle (100% accuracy): 100 tokens/day
- Silver oracle (100% accuracy): 100 × 1.05 × 1.10 = 115.5 tokens/day
- Gold oracle (100% accuracy): 100 × 1.15 × 1.10 = 126.5 tokens/day
- Platinum oracle (100% accuracy): 100 × 1.30 × 1.10 = 143 tokens/day

### ⚔️ Slashing Conditions

| Violation | Slash Amount | Description |
|-----------|-------------|-------------|
| Offline >24h | 5% | Oracle fails to provide data |
| False Data | 20% | Providing incorrect information |
| Malicious Behavior | Up to 100% | Coordinated attacks (multi-sig decision) |

**Reporter Bounty**: 10% of slashed amount goes to the reporter

## Usage

### Initialize Contract

```rust
let client = StakingContractClient::new(&env, &admin);
client.initialize(&admin);
```

### Stake to Become Oracle

```rust
// Stake 10,000 tokens (Silver tier)
let stake_info = client.stake(&oracle, &10_000_000_000);
```

### Record Data Submission

```rust
// Record 100% accurate submission
client.record_submission(&oracle, &100);

// Record poor submission (<95%)
client.record_submission(&oracle, &90);
```

### Unstake (Withdraw)

```rust
// Step 1: Request unstake (starts 7-day lockup)
client.unstake(&oracle);

// Step 2: Wait 7 days...

// Step 3: Claim collateral (within grace period)
client.claim_unstake(&oracle);
```

### Claim Rewards

```rust
// Accumulate rewards over time
client.record_submission(&oracle, &100);

// Fast forward 1 day...

// Claim accumulated rewards
let rewards = client.claim_rewards(&oracle);
```

### Slashing Examples

```rust
// Report offline oracle (24+ hours)
client.report_offline(&oracle, &25);

// Report false data
client.report_false_data(&oracle, &symbol_short!("bad_price"), &reporter);

// Direct slash (requires admin/multi-sig)
client.slash(&oracle, &symbol_short!("malicious"), &5000, &None); // 50% slash
```

### Query Leaderboard

```rust
// Get top 10 oracles by stake and reputation
let leaderboard = client.get_leaderboard(&10);

// Access top stakes
for entry in leaderboard.top_stakes.iter() {
    println!("Oracle: {}, Stake: {}, Tier: {:?}", 
             entry.oracle, entry.stake, entry.tier);
}
```

## Storage Layout

### Instance Storage (Global Config)
- Admin address
- Staking parameters (min/max stake, lockup periods)
- Slashing parameters (percentages, thresholds)
- Reward parameters (base rate, bonuses)
- Total staked amount
- Total oracle count

### Persistent Storage (Per Oracle)
- `StakeInfo`: Stake amount, tier, status, reputation
- `Rewards`: Accumulated, claimed, and pending rewards
- `UnstakeRequest`: Pending unstake requests with timestamps
- `SlashEvent`: Slash records with reasons

## Events Emitted

| Event Name | Parameters | Description |
|------------|-----------|-------------|
| `staking_init` | (admin, status) | Contract initialized |
| `stake` | (oracle, amount, tier) | New stake deposited |
| `unstake_req` | (oracle, amount, available_at) | Unstake requested |
| `unstake_ok` | (oracle, amount) | Unstake completed |
| `reward_clm` | (oracle, amount) | Rewards claimed |
| `slash` | (oracle, slashed_amount) | Oracle slashed |
| `slash_bnty` | (reporter, bounty) | Reporter rewarded |
| `submission` | (oracle, accuracy, reputation) | Data submitted |
| `gov_upd` | (admin, status) | Governance updated |

## Error Handling

Uses standard error codes from `common-utils`:

- `1001` - InvalidFormat
- `1003` - OutOfRange (amount validation)
- `1101` - NotAuthorized
- `1109` - NotInitialized
- `1110` - AlreadyInitialized
- `1201` - KeyNotFound

## Security Considerations

### Authorization
- All state-changing functions require `oracle.require_auth()`
- Admin functions verify admin address and require auth

### Economic Security
- Slashing makes attacks economically unprofitable
- Lockup periods prevent rapid exit after misbehavior
- Reporter bounties incentivize monitoring

### Time Locks
- 7-day unstake lockup prevents bank runs
- 1-day grace period allows recovery
- Offline threshold (24h) prevents false positives

### Governance Controls
- Admin can adjust parameters
- Multi-sig integration for major decisions
- Emergency shutdown capability

## Testing

Run tests with:

```bash
cd contracts/staking
cargo test
```

Test coverage includes:
- ✅ Initialization scenarios
- ✅ Staking with all tiers
- ✅ Unstaking lifecycle
- ✅ Reward calculations
- ✅ Slashing conditions
- ✅ Leaderboard functionality
- ✅ Governance operations
- ✅ Edge cases (30+ tests total)

## Integration Guide

### For Oracle Providers

1. **Setup**: Ensure you have sufficient tokens for minimum stake
2. **Initialize**: Call `initialize()` if first oracle
3. **Stake**: Call `stake()` with desired amount
4. **Operate**: Start providing data to oracles
5. **Record**: Call `record_submission()` after each data provision
6. **Earn**: Accumulate rewards based on accuracy
7. **Exit**: Call `unstake()` then `claim_unstake()` after lockup

### For Data Consumers

1. **Query Leaderboard**: Check top oracles by stake/reputation
2. **Verify Stake**: Ensure oracles have adequate collateral
3. **Monitor Performance**: Track submission accuracy
4. **Report Issues**: Slash oracles providing bad data

### For Governance

1. **Monitor System**: Track total staked, oracle count, slash events
2. **Adjust Parameters**: Update reward rates, slashing percentages as needed
3. **Emergency Actions**: Slash malicious oracles via multi-sig

## Configuration Constants

```rust
// Stake amounts
const MIN_STAKE: i128 = 1_000_000_000;      // 1,000 tokens
const MAX_STAKE: i128 = 100_000_000_000;   // 100,000 tokens

// Time periods (in seconds)
const UNSTAKE_LOCKUP_DAYS: u64 = 7;
const GRACE_PERIOD_DAYS: u64 = 1;
const SECONDS_PER_DAY: u64 = 86400;

// Rewards
const BASE_REWARD_RATE: i128 = 100_000_000; // 100 tokens/day

// Slashing (basis points: 10000 = 100%)
const OFFLINE_SLASH_BPS: u32 = 500;        // 5%
const FALSE_DATA_SLASH_BPS: u32 = 2000;    // 20%
const MALICIOUS_SLASH_MAX_BPS: u32 = 10000; // 100%

// Tiers
const TIER1_THRESHOLD: i128 = 5_000_000_000;   // Silver
const TIER2_THRESHOLD: i128 = 20_000_000_000;  // Gold
const TIER3_THRESHOLD: i128 = 50_000_000_000;  // Platinum

// Quality thresholds
const ACCURACY_HIGH: u32 = 99;  // ≥99% gets bonus
const ACCURACY_LOW: u32 = 95;   // <95% gets penalty
const QUALITY_BONUS_BPS: u32 = 1000;  // +10%
const PENALTY_BPS: u32 = 2000;        // -20%
```

## Future Enhancements

- [ ] Delegated staking (non-oracles can delegate to oracles)
- [ ] Auto-compounding rewards
- [ ] NFT badges for milestones/achievements
- [ ] Advanced analytics dashboard
- [ ] Cross-chain staking support
- [ ] Dynamic reward adjustment based on network conditions

## License

Same as LuminaryTrade project license.

## Support

For issues or questions:
- GitHub Issues: https://github.com/A6dulmalik/luminarytrade/issues
- Documentation: See main project README

---

**Contract Address**: (To be deployed)
**Version**: 1.0.0
**Last Updated**: March 28, 2026
