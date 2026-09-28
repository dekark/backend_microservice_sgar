import {
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { AuthRepository } from './auth.repository';
import { GoogleTokenService } from './google-token.service';
import { publicUser } from './auth.types';
import type { AuthPrincipal, AuthUser, RequestMetadata } from './auth.types';
import { createRefreshToken, parseRefreshToken, UUID_PATTERN } from './tokens';

const EMPTY_METADATA: RequestMetadata = { ipAddress: null, userAgent: null };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    private readonly google: GoogleTokenService,
    private readonly repository: AuthRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private async response(
    user: AuthUser,
    sessionId: string,
    refreshToken: string,
    expiresAt: Date,
  ) {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      sid: sessionId,
      token_use: 'access',
    });
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS'),
      refreshExpiresAt: expiresAt.toISOString(),
      sessionId,
      user: publicUser(user),
    };
  }

  async loginWithGoogle(idToken: string, metadata = EMPTY_METADATA) {
    try {
      const identity = await this.google.verify(idToken);
      const secret = createRefreshToken();
      const sessionId = randomUUID();
      const expiresAt = new Date(
        Date.now() +
          this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_SECONDS') * 1000,
      );
      const user = await this.repository.login(
        identity,
        this.config.get<number>('AUTH_DEFAULT_ROLE_ID'),
        sessionId,
        { id: secret.id, hash: secret.hash },
        expiresAt,
        metadata,
      );
      return await this.response(user, sessionId, secret.value, expiresAt);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        await this.failure(
          'auth.login.failed',
          metadata,
          `http_${error.getStatus()}`,
        );
      }
      throw error;
    }
  }

  async refresh(value: string, metadata = EMPTY_METADATA) {
    try {
      const oldSecret = parseRefreshToken(value);
      const next = createRefreshToken();
      const result = await this.repository.rotate(
        oldSecret,
        { id: next.id, hash: next.hash },
        metadata,
      );
      if (!result)
        throw new UnauthorizedException(
          'Refresh token invalido, revocado o vencido',
        );
      return await this.response(
        result.user,
        result.sessionId,
        next.value,
        result.expiresAt,
      );
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        await this.failure(
          'auth.refresh.failed',
          metadata,
          'invalid_refresh_token',
        );
      }
      throw error;
    }
  }

  private async failure(
    action: string,
    metadata: RequestMetadata,
    reason: string,
  ) {
    try {
      await this.repository.recordFailure(action, metadata, reason);
    } catch {
      this.logger.error(
        'No se pudo persistir el evento de autenticacion fallida',
      );
    }
  }

  async authenticate(accessToken: string): Promise<AuthPrincipal> {
    let userId: string;
    let sessionId: string;
    try {
      const claims =
        await this.jwt.verifyAsync<Record<string, unknown>>(accessToken);
      if (
        claims.token_use !== 'access' ||
        typeof claims.exp !== 'number' ||
        typeof claims.sub !== 'string' ||
        !UUID_PATTERN.test(claims.sub) ||
        typeof claims.sid !== 'string' ||
        !UUID_PATTERN.test(claims.sid)
      )
        throw new Error('Claims invalidos');
      userId = claims.sub;
      sessionId = claims.sid;
    } catch {
      throw new UnauthorizedException('Token de acceso invalido o vencido');
    }
    const principal = await this.repository.findPrincipal(userId, sessionId);
    if (!principal) throw new UnauthorizedException('Sesion no disponible');
    if (!principal.user.isActive || !principal.user.roleIsActive) {
      throw new ForbiddenException('Usuario o rol inactivo');
    }
    return principal;
  }

  async profile(principal: AuthPrincipal) {
    return {
      ...publicUser(principal.user),
      permissions: await this.repository.permissionKeys(principal.user.id),
    };
  }
  async sessions(principal: AuthPrincipal) {
    const sessions = await this.repository.listSessions(principal.user.id);
    return sessions.map((session) => ({
      ...session,
      current: session.id === principal.sessionId,
    }));
  }
  async logout(principal: AuthPrincipal, metadata = EMPTY_METADATA) {
    await this.repository.revoke(
      principal.user.id,
      principal.sessionId,
      metadata,
      'auth.logout',
    );
  }
  async logoutAll(principal: AuthPrincipal, metadata = EMPTY_METADATA) {
    await this.repository.revoke(
      principal.user.id,
      undefined,
      metadata,
      'auth.logout_all',
    );
  }
  async revokeSession(
    principal: AuthPrincipal,
    sessionId: string,
    metadata = EMPTY_METADATA,
  ) {
    await this.repository.revoke(
      principal.user.id,
      sessionId,
      metadata,
      'auth.session.revoked',
    );
  }
}
