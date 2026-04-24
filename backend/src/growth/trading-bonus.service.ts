import { Injectable, Logger } from '@nestjs/common';
import { TradingBonusStatusDto } from './dto/trading-bonus.dto';

const TIERS = [
  { name: 'gold' as const, minVolume: 100_000, rate: 0.02 },
  { name: 'silver' as const, minVolume: 10_000, rate: 0.01 },
  { name: 'bronze' as const, minVolume: 1_000, rate: 0.005 },
];

@Injectable()
export class TradingBonusService {
  private readonly logger = new Logger(TradingBonusService.name);
  /** key: `${userId}:${month}` -> volume */
  private volumes = new Map<string, number>();

  private currentMonth(): string {
    return new Date().toISOString().slice(0, 7);
  }

  recordVolume(userId: string, volume: number, month?: string): void {
    const m = month ?? this.currentMonth();
    const key = `${userId}:${m}`;
    this.volumes.set(key, (this.volumes.get(key) ?? 0) + volume);
    this.logger.log(`Recorded ${volume} volume for ${userId} in ${m}`);
  }

  getStatus(userId: string, month?: string): TradingBonusStatusDto {
    const m = month ?? this.currentMonth();
    const volume = this.volumes.get(`${userId}:${m}`) ?? 0;
    const tier = TIERS.find((t) => volume >= t.minVolume);

    return {
      userId,
      month: m,
      volume,
      bonusTier: tier?.name ?? 'none',
      bonusAmount: tier ? Math.floor(volume * tier.rate) : 0,
      payoutScheduled: !!tier,
    };
  }

  /** Called by a monthly scheduler to compute all payouts */
  computeMonthlyPayouts(month?: string): TradingBonusStatusDto[] {
    const m = month ?? this.currentMonth();
    const results: TradingBonusStatusDto[] = [];
    for (const [key] of this.volumes) {
      const [userId, entryMonth] = key.split(':');
      if (entryMonth === m) results.push(this.getStatus(userId, m));
    }
    return results;
  }
}
