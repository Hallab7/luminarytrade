import { Module } from '@nestjs/common';
import { GrowthController } from './growth.controller';
import { GovernanceReferralService } from './governance-referral.service';
import { BonusMultiplierService } from './bonus-multiplier.service';
import { AffiliateService } from './affiliate.service';
import { WaitlistService } from './waitlist.service';

@Module({
  controllers: [GrowthController],
  providers: [
    GovernanceReferralService,
    BonusMultiplierService,
    AffiliateService,
    WaitlistService,
  ],
  exports: [
    GovernanceReferralService,
    BonusMultiplierService,
    AffiliateService,
    WaitlistService,
  ],
})
export class GrowthModule {}
