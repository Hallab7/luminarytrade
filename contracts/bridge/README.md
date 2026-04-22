# Cross-Chain Bridge Contract

Secure cross-chain bridge enabling atomic asset transfers between Stellar (Soroban) and EVM-compatible chains.

## Overview

This bridge contract provides trust-minimized cross-chain transfers using a decentralized network of relayers with M-of-N consensus, ensuring no single point of failure while maintaining security and efficiency.

## Features

### 🔗 Cross-Chain Transfers
- **Stellar ↔ Ethereum**: Native USDC, XLM, custom tokens
- **Stellar ↔ Polygon**: Fast, low-cost transfers
- **Stellar ↔ BSC**: Binance ecosystem integration
- **Stellar ↔ Arbitrum/Optimism**: L2 scaling solutions
- **Generic EVM Support**: Custom chain integration

### 🛡️ Security Model
- **M-of-N Relayer Consensus**: Multiple independent relayers (default 3-of-5)
- **No Single Point of Failure**: Compromising < M relayers cannot forge transfers
- **Emergency Pause**: Stop bridge if issues detected
- **Rate Limiting**: Prevent large-scale exploits
- **Timeout Protection**: 1-hour confirmation window

### 💰 Fee System
- **Bridge Fee**: 0.3% (relayer incentives)
- **Protocol Fee**: 0.1% (treasury revenue)
- **Total**: 0.4% per transfer
- **Configurable**: Governance-adjustable parameters

### 📊 Liquidity Management
- Track minted/burned tokens per chain
- Prevent insolvency through balance checks
- Lock liquidity during transfers
- Rebalancing via governance

## Quick Start

### Initialize Bridge

```rust
use soroban_sdk::{Address, Env, Vec};
use bridge_contract::{BridgeContract, BridgeContractClient};

let env = Env::default();
env.mock_all_auths();

let admin = Address::generate(&env);
let mut relayers = Vec::new(&env);

// Create 5 relayers
for _ in 0..5 {
    relayers.push_back(Address::generate(&env));
}

let client = BridgeContractClient::new(&env, &admin);
client.initialize(&admin, &relayers, &3); // 3-of-5 threshold
```

### Initiate Transfer (Stellar → Ethereum)

```rust
let user = Address::generate(&env);
let recipient_evm_address = Bytes::from_slice(&env, &[0u8; 20]); // 20-byte EVM address

let client = BridgeContractClient::new(&env, &user);

let transfer = client.initiate_transfer(
    &user,
    &recipient_evm_address,
    &ChainType::Ethereum,
    &symbol_short!("USDC"),
    &1_000_000_000, // 1000 USDC (6 decimals)
);

println!("Transfer ID: {}", transfer.transfer_id);
println!("Fee: {}", transfer.fee);
println!("Net Amount: {}", transfer.net_amount);
```

### Relayer Attestation

```rust
// Each relayer independently verifies and signs
let relayer_client = BridgeContractClient::new(&env, &relayer_address);
let signature = sign_transfer_event(&transfer_event); // ECDSA/Ed25519 signature

client.relay_attestation(
    &relayer_address,
    &transfer_id,
    &signature,
);

// After M confirmations, transfer status becomes "Confirmed"
```

### Complete Transfer

```rust
// Once M-of-N relayers have attested
let admin_client = BridgeContractClient::new(&env, &admin);
client.complete_transfer(&transfer_id);

// Tokens minted on destination chain
```

### Burn and Withdraw (Ethereum → Stellar)

```rust
// On Ethereum side, user burns wrapped tokens
// Then on Stellar:
let burn_client = BridgeContractClient::new(&env, &user);

let withdrawal = client.burn_and_withdraw(
    &user,
    &recipient_stellar_address,
    &ChainType::Stellar,
    &symbol_short!("USDC"),
    &500_000_000,
);
```

## API Reference

### Core Functions

#### `initialize(admin, initial_relayers, min_confirmations)`
Initialize bridge contract with admin and relayer set.

**Parameters:**
- `admin`: Admin address
- `initial_relayers`: Vector of relayer addresses
- `min_confirmations`: M value for M-of-N consensus

**Returns:** `Result<(), CommonError>`

---

#### `initiate_transfer(sender, recipient, dest_chain, token, amount)`
Start cross-chain transfer by depositing tokens.

**Parameters:**
- `sender`: User initiating transfer
- `recipient`: Recipient address on destination chain (as Bytes for EVM)
- `dest_chain`: Destination chain type
- `token`: Token symbol to bridge
- `amount`: Amount to transfer

**Returns:** `Result<BridgeTransfer, CommonError>`

**Events:** `bridge_req`

---

#### `relay_attestation(relayer, transfer_id, signature)`
Relayer confirms transfer validity.

**Parameters:**
- `relayer`: Relayer address
- `transfer_id`: Transfer to attest
- `signature`: Relayer's cryptographic signature

**Returns:** `Result<bool, CommonError>`

**Events:** `relay_att`

---

#### `complete_transfer(transfer_id)`
Finalize transfer and mint tokens on destination.

**Parameters:**
- `transfer_id`: Confirmed transfer ID

**Returns:** `Result<(), CommonError>`

**Events:** `bridge_cmp`

---

#### `burn_and_withdraw(burner, recipient, source_chain, token, amount)`
Burn tokens on destination to withdraw on source.

**Parameters:**
- `burner`: Address burning tokens
- `recipient`: Recipient on source chain
- `source_chain`: Chain where tokens will be released
- `token`: Token type
- `amount`: Amount to burn

**Returns:** `Result<BridgeTransfer, CommonError>`

**Events:** `bridge_burn`

---

### Relayer Management

#### `add_relayer(admin, relayer)`
Add new relayer to network.

#### `remove_relayer(admin, relayer)`
Remove/deactivate relayer.

#### `get_relayer_info(relayer)`
Get relayer statistics and status.

---

### Security Controls

#### `pause(admin, reason)`
Emergency pause - stops all transfers.

#### `unpause(admin)`
Resume bridge operations.

#### `update_config(admin, config)`
Update bridge configuration (limits, timeouts).

#### `update_fees(admin, bridge_fee_bps, protocol_fee_bps, slippage_bps)`
Adjust fee parameters.

---

### Monitoring

#### `get_stats()`
Get bridge statistics dashboard.

**Returns:** `BridgeStats`
- Total transfers processed
- Active relayers count
- Is paused status
- Rate limit usage

#### `get_transfer(transfer_id)`
Get transfer details by ID.

#### `health_check()`
Liveness check for monitoring systems.

**Returns:** `bool`

#### `get_liquidity_pool(token)`
Get liquidity information for token.

## Data Types

### ChainType

```rust
pub enum ChainType {
    Stellar = 0,
    Ethereum = 1,
    Polygon = 2,
    BSC = 3,
    Arbitrum = 4,
    Optimism = 5,
    EVM = 99, // Generic
}
```

### TransferStatus

```rust
pub enum TransferStatus {
    Pending = 0,     // Awaiting confirmations
    Confirmed = 1,   // M-of-N reached
    Completed = 2,   // Minted/burned
    Failed = 3,      // Timeout/cancelled
}
```

### BridgeTransfer

```rust
pub struct BridgeTransfer {
    pub transfer_id: u64,
    pub source_chain: ChainType,
    pub dest_chain: ChainType,
    pub sender: Address,
    pub recipient: Bytes,
    pub token: Symbol,
    pub amount: i128,
    pub fee: i128,
    pub net_amount: i128,
    pub status: TransferStatus,
    pub created_at: u64,
    pub confirmations: u32,
    pub required_confirmations: u32,
}
```

### BridgeConfig

```rust
pub struct BridgeConfig {
    pub min_confirmations: u32,      // M value
    pub total_relayers: u32,         // N value
    pub transfer_timeout: u64,       // Seconds until expiry
    pub rate_limit_enabled: bool,
    pub daily_limit_per_token: i128,
    pub max_transfer_amount: i128,
    pub min_transfer_amount: i128,
}
```

## Configuration

### Default Parameters

```rust
// Relayer consensus
DEFAULT_MIN_CONFIRMATIONS = 3       // 3-of-5 default
DEFAULT_TRANSFER_TIMEOUT = 3600     // 1 hour

// Fees (basis points: 10000 = 100%)
DEFAULT_BRIDGE_FEE_BPS = 30         // 0.3%
DEFAULT_PROTOCOL_FEE_BPS = 10       // 0.1%
DEFAULT_SLIPPAGE_BPS = 50           // 0.5%

// Limits
MIN_TRANSFER_AMOUNT = 1_000_000     // 1 token
MAX_TRANSFER_AMOUNT = 100_000_000_000 // 100K tokens
DAILY_LIMIT_PER_TOKEN = 1_000_000_000_000 // 1M tokens
```

### Customize Configuration

```rust
let custom_config = BridgeConfig {
    min_confirmations: 5,           // Higher security: 5-of-7
    total_relayers: 7,
    transfer_timeout: 7200,         // 2 hours
    rate_limit_enabled: true,
    daily_limit_per_token: 5_000_000_000_000, // 5M
    max_transfer_amount: 500_000_000_000,     // 500K
    min_transfer_amount: 500_000,             // 0.5 tokens
};

client.update_config(&admin, &custom_config);
```

## Security Considerations

### Relayer Selection

Choose relayers carefully:
- **Independent Operators**: Different organizations/geographies
- **High Availability**: 24/7 monitoring and uptime
- **Security Practices**: Secure key management
- **Reputation**: Trusted entities in ecosystem

### Recommended M-of-N Ratios

| Security Level | Total (N) | Required (M) | Use Case |
|---------------|-----------|--------------|----------|
| Standard | 5 | 3 | Balanced security/speed |
| High Security | 7 | 5 | Large volumes |
| Fast | 3 | 2 | Testing/low value |
| Maximum | 11 | 7 | Institutional |

### Rate Limiting Strategy

Set limits based on:
1. **Daily Volume**: Typical bridge usage patterns
2. **Liquidity Reserves**: Available backing assets
3. **Risk Tolerance**: Maximum acceptable exposure
4. **Gradual Scaling**: Increase limits as bridge proves secure

Example progression:
- Week 1-2: 100K daily limit
- Week 3-4: 500K daily limit
- Month 2+: 1M+ daily limit

### Emergency Procedures

**If bridge compromised:**
1. Admin calls `pause()` immediately
2. Investigate issue
3. Fix vulnerability
4. Audit changes
5. `unpause()` when safe

**Monitor for:**
- Unusual transfer volume spikes
- Relayer downtime > 30 seconds
- Liquidity ratio < 20%
- Failed attestations increase

## Testing

Run tests with:

```bash
cd contracts/bridge
cargo test
```

Test coverage includes:
- ✅ Initialization scenarios
- ✅ Cross-chain transfer lifecycle
- ✅ Relayer attestation and consensus
- ✅ Security controls (pause, rate limits)
- ✅ Fee calculations
- ✅ Edge cases (timeout, insufficient liquidity)
- ✅ Full integration tests (40+ tests)

## Integration Examples

### Frontend Integration (TypeScript)

```typescript
import { ContractClient } from '@stellar/stellar-sdk';

// Connect to bridge contract
const bridge = new ContractClient(contractId);

// Initiate transfer
async function bridgeToEthereum(amount: number, ethAddress: string) {
  const transaction = await bridge.initiate_transfer(
    userAddress,
    Buffer.from(ethAddress, 'hex'),
    ChainType.Ethereum,
    'USDC',
    amount * 1_000_000 // 6 decimals
  );
  
  console.log(`Transfer ID: ${transaction.transfer_id}`);
  console.log(`Fee: ${transaction.fee / 1_000_000} USDC`);
  
  return transaction;
}

// Monitor transfer status
async function checkTransferStatus(transferId: number) {
  const transfer = await bridge.get_transfer(transferId);
  
  switch(transfer.status) {
    case TransferStatus.Pending:
      console.log('Awaiting relayer confirmations...');
      break;
    case TransferStatus.Confirmed:
      console.log('Confirmed! Minting on destination...');
      break;
    case TransferStatus.Completed:
      console.log('✅ Transfer complete!');
      break;
    case TransferStatus.Failed:
      console.log('❌ Transfer failed');
      break;
  }
}
```

### Relayer Service (Node.js)

```typescript
import { Keypair } from '@stellar/stellar-sdk';

class RelayerService {
  private keypair: Keypair;
  private bridgeContract: ContractClient;
  
  async monitorAndAttest() {
    // Watch for bridge events
    const transfers = await this.watchBridgeEvents();
    
    for (const transfer of transfers) {
      // Verify transfer validity
      const isValid = await this.verifyTransfer(transfer);
      
      if (isValid) {
        // Sign attestation
        const signature = await this.signAttestation(transfer);
        
        // Submit to contract
        await this.submitAttestation(transfer.id, signature);
        
        console.log(`Attested transfer ${transfer.id}`);
      }
    }
  }
  
  private async verifyTransfer(transfer: BridgeTransfer): Promise<boolean> {
    // Check:
    // - Transfer not expired
    // - Not already completed
    // - Within rate limits
    // - Sufficient liquidity
    // - Valid sender signature
    
    return true; // if all checks pass
  }
}
```

## Troubleshooting

### Common Issues

**Transfer stuck in "Pending" status:**
- Check relayer network is operational
- Verify M-of-N threshold achievable
- Confirm relayers receiving events

**"OutOfRange" error:**
- Amount below minimum or above maximum
- Daily rate limit exceeded
- Check current limits with `get_stats()`

**"NotAuthorized" error:**
- Bridge is paused
- Invalid relayer attempting attestation
- Transfer already completed

**Insufficient liquidity:**
- Pool needs rebalancing
- Too many pending transfers
- Contact governance for liquidity injection

## Future Enhancements

Roadmap items:
- [ ] EVM contract implementation (Solidity)
- [ ] Off-chain relayer service reference implementation
- [ ] NFT bridging support
- [ ] Dynamic fee market
- [ ] Insurance fund integration
- [ ] DAO governance for relayer selection
- [ ] Layer 2 rollup support
- [ ] General cross-chain messaging

## License

Same as LuminaryTrade project license.

## Support

For issues or questions:
- GitHub Issues: https://github.com/A6dulmalik/luminarytrade/issues
- Documentation: See BRIDGE_IMPLEMENTATION_SUMMARY.md

---

**Contract Address**: (To be deployed)
**Version**: 1.0.0
**Last Updated**: March 28, 2026
**Audited**: Pending security audit
