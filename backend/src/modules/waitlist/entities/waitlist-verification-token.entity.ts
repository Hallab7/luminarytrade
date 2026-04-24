import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  ManyToOne,
} from 'typeorm';
import { Waitlist } from './waitlist.entity';

@Entity('waitlist_verification_tokens')
@Index(['tokenHash'], { unique: true })
@Index(['waitlistId'])
export class WaitlistVerificationToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  waitlistId: string;

  @Column()
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Waitlist, (waitlist) => waitlist.id, {
    onDelete: 'CASCADE',
  })
  waitlist: Waitlist;
}
