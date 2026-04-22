import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { GovernanceReferralService } from './governance-referral.service';
import { BonusMultiplierService } from './bonus-multiplier.service';
import { AffiliateService } from './affiliate.service';
import { WaitlistService, WaitlistTier } from './waitlist.service';

@Controller('growth')
export class GrowthController {
  constructor(
    private readonly governance: GovernanceReferralService,
    private readonly multiplier: BonusMultiplierService,
    private readonly affiliate: AffiliateService,
    private readonly waitlist: WaitlistService,
  ) {}

  @Post('governance/referral')
  async trackReferral(@Body() body: { referrerId: string; voteId: string }) {
    return this.governance.trackReferral(body.referrerId, body.voteId);
  }

  @Get('multiplier/:userId')
  async getMultiplier(@Param('userId') userId: string) {
    return this.multiplier.getMultiplier(userId);
  }

  @Get('affiliate/link/:userId')
  async getLink(@Param('userId') userId: string) {
    return this.affiliate.generateLink(userId);
  }

  @Post('waitlist')
  async joinWaitlist(@Body() body: { userId: string; tier: WaitlistTier }) {
    return this.waitlist.joinWaitlist(body.userId, body.tier);
  }
}
