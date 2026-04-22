import { v4 as uuidv4 } from 'uuid';

export enum TransactionStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  RETRYING = 'retrying',
}

export interface Transaction {
  id: string;
  source: string;
  destination: string;
  amount: string;
  status: TransactionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class TransactionFixture {
  static create(overrides: Partial<Transaction> = {}): Transaction {
    const now = new Date();
    return {
      id: uuidv4(),
      source: 'G-SOURCE-ADDRESS',
      destination: 'G-DEST-ADDRESS',
      amount: '100.0',
      status: TransactionStatus.PENDING,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  static createMany(count: number, overrides: Partial<Transaction> = {}): Transaction[] {
    return Array.from({ length: count }, () => this.create(overrides));
  }
}
