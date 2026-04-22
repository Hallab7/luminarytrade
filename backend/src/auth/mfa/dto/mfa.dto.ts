import { IsString, Length, Matches } from 'class-validator';

/**
 * #244 — DTOs for MFA endpoints
 */

/** POST /auth/mfa/enable */
export class EnableMfaDto {
  @IsString()
  secret: string; // plaintext secret from /setup response

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'token must be a 6-digit number' })
  token: string;
}

/** POST /auth/mfa/verify */
export class VerifyMfaDto {
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'token must be a 6-digit number' })
  token: string;
}

/** POST /auth/mfa/recovery */
export class RecoveryCodeDto {
  @IsString()
  @Length(10, 10)
  @Matches(/^[A-F0-9]{10}$/, { message: 'code must be a 10-char hex recovery code' })
  code: string;
}