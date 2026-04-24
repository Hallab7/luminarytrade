import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { JoinStakingWaitlistDto, StakingWaitlistEntryDto } from './dto/staking-waitlist.dto';

const MAX_SLOTS = 1000;

@Injectable()
export class StakingWaitlistService {
  private readonly logger = new Logger(StakingWaitlistService.name);
  /** userId -> entry */
  private queue = new Map<string, StakingWaitlistEntryDto>();

  join(dto: JoinStakingWaitlistDto): StakingWaitlistEntryDto {
    if (this.queue.has(dto.userId)) {
      throw new ConflictException('Already on staking waitlist');
    }

    const entry: StakingWaitlistEntryDto = {
      id: `sw-${Date.now()}`,
      userId: dto.userId,
      email: dto.email,
      position: this.queue.size + 1,
      status: 'queued',
      joinedAt: new Date(),
    };

    this.queue.set(dto.userId, entry);
    this.logger.log(`User ${dto.userId} joined staking waitlist at position ${entry.position}`);
    return entry;
  }

  getStatus(userId: string): StakingWaitlistEntryDto | null {
    return this.queue.get(userId) ?? null;
  }

  /** Grant access to the next N users in queue order (FIFO by join date) */
  grantNext(count = 1): StakingWaitlistEntryDto[] {
    const queued = [...this.queue.values()]
      .filter((e) => e.status === 'queued')
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
      .slice(0, count);

    for (const entry of queued) {
      entry.status = 'granted';
      this.logger.log(`Granted staking access to ${entry.userId}`);
    }

    return queued;
  }

  getQueueLength(): number {
    return [...this.queue.values()].filter((e) => e.status === 'queued').length;
  }

  isFull(): boolean {
    return this.queue.size >= MAX_SLOTS;
  }
}
