import { Injectable } from '@nestjs/common';

@Injectable()
export class BonusMultiplierService {
  private activityScores = new Map<string, number>();

  async recordActivity(userId: string, activityScore: number): Promise<void> {
    const current = this.activityScores.get(userId) || 0;
    this.activityScores.set(userId, current + activityScore);
  }

  async getMultiplier(userId: string): Promise<number> {
    const score = this.activityScores.get(userId) || 0;
    if (score > 100) return 2.0;
    if (score > 50) return 1.5;
    return 1.0;
  }
}
