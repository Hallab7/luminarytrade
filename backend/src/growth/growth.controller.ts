import { Controller, Post, Get, Param, Body, Query } from '@nestjs/common';
import { GovernanceReferralService } from './governance-referral.service';
import { BonusMultiplierService } from './bonus-multiplier.service';
import { AffiliateService } from './affiliate.service';
import { WaitlistService, WaitlistTier } from './waitlist.service';
import { BugReportService } from './bug-report.service';
import { CreateBugReportDto, VerifyBugReportDto } from './dto/bug-report.dto';
import { BetaWaitlistService } from './beta-waitlist.service';
import { JoinBetaWaitlistDto } from './dto/beta-waitlist.dto';
import { ReferralService } from './referral.service';
import { RedeemReferralCodeDto } from './dto/referral.dto';
import { TradingBonusService } from './trading-bonus.service';
import { RecordTradeVolumeDto } from './dto/trading-bonus.dto';
import { StakingWaitlistService } from './staking-waitlist.service';
import { JoinStakingWaitlistDto } from './dto/staking-waitlist.dto';

@Controller('growth')
export class GrowthController {
  constructor(
    private readonly governance: GovernanceReferralService,
    private readonly multiplier: BonusMultiplierService,
    private readonly affiliate: AffiliateService,
    private readonly waitlist: WaitlistService,
    private readonly bugReport: BugReportService,
    private readonly betaWaitlist: BetaWaitlistService,
    private readonly referral: ReferralService,
    private readonly tradingBonus: TradingBonusService,
    private readonly stakingWaitlist: StakingWaitlistService,
  ) {}

  // ── Existing endpoints ────────────────────────────────────────────────────

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

  @Post('bug-report')
  async submitBugReport(@Body() body: CreateBugReportDto) {
    return this.bugReport.submitBugReport(body);
  }

  @Post('bug-report/verify')
  async verifyBugReport(@Body() body: VerifyBugReportDto) {
    return this.bugReport.verifyBugReport(body);
  }

  @Get('bug-report/:reportId')
  async getBugReport(@Param('reportId') reportId: string) {
    return this.bugReport.getBugReport(reportId);
  }

  @Get('bug-report/user/:userId')
  async getUserBugReports(@Param('userId') userId: string) {
    return this.bugReport.getUserBugReports(userId);
  }

  @Get('bug-report/bonus/:userId')
  async getUserBonusBalance(@Param('userId') userId: string) {
    return { userId, bonusBalance: await this.bugReport.getUserBonusBalance(userId) };
  }

  @Get('bug-reports')
  async getAllBugReports() {
    return this.bugReport.getAllBugReports();
  }

  // ── #247 Beta Features Waitlist ───────────────────────────────────────────

  @Post('beta-waitlist/join')
  async joinBetaWaitlist(@Body() dto: JoinBetaWaitlistDto) {
    return this.betaWaitlist.join(dto);
  }

  @Get('beta-waitlist/status/:userId')
  async getBetaWaitlistStatus(
    @Param('userId') userId: string,
    @Query('featureKey') featureKey: string,
  ) {
    return this.betaWaitlist.getStatus(userId, featureKey);
  }

  @Post('beta-waitlist/notify/:userId')
  async notifyBetaUser(
    @Param('userId') userId: string,
    @Body() body: { featureKey: string },
  ) {
    return this.betaWaitlist.notify(userId, body.featureKey);
  }

  // ── #248 Referral Program ─────────────────────────────────────────────────

  @Get('referral/code/:userId')
  async getReferralCode(@Param('userId') userId: string) {
    return { code: this.referral.generateCode(userId) };
  }

  @Post('referral/redeem')
  async redeemReferral(@Body() dto: RedeemReferralCodeDto) {
    return this.referral.redeem(dto.code, dto.newUserId);
  }

  @Get('referral/status/:userId')
  async getReferralStatus(@Param('userId') userId: string) {
    return this.referral.getStatus(userId);
  }

  // ── #249 Trading Bonuses ──────────────────────────────────────────────────

  @Post('trading-bonus/record')
  async recordTradeVolume(@Body() dto: RecordTradeVolumeDto) {
    this.tradingBonus.recordVolume(dto.userId, dto.volume, dto.month);
    return { success: true };
  }

  @Get('trading-bonus/status/:userId')
  async getTradingBonusStatus(
    @Param('userId') userId: string,
    @Query('month') month?: string,
  ) {
    return this.tradingBonus.getStatus(userId, month);
  }

  @Get('trading-bonus/payouts')
  async getMonthlyPayouts(@Query('month') month?: string) {
    return this.tradingBonus.computeMonthlyPayouts(month);
  }

  // ── #250 Staking Rewards Waitlist ─────────────────────────────────────────

  @Post('staking-waitlist/join')
  async joinStakingWaitlist(@Body() dto: JoinStakingWaitlistDto) {
    return this.stakingWaitlist.join(dto);
  }

  @Get('staking-waitlist/status/:userId')
  async getStakingWaitlistStatus(@Param('userId') userId: string) {
    return this.stakingWaitlist.getStatus(userId);
  }

  @Post('staking-waitlist/grant-next')
  async grantNextStakingAccess(@Body() body: { count?: number }) {
    return this.stakingWaitlist.grantNext(body.count ?? 1);
  }

  @Get('staking-waitlist/queue-length')
  async getStakingQueueLength() {
    return {
      queueLength: this.stakingWaitlist.getQueueLength(),
      isFull: this.stakingWaitlist.isFull(),
    };
  }
}
