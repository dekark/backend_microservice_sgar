import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthSessionService } from './auth-session.service';
import type { AuthenticatedRequest } from './security.types';

@Injectable()
export class AuthSessionGuard implements CanActivate {
  constructor(private readonly sessions: AuthSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    if (!match || match[1].length > 16384) {
      throw new UnauthorizedException(
        'Se requiere Authorization: Bearer <token>',
      );
    }
    request.user = await this.sessions.authenticate(match[1]);
    return true;
  }
}
