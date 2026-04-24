import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { JoinBetaWaitlistDto, BetaWaitlistResponseDto } from './dto/beta-waitlist.dto';

@Injectable()
export class BetaWaitlistService {
  private readonly logger = new Logger(BetaWaitlistService.name);
  private entries = new Map<string, BetaWaitlistResponseDto>();

  async join(dto: JoinBetaWaitlistDto): Promise<BetaWaitlistResponseDto> {
    const key = `${dto.userId}:${dto.featureKey}`;
    if (this.entries.has(key)) {
      throw new ConflictException('Already on waitlist for this feature');
    }

    const featureEntries = [...this.entries.values()].filter(
      (e) => e.featureKey === dto.featureKey,
    );

    const entry: BetaWaitlistResponseDto = {
      id: `bw-${Date.now()}`,
      userId: dto.userId,
      email: dto.email,
      featureKey: dto.featureKey,
      position: featureEntries.length + 1,
      status: 'pending',
      joinedAt: new Date(),
    };

    this.entries.set(key, entry);
    this.logger.log(`User ${dto.userId} joined beta waitlist for ${dto.featureKey}`);
    return entry;
  }

  async getStatus(userId: string, featureKey: string): Promise<BetaWaitlistResponseDto | null> {
    return this.entries.get(`${userId}:${featureKey}`) ?? null;
  }

  async notify(userId: string, featureKey: string): Promise<BetaWaitlistResponseDto> {
    const entry = this.entries.get(`${userId}:${featureKey}`);
    if (!entry) throw new Error('Waitlist entry not found');
    entry.status = 'notified';
    this.logger.log(`Notified ${entry.email} for feature ${featureKey}`);
    return entry;
  }
}
