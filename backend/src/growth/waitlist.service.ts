import { Injectable } from '@nestjs/common';

export enum WaitlistTier {
  BASIC = 'BASIC',
  PREMIUM = 'PREMIUM',
  VIP = 'VIP',
}

@Injectable()
export class WaitlistService {
  private waitlist = new Map<string, WaitlistTier>();

  async joinWaitlist(userId: string, tier: WaitlistTier): Promise<boolean> {
    this.waitlist.set(userId, tier);
    return true;
  }

  async checkStatus(userId: string): Promise<{ isAdmitted: boolean, tier: WaitlistTier | null }> {
    const tier = this.waitlist.get(userId) || null;
    // Mock admitting premium users early
    const isAdmitted = tier === WaitlistTier.VIP || tier === WaitlistTier.PREMIUM;
    return { isAdmitted, tier };
  }
}
