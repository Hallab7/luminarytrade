import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server, TransactionRecord, OperationRecord } from 'stellar-sdk';

/**
 * StellarBridgeService
 * - verifies transactions on Stellar (testnet/mainnet via env)
 * - exposes a retrying rpc call wrapper to handle transient network failures
 */
@Injectable()
export class StellarBridgeService {
  private readonly logger = new Logger(StellarBridgeService.name);
  private readonly server: Server;
  private readonly horizonUrl: string;

  constructor(private readonly config: ConfigService) {
    this.horizonUrl = this.config.get<string>('STELLAR_RPC_URL', 'https://horizon-testnet.stellar.org');
    this.server = new Server(this.horizonUrl);
  }

  private async retry<T>(fn: () => Promise<T>, retries = 3, delayMs = 200): Promise<T> {
    let lastErr: any;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const backoff = Math.min(delayMs * Math.pow(2, attempt), 5000);
        this.logger.warn(`Stellar RPC call failed (attempt ${attempt + 1}/${retries}): ${err?.message || err}. Retrying in ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw lastErr;
  }

  async getTransaction(txHash: string): Promise<TransactionRecord | null> {
    try {
      const res = await this.retry(() => this.server.transactions().transaction(txHash).call());
      return res as TransactionRecord;
    } catch (error) {
      this.logger.error(`Failed to fetch transaction ${txHash}: ${error?.message || error}`);
      return null;
    }
  }

  async getOperationsForTransaction(txHash: string): Promise<OperationRecord[] | null> {
    try {
      const res = await this.retry(() => this.server.operations().forTransaction(txHash).call());
      // @ts-ignore - call() returns a collection with _embedded
      const records = res.records || [];
      return records as OperationRecord[];
    } catch (error) {
      this.logger.error(`Failed to fetch operations for ${txHash}: ${error?.message || error}`);
      return null;
    }
  }

  async verifyTransaction(txHash: string): Promise<{ ok: boolean; transaction?: any; operations?: any[]; error?: string }> {
    const tx = await this.getTransaction(txHash);
    if (!tx) return { ok: false, error: 'Transaction not found or network error' };

    const ops = await this.getOperationsForTransaction(txHash);

    return {
      ok: true,
      transaction: {
        id: tx.id,
        hash: tx.hash,
        ledger: tx.ledger,
        created_at: tx.created_at,
        source_account: tx.source_account,
        fee_paid: tx.fee_paid,
        successful: tx.successful,
      },
      operations: ops?.map((o) => ({ id: o.id, type: o.type, source_account: o.source_account, from: (o as any).from, to: (o as any).to, amount: (o as any).amount })) || [],
    };
  }
}
