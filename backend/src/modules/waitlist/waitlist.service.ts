import { Injectable, Logger, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Waitlist, WaitlistStatus } from './entities/waitlist.entity';
import { WaitlistVerificationToken } from './entities/waitlist-verification-token.entity';
import { generateRefreshToken, hashToken } from '../../auth/utils/tokens';

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);
  private readonly VERIFICATION_TOKEN_TTL_HOURS = 24;

  constructor(
    @InjectRepository(Waitlist)
    private readonly waitlistRepo: Repository<Waitlist>,
    @InjectRepository(WaitlistVerificationToken)
    private readonly verificationTokenRepo: Repository<WaitlistVerificationToken>,
  ) {}

  async join(email: string, name?: string): Promise<{ id: string; email: string; emailVerified: boolean }> {
    const existing = await this.waitlistRepo.findOne({ where: { email } });
    if (existing) {
      if (existing.emailVerified) {
        throw new ConflictException('Email already on waitlist');
      }
      // Resend verification if email not verified
      await this.sendVerificationEmail(existing);
      return { id: existing.id, email: existing.email, emailVerified: false };
    }

    const entry = this.waitlistRepo.create({
      email,
      name,
      status: WaitlistStatus.PENDING,
      emailVerified: false,
    });

    const saved = await this.waitlistRepo.save(entry);
    this.logger.log(`New user joined waitlist: ${email}`);

    await this.sendVerificationEmail(saved);

    return { id: saved.id, email: saved.email, emailVerified: false };
  }

  async verifyEmail(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    const stored = await this.verificationTokenRepo.findOne({
      where: { tokenHash },
      relations: ['waitlist'],
    });

    if (!stored || stored.consumedAt) {
      throw new BadRequestException('Verification token invalid');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Verification token expired');
    }

    stored.consumedAt = new Date();
    await this.verificationTokenRepo.save(stored);

    const waitlist = stored.waitlist;
    waitlist.emailVerified = true;
    await this.waitlistRepo.save(waitlist);

    this.logger.log(`Email verified for waitlist: ${waitlist.email}`);

    // Send welcome notification after verification
    await this.sendNotification(waitlist, 'Welcome to LuminaryTrade Waitlist!');
  }

  async getStatusByEmail(email: string): Promise<Waitlist | null> {
    return this.waitlistRepo.findOne({ where: { email } });
  }

  async findAll(): Promise<Waitlist[]> {
    return this.waitlistRepo.find({ order: { createdAt: 'DESC' } });
  }

  async notifyUser(id: string): Promise<Waitlist> {
    const entry = await this.waitlistRepo.findOne({ where: { id } });
    if (!entry) {
      throw new Error('Waitlist entry not found');
    }

    await this.sendNotification(entry, 'You have been invited to join LuminaryTrade!');

    entry.status = WaitlistStatus.NOTIFIED;
    entry.notifiedAt = new Date();

    return this.waitlistRepo.save(entry);
  }

  private async sendVerificationEmail(waitlist: Waitlist): Promise<void> {
    const token = generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);

    const verificationToken = this.verificationTokenRepo.create({
      waitlistId: waitlist.id,
      tokenHash: hashToken(token),
      expiresAt,
    });

    await this.verificationTokenRepo.save(verificationToken);

    // In production, this would send an actual email with the verification link
    const verificationLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/waitlist?token=${token}`;
    this.logger.log(`[VERIFICATION EMAIL] To: ${waitlist.email}, Link: ${verificationLink}`);
    console.log(`WAITLIST VERIFICATION: ${waitlist.email} - ${verificationLink}`);
  }

  private async sendNotification(entry: Waitlist, message: string): Promise<void> {
    this.logger.log(`[NOTIFICATION] Sending to ${entry.email}: ${message}`);
    console.log(`WAITLIST NOTIFICATION: ${entry.email} - ${message}`);
  }
}
