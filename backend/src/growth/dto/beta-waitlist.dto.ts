export class JoinBetaWaitlistDto {
  userId: string;
  email: string;
  featureKey: string;
}

export class BetaWaitlistResponseDto {
  id: string;
  userId: string;
  email: string;
  featureKey: string;
  position: number;
  status: 'pending' | 'notified' | 'granted';
  joinedAt: Date;
}
