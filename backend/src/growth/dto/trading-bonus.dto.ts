export class RecordTradeVolumeDto {
  userId: string;
  volume: number;
  month?: string; // e.g. "2026-04"
}

export class TradingBonusStatusDto {
  userId: string;
  month: string;
  volume: number;
  bonusTier: 'none' | 'bronze' | 'silver' | 'gold';
  bonusAmount: number;
  payoutScheduled: boolean;
}
