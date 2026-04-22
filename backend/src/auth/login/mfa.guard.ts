import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { MfaService } from '../mfa/mfa.service';

/**
 * #244 — MFA Guard
 *
 * Attach to any route that requires a valid TOTP token in addition to
 * a valid JWT. Reads the token from the x-mfa-token request header.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, MfaGuard)
 *   @Get('sensitive-route')
 *   sensitiveRoute() { ... }
 *
 * The user must already be authenticated (JWT validated) before this guard
 * runs. The user entity on req.user must have mfaSecret populated.
 */
@Injectable()
export class MfaGuard implements CanActivate {
  constructor(private readonly mfaService: MfaService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user    = request.user;

    // If MFA is not enabled for this user, let the request through
    if (!user?.mfaEnabled || !user?.mfaSecret) {
      return true;
    }

    const token = request.headers['x-mfa-token'] as string | undefined;
    if (!token) {
      throw new UnauthorizedException('auth.mfa_required');
    }

    // Throws UnauthorizedException internally if token is invalid
    this.mfaService.verifyToken(user.mfaSecret, token);
    return true;
  }
}