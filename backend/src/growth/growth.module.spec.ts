import { Test, TestingModule } from '@nestjs/testing';
import { GrowthController } from './growth.controller';
import { GovernanceReferralService } from './governance-referral.service';
import { BonusMultiplierService } from './bonus-multiplier.service';
import { AffiliateService } from './affiliate.service';
import { WaitlistService, WaitlistTier } from './waitlist.service';

describe('Growth Module', () => {
  let controller: GrowthController;
  let multiplier: BonusMultiplierService;
  let waitlist: WaitlistService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GrowthController],
      providers: [
        GovernanceReferralService,
        BonusMultiplierService,
        AffiliateService,
        WaitlistService,
      ],
    }).compile();

    controller = module.get<GrowthController>(GrowthController);
    multiplier = module.get<BonusMultiplierService>(BonusMultiplierService);
    waitlist = module.get<WaitlistService>(WaitlistService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return 1.0 multiplier by default', async () => {
    expect(await multiplier.getMultiplier('user1')).toBe(1.0);
  });

  it('should allow premium users in waitlist', async () => {
    await waitlist.joinWaitlist('user2', WaitlistTier.PREMIUM);
    const status = await waitlist.checkStatus('user2');
    expect(status.isAdmitted).toBe(true);
  });
});
