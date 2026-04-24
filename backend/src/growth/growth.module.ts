import { Module } from '@nestjs/common';
import { GrowthController } from './growth.controller';
import { GovernanceReferralService } from './governance-referral.service';
import { BonusMultiplierService } from './bonus-multiplier.service';
import { AffiliateService } from './affiliate.service';
import { WaitlistService } from './waitlist.service';
import { BugReportService } from './bug-report.service';
import { BetaWaitlistService } from './beta-waitlist.service';
import { ReferralService } from './referral.service';
import { TradingBonusService } from './trading-bonus.service';
import { StakingWaitlistService } from './staking-waitlist.service';

@Module({
  controllers: [GrowthController],
  providers: [
    GovernanceReferralService,
    BonusMultiplierService,
    AffiliateService,
    WaitlistService,
    BugReportService,
    BetaWaitlistService,
    ReferralService,
    TradingBonusService,
    StakingWaitlistService,
  ],
  exports: [
    GovernanceReferralService,
    BonusMultiplierService,
    AffiliateService,
    WaitlistService,
    BugReportService,
    BetaWaitlistService,
    ReferralService,
    TradingBonusService,
    StakingWaitlistService,
  ],
})
export class GrowthModule {}
