import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import * as crypto from 'crypto';

/**
 * #244 — MFA Service
 *
 * Implements TOTP-based multi-factor authentication using the otplib library
 * (RFC 6238 compliant, compatible with Google Authenticator, Authy, etc.)
 *
 * Secrets are encrypted at rest using AES-256-GCM before being stored.
 * The encryption key is read from MFA_ENCRYPTION_KEY env var (32-byte hex).
 *
 * Install dependency:  npm install otplib
 */
@Injectable()
export class MfaService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly encryptionKey: Buffer;

  constructor(private readonly config: ConfigService) {
    const keyHex = this.config.get<string>('MFA_ENCRYPTION_KEY');
    if (!keyHex || keyHex.length !== 64) {
      throw new Error('MFA_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
    }
    this.encryptionKey = Buffer.from(keyHex, 'hex');

    // Configure TOTP: 6-digit code, 30-second window, allow 1 step drift
    authenticator.options = {
      digits: 6,
      step: 30,
      window: 1,
    };
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  /**
   * Generates a new TOTP secret and QR code URI for the user.
   * Call this when the user initiates MFA enrollment.
   * The secret must NOT be persisted until the user verifies their first code.
   */
  generateSecret(userEmail: string): { secret: string; otpauthUrl: string } {
    const secret = authenticator.generateSecret(20); // 20-byte = 160-bit entropy
    const otpauthUrl = authenticator.keyuri(userEmail, 'LuminaryTrade', secret);
    return { secret, otpauthUrl };
  }

  /**
   * Verifies the user's first TOTP code after scanning the QR code.
   * Returns the encrypted secret to persist in the database if valid.
   * Throws if the code is wrong.
   */
  verifyAndEncryptSecret(plainSecret: string, token: string): string {
    const isValid = authenticator.verify({ token, secret: plainSecret });
    if (!isValid) {
      throw new UnauthorizedException('auth.mfa_invalid');
    }
    return this.encryptSecret(plainSecret);
  }

  // ---------------------------------------------------------------------------
  // Verification
  // ---------------------------------------------------------------------------

  /**
   * Verifies a TOTP token against the user's stored encrypted secret.
   * Throws UnauthorizedException if invalid.
   */
  verifyToken(encryptedSecret: string, token: string): void {
    const plainSecret = this.decryptSecret(encryptedSecret);
    const isValid = authenticator.verify({ token, secret: plainSecret });
    if (!isValid) {
      throw new UnauthorizedException('auth.mfa_invalid');
    }
  }

  // ---------------------------------------------------------------------------
  // Recovery codes
  // ---------------------------------------------------------------------------

  /**
   * Generates 10 single-use recovery codes.
   * Returns both the plaintext codes (show once to user) and their SHA-256
   * hashes (store in database).
   */
  generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
    const codes = Array.from({ length: 10 }, () =>
      crypto.randomBytes(5).toString('hex').toUpperCase(), // e.g. "A3F9C1B2E4"
    );
    const hashes = codes.map(code =>
      crypto.createHash('sha256').update(code).digest('hex'),
    );
    return { codes, hashes };
  }

  /**
   * Checks if a submitted recovery code matches any stored hash.
   * Returns the matched hash so the caller can mark it as used in the DB.
   * Throws BadRequestException if no match found.
   */
  consumeRecoveryCode(submittedCode: string, storedHashes: string[]): string {
    const normalized = submittedCode.trim().toUpperCase();
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    const matched = storedHashes.find(h => h === hash);
    if (!matched) {
      throw new BadRequestException('auth.mfa_invalid');
    }
    return matched; // caller deletes this hash from DB
  }

  // ---------------------------------------------------------------------------
  // Encryption helpers (AES-256-GCM)
  // ---------------------------------------------------------------------------

  private encryptSecret(plaintext: string): string {
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Store as: iv(hex):authTag(hex):ciphertext(hex)
    return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
  }

  private decryptSecret(stored: string): string {
    const parts = stored.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted secret format');

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv       = Buffer.from(ivHex, 'hex');
    const authTag  = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  }
}