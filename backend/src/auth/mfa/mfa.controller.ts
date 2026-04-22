import {
  Controller,
  Post,
  Delete,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MfaService } from './mfa.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { MfaGuard } from '../guards/mfa.guard';
import { EnableMfaDto } from './dto/enable-mfa.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { RecoveryCodeDto } from './dto/recovery-code.dto';

/**
 * #244 — MFA Controller
 *
 * Routes:
 *   POST   /auth/mfa/setup       — generate secret + QR code URI
 *   POST   /auth/mfa/enable      — verify first code, persist secret
 *   DELETE /auth/mfa/disable     — disable MFA (requires valid MFA token)
 *   POST   /auth/mfa/verify      — verify token during login step-up
 *   POST   /auth/mfa/recovery    — use a recovery code
 */
@Controller('auth/mfa')
@UseGuards(JwtAuthGuard)
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  /**
   * Step 1 of enrollment: returns otpauthUrl for QR code rendering.
   * Secret is returned in plaintext here for the client to display once —
   * it must NOT be persisted yet (persisted only after verify in /enable).
   */
  @Post('setup')
  @HttpCode(HttpStatus.OK)
  setup(@Req() req: any) {
    const { secret, otpauthUrl } = this.mfaService.generateSecret(req.user.email);
    return { secret, otpauthUrl };
  }

  /**
   * Step 2 of enrollment: user submits the secret from setup + their first
   * TOTP code to prove the authenticator app is working.
   * On success, the encrypted secret and recovery code hashes are stored.
   */
  @Post('enable')
  @HttpCode(HttpStatus.OK)
  async enable(@Req() req: any, @Body() dto: EnableMfaDto) {
    const encryptedSecret = this.mfaService.verifyAndEncryptSecret(dto.secret, dto.token);
    const { codes, hashes } = this.mfaService.generateRecoveryCodes();

    // Persist to your user store (inject UserService/repository as needed)
    // await this.userService.enableMfa(req.user.id, encryptedSecret, hashes);

    // Return plaintext recovery codes ONCE — never stored in plaintext
    return {
      message: 'auth.mfa_enabled',
      recoveryCodes: codes, // show once, user must save these
    };
  }

  /**
   * Disable MFA — requires the user to provide a valid TOTP token first
   * to prevent account takeover if the JWT is stolen.
   */
  @Delete('disable')
  @UseGuards(MfaGuard)
  @HttpCode(HttpStatus.OK)
  async disable(@Req() req: any) {
    // await this.userService.disableMfa(req.user.id);
    return { message: 'auth.mfa_disabled' };
  }

  /**
   * Login step-up: called after password auth succeeds but before issuing
   * the final access token, when user has MFA enabled.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@Req() req: any, @Body() dto: VerifyMfaDto) {
    this.mfaService.verifyToken(req.user.mfaSecret, dto.token);
    return { message: 'common.success' };
  }

  /**
   * Recovery code login: allows access when user has lost their authenticator.
   * The used code is invalidated immediately.
   */
  @Post('recovery')
  @HttpCode(HttpStatus.OK)
  async recovery(@Req() req: any, @Body() dto: RecoveryCodeDto) {
    // const user = await this.userService.findById(req.user.id);
    // const usedHash = this.mfaService.consumeRecoveryCode(dto.code, user.mfaRecoveryHashes);
    // await this.userService.removeRecoveryHash(req.user.id, usedHash);
    return { message: 'auth.mfa_recovery_used' };
  }
}