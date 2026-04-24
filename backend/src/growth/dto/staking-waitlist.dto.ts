export class JoinStakingWaitlistDto {
  userId: string;
  email: string;
}

export class StakingWaitlistEntryDto {
  id: string;
  userId: string;
  email: string;
  position: number;
  status: 'queued' | 'notified' | 'granted';
  joinedAt: Date;
}
