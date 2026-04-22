import { Injectable } from '@nestjs/common';

@Injectable()
export class AffiliateService {
  private affiliates = new Map<string, number>();

  async generateLink(userId: string): Promise<string> {
    return `https://luminarytrade.com/ref/${userId}`;
  }

  async recordTradeVolume(userId: string, volume: number): Promise<void> {
    const current = this.affiliates.get(userId) || 0;
    this.affiliates.set(userId, current + volume * 0.05); // 5% commission
  }

  async getCommissions(userId: string): Promise<number> {
    return this.affiliates.get(userId) || 0;
  }
}
