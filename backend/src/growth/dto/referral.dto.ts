export class GenerateReferralCodeDto {
  userId: string;
}

export class RedeemReferralCodeDto {
  code: string;
  newUserId: string;
}

export class ReferralStatusDto {
  userId: string;
  code: string;
  referralCount: number;
  totalReward: number;
}
