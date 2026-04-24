import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { WaitlistVerificationToken } from './waitlist-verification-token.entity';

export enum WaitlistStatus {
  PENDING = 'pending',
  NOTIFIED = 'notified',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

@Entity('waitlist')
export class Waitlist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  name: string;

  @Column({ default: false })
  emailVerified: boolean;

  @Column({
    type: 'enum',
    enum: WaitlistStatus,
    default: WaitlistStatus.PENDING,
  })
  status: WaitlistStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  notifiedAt: Date;

  @OneToMany(() => WaitlistVerificationToken, (token) => token.waitlist, {
    cascade: true,
  })
  verificationTokens: WaitlistVerificationToken[];
}
