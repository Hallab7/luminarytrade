import { Injectable, Logger } from '@nestjs/common';
import { CreateBugReportDto, BugReportResponseDto, VerifyBugReportDto } from './dto/bug-report.dto';

export interface BugReport {
  id: string;
  userId: string;
  title: string;
  description: string;
  severity: string;
  status: 'pending' | 'under_review' | 'verified' | 'rejected' | 'paid';
  bonusAmount?: number;
  submittedAt: Date;
  reviewedAt?: Date;
  reviewerId?: string;
  comments?: string;
  screenshots?: string[];
  priority?: string;
  affectedComponent?: string;
}

@Injectable()
export class BugReportService {
  private readonly logger = new Logger(BugReportService.name);
  private bugReports: Map<string, BugReport> = new Map();
  private userBonuses: Map<string, number> = new Map();
  private reportCounter = 0;

  private readonly BONUS_AMOUNTS = {
    critical: 1000,
    high: 500,
    medium: 200,
    low: 100,
    informational: 50,
  };

  async submitBugReport(dto: CreateBugReportDto): Promise<BugReportResponseDto> {
    this.reportCounter++;
    const reportId = `BUG-${this.reportCounter}`;

    const report: BugReport = {
      id: reportId,
      userId: dto.userId,
      title: dto.title,
      description: dto.description,
      severity: dto.severity || 'medium',
      status: 'pending',
      submittedAt: new Date(),
      screenshots: dto.screenshots,
      priority: dto.priority,
      affectedComponent: dto.affectedComponent,
    };

    this.bugReports.set(reportId, report);

    this.logger.log(`Bug report submitted: ${reportId} by user ${dto.userId}`);

    return this.mapToResponseDto(report);
  }

  async verifyBugReport(dto: VerifyBugReportDto): Promise<BugReportResponseDto> {
    const report = this.bugReports.get(dto.reportId);
    if (!report) {
      throw new Error(`Bug report ${dto.reportId} not found`);
    }

    if (report.status !== 'pending' && report.status !== 'under_review') {
      throw new Error(`Bug report ${dto.reportId} cannot be verified in current status: ${report.status}`);
    }

    report.status = dto.verified ? 'verified' : 'rejected';
    report.reviewedAt = new Date();
    report.reviewerId = dto.reviewerId;
    report.comments = dto.comments;
    
    if (dto.severity) {
      report.severity = dto.severity;
    }

    if (dto.verified) {
      // Calculate and assign bonus
      const bonusAmount = this.BONUS_AMOUNTS[report.severity as keyof typeof this.BONUS_AMOUNTS] || this.BONUS_AMOUNTS.medium;
      report.bonusAmount = bonusAmount;
      report.status = 'paid';

      // Update user bonus balance
      const currentBonus = this.userBonuses.get(report.userId) || 0;
      this.userBonuses.set(report.userId, currentBonus + bonusAmount);

      this.logger.log(`Bug report ${dto.reportId} verified. Bonus of ${bonusAmount} tokens awarded to user ${report.userId}`);
    } else {
      this.logger.log(`Bug report ${dto.reportId} rejected by reviewer ${dto.reviewerId}`);
    }

    this.bugReports.set(dto.reportId, report);
    return this.mapToResponseDto(report);
  }

  async getBugReport(reportId: string): Promise<BugReportResponseDto> {
    const report = this.bugReports.get(reportId);
    if (!report) {
      throw new Error(`Bug report ${reportId} not found`);
    }
    return this.mapToResponseDto(report);
  }

  async getUserBugReports(userId: string): Promise<BugReportResponseDto[]> {
    const userReports = Array.from(this.bugReports.values())
      .filter(report => report.userId === userId);
    
    return userReports.map(report => this.mapToResponseDto(report));
  }

  async getUserBonusBalance(userId: string): Promise<number> {
    return this.userBonuses.get(userId) || 0;
  }

  async getAllBugReports(): Promise<BugReportResponseDto[]> {
    return Array.from(this.bugReports.values()).map(report => this.mapToResponseDto(report));
  }

  private mapToResponseDto(report: BugReport): BugReportResponseDto {
    return {
      id: report.id,
      userId: report.userId,
      title: report.title,
      description: report.description,
      severity: report.severity,
      status: report.status,
      bonusAmount: report.bonusAmount,
      submittedAt: report.submittedAt,
      reviewedAt: report.reviewedAt,
    };
  }
}
