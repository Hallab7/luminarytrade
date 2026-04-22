import { Injectable } from '@nestjs/common';

@Injectable()
export class GovernanceReferralService {
  private referrals = new Map<string, number>();

  async trackReferral(referrerId: string, voteId: string): Promise<boolean> {
    const current = this.referrals.get(referrerId) || 0;
    this.referrals.set(referrerId, current + 1);
    // Blockchain tracking & Oracle verification mocked
    return true;
  }

  async getReferralBonus(referrerId: string): Promise<number> {
    return (this.referrals.get(referrerId) || 0) * 10; // 10 tokens per vote
  }
}
