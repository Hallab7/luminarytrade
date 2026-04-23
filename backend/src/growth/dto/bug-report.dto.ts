export class CreateBugReportDto {
  userId: string;
  title: string;
  description: string;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  affectedComponent?: string;
  screenshots?: string[];
  priority?: 'urgent' | 'high' | 'medium' | 'low';
}

export class BugReportResponseDto {
  id: string;
  userId: string;
  title: string;
  description: string;
  severity: string;
  status: 'pending' | 'under_review' | 'verified' | 'rejected' | 'paid';
  bonusAmount?: number;
  submittedAt: Date;
  reviewedAt?: Date;
}

export class VerifyBugReportDto {
  reportId: string;
  verified: boolean;
  reviewerId: string;
  comments?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'informational';
}
