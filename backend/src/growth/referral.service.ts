import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ReferralStatusDto } from './dto/referral.dto';

const REWARD_PER_REFERRAL = 50; // tokens

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);
  /** userId -> referral code */
  private codes = new Map<string, string>();
  /** code -> userId */
  private codeOwner = new Map<string, string>();
  /** userId -> Set of referred userIds */
  private referrals = new Map<string, Set<string>>();

  generateCode(userId: string): string {
    if (this.codes.has(userId)) return this.codes.get(userId)!;
    const code = `REF-${userId.slice(0, 6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    this.codes.set(userId, code);
    this.codeOwner.set(code, userId);
    this.logger.log(`Generated referral code ${code} for user ${userId}`);
    return code;
  }

  redeem(code: string, newUserId: string): { success: boolean; reward: number } {
    const ownerId = this.codeOwner.get(code);
    if (!ownerId) throw new BadRequestException('Invalid referral code');
    if (ownerId === newUserId) throw new BadRequestException('Cannot use your own referral code');

    const referred = this.referrals.get(ownerId) ?? new Set();
    if (referred.has(newUserId)) throw new BadRequestException('Referral already redeemed');

    referred.add(newUserId);
    this.referrals.set(ownerId, referred);
    this.logger.log(`User ${newUserId} redeemed code ${code} (owner: ${ownerId})`);
    return { success: true, reward: REWARD_PER_REFERRAL };
  }

  getStatus(userId: string): ReferralStatusDto {
    const code = this.codes.get(userId) ?? this.generateCode(userId);
    const referred = this.referrals.get(userId) ?? new Set();
    return {
      userId,
      code,
      referralCount: referred.size,
      totalReward: referred.size * REWARD_PER_REFERRAL,
    };
  }
}
