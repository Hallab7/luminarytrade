import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { GovernanceReferralService } from './governance-referral.service';
import { BonusMultiplierService } from './bonus-multiplier.service';
import { AffiliateService } from './affiliate.service';
import { WaitlistService, WaitlistTier } from './waitlist.service';
import { BugReportService } from './bug-report.service';
import { CreateBugReportDto, VerifyBugReportDto } from './dto/bug-report.dto';

@Controller('growth')
export class GrowthController {
  constructor(
    private readonly governance: GovernanceReferralService,
    private readonly multiplier: BonusMultiplierService,
    private readonly affiliate: AffiliateService,
    private readonly waitlist: WaitlistService,
    private readonly bugReport: BugReportService,
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

  // Bug Report Bonuses Endpoints
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
}
