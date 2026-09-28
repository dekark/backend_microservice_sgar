import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { GoogleTokenService } from './google-token.service';
import { createRefreshToken } from './tokens';

describe('AuthService', () => {
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    name: 'User',
    roleId: 1,
    role: 'reader',
    areaId: null,
    isActive: true,
    roleIsActive: true,
  };
  const sessionId = '22222222-2222-4222-8222-222222222222';
  let service: AuthService;
  let repository: Record<string, jest.Mock>;
  let google: { verify: jest.Mock };
  let jwt: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  beforeEach(() => {
    repository = {
      login: jest.fn().mockResolvedValue(user),
      rotate: jest.fn(),
      findPrincipal: jest.fn().mockResolvedValue({ user, sessionId }),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      permissionKeys: jest.fn().mockResolvedValue(['resources.read']),
      listSessions: jest.fn().mockResolvedValue([{ id: sessionId }]),
      revoke: jest.fn(),
    };
    google = {
      verify: jest.fn().mockResolvedValue({
        sub: 'google-sub',
        email: user.email,
        name: user.name,
      }),
    };
    jwt = {
      signAsync: jest.fn().mockResolvedValue('access-token'),
      verifyAsync: jest.fn().mockResolvedValue({
        sub: user.id,
        sid: sessionId,
        token_use: 'access',
        exp: 9999999999,
      }),
    };
    service = new AuthService(
      google as unknown as GoogleTokenService,
      repository as unknown as AuthRepository,
      jwt as unknown as JwtService,
      new ConfigService({
        JWT_ACCESS_TTL_SECONDS: 900,
        REFRESH_TOKEN_TTL_SECONDS: 2592000,
      }),
    );
  });

  it('returns credentials but passes only the refresh hash to persistence', async () => {
    const result = await service.loginWithGoogle('google-token');
    expect(result).toMatchObject({
      accessToken: 'access-token',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(result.refreshToken).toMatch(/^[0-9a-f-]+\.[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(repository.login.mock.calls)).not.toContain(
      result.refreshToken,
    );
    expect(JSON.stringify(repository.login.mock.calls)).not.toContain(
      'google-token',
    );
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: user.id,
      sid: result.sessionId,
      token_use: 'access',
    });
  });
  it('records a failed Google login without persisting credentials', async () => {
    google.verify.mockRejectedValue(new UnauthorizedException());
    await expect(service.loginWithGoogle('sensitive')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repository.login).not.toHaveBeenCalled();
    expect(repository.recordFailure).toHaveBeenCalledWith(
      'auth.login.failed',
      { ipAddress: null, userAgent: null },
      'http_401',
    );
  });
  it('rejects blocked registration without issuing credentials', async () => {
    repository.login.mockRejectedValue(new ForbiddenException());
    await expect(service.loginWithGoogle('token')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
  it('rotates an opaque token and preserves the session expiry', async () => {
    const old = createRefreshToken();
    const expiresAt = new Date(Date.now() + 60000);
    repository.rotate.mockResolvedValue({ user, sessionId, expiresAt });
    const result = await service.refresh(old.value);
    expect(result.refreshToken).not.toBe(old.value);
    expect(result.refreshExpiresAt).toBe(expiresAt.toISOString());
    expect(repository.rotate).toHaveBeenCalledWith(
      { id: old.id, hash: old.hash },
      expect.objectContaining({
        id: expect.any(String) as unknown,
        hash: expect.any(String) as unknown,
      }),
      { ipAddress: null, userAgent: null },
    );
  });
  it('rejects malformed refresh input without looking up credentials', async () => {
    await expect(service.refresh('invalid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repository.rotate).not.toHaveBeenCalled();
  });
  it('rejects revoked/expired refresh tokens', async () => {
    repository.rotate.mockResolvedValue(null);
    await expect(
      service.refresh(createRefreshToken().value),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });
  it.each(['isActive', 'roleIsActive'])(
    'checks %s on every request',
    async (key) => {
      repository.findPrincipal.mockResolvedValue({
        user: { ...user, [key]: false },
        sessionId,
      });
      await expect(service.authenticate('token')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );
  it('rejects revoked or expired sessions', async () => {
    repository.findPrincipal.mockResolvedValue(undefined);
    await expect(service.authenticate('token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it.each([
    { sub: 'invalid', sid: sessionId, token_use: 'access', exp: 9999999999 },
    { sub: user.id, sid: 'invalid', token_use: 'access', exp: 9999999999 },
    { sub: user.id, token_use: 'access', exp: 9999999999 },
    { sub: user.id, sid: sessionId, token_use: 'refresh', exp: 9999999999 },
    { sub: user.id, sid: sessionId, token_use: 'access' },
  ])('rejects invalid JWT claims', async (claims) => {
    jwt.verifyAsync.mockResolvedValue(claims);
    await expect(service.authenticate('token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repository.findPrincipal).not.toHaveBeenCalled();
  });
  it('keeps database errors distinguishable from authentication rejection', async () => {
    repository.findPrincipal.mockRejectedValue(new Error('unavailable'));
    await expect(service.authenticate('token')).rejects.toThrow('unavailable');
  });
  it('returns current permissions and identifies the current session', async () => {
    const principal = { user, sessionId };
    expect(await service.profile(principal)).toMatchObject({
      permissions: ['resources.read'],
    });
    expect(await service.sessions(principal)).toEqual([
      { id: sessionId, current: true },
    ]);
  });
});
