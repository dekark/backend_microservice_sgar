import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  and,
  eq,
  roles,
  users,
  permissions,
  rolePermissions,
  userSessions,
  refreshTokens,
  authOutbox,
  sql,
} from 'database';
import { AuthRepository } from '../src/auth/auth.repository';
import { AuthService } from '../src/auth/auth.service';
import { GoogleTokenService } from '../src/auth/google-token.service';
import { AuthJobsService } from '../src/auth/auth-jobs.service';
import { AuthEventsPublisher } from '../src/auth/auth-events.publisher';
import { validateEnvironment } from '../src/config/environment';
import { createRefreshToken } from '../src/auth/tokens';

// Never fall back to DATABASE_URL/.env: this suite resets an explicitly disposable local DB.
const databaseUrl = process.env.AUTH_TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    'Set AUTH_TEST_DATABASE_URL to the disposable PostgreSQL test container',
  );
const target = new URL(databaseUrl);
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  target.pathname !== '/auth_test' ||
  target.password !== 'auth-local-test-only'
) {
  throw new Error(
    'Integration tests require the isolated local auth_test database',
  );
}

describe('Authentication transactions on PostgreSQL', () => {
  let repository: AuthRepository;
  let service: AuthService;
  let config: ConfigService;
  let roleId: number;
  const google = { verify: jest.fn() };
  const metadata = { ipAddress: '127.0.0.1', userAgent: 'integration-test' };
  const identity = {
    sub: 'alice-google-id',
    email: 'alice@example.com',
    name: 'Alice',
  };

  beforeAll(async () => {
    config = new ConfigService(
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        GOOGLE_CLIENT_ID: 'test-client',
        JWT_SECRET: 'local-tests-only-secret-'.repeat(3),
        AUTH_BACKGROUND_JOBS_ENABLED: false,
      }),
    );
    config.skipProcessEnv = true;
    repository = new AuthRepository(config);
    const present = await repository.db.execute(
      sql`select to_regclass('public.users') as name`,
    );
    if (!(present.rows[0] as { name: string | null }).name) {
      for (const migration of [
        '0000_silky_mandroid.sql',
        '0001_auth_sessions_outbox.sql',
      ]) {
        const source = readFileSync(
          resolve(__dirname, '../../database/drizzle', migration),
          'utf8',
        );
        await repository.db.execute(sql.raw(source));
      }
    }
    const jwt = new JwtService({
      secret: config.getOrThrow<string>('JWT_SECRET'),
      signOptions: {
        algorithm: 'HS256',
        expiresIn: 900,
        issuer: 'auth-service',
        audience: 'backend-api',
      },
      verifyOptions: {
        algorithms: ['HS256'],
        issuer: 'auth-service',
        audience: 'backend-api',
      },
    });
    service = new AuthService(
      google as unknown as GoogleTokenService,
      repository,
      jwt,
      config,
    );
  });

  beforeEach(async () => {
    await repository.db.execute(
      sql.raw(
        'TRUNCATE TABLE auth_outbox, refresh_tokens, user_sessions, users, role_permissions, permissions, roles RESTART IDENTITY CASCADE',
      ),
    );
    const [role] = await repository.db
      .insert(roles)
      .values({ name: 'reader' })
      .returning();
    roleId = role.id;
    config.set('AUTH_DEFAULT_ROLE_ID', roleId);
    google.verify.mockResolvedValue(identity);
  });
  afterAll(async () => {
    await repository?.onApplicationShutdown();
  });

  const login = () => service.loginWithGoogle('google-id-token', metadata);

  it('creates user, session, hashed refresh token and durable events together', async () => {
    const credentials = await login();
    const stored = await repository.db.select().from(refreshTokens);
    expect(stored).toHaveLength(1);
    expect(stored[0].sessionId).toBe(credentials.sessionId);
    expect(stored[0].tokenHash).not.toBe(credentials.refreshToken);
    const events = await repository.db.select().from(authOutbox);
    expect(events).toHaveLength(4);
    expect(new Set(events.map((event) => event.destination))).toEqual(
      new Set(['kafka', 'rabbit']),
    );
    expect(JSON.stringify(events)).not.toContain(credentials.refreshToken);
    expect(JSON.stringify(events)).not.toContain(credentials.accessToken);
    expect(JSON.stringify(events)).not.toContain('google-id-token');
    const principal = await service.authenticate(credentials.accessToken);
    expect(principal.user.email).toBe(identity.email);
  });

  it('does not duplicate a Google account on concurrent logins', async () => {
    await Promise.all([login(), login()]);
    expect(await repository.db.select().from(users)).toHaveLength(1);
    expect(await repository.db.select().from(userSessions)).toHaveLength(2);
    const events = await repository.db.select().from(authOutbox);
    expect(
      events.filter((row) => row.payload.action === 'auth.user.registered'),
    ).toHaveLength(2);
  });
  it('does not link a different Google subject using the same email', async () => {
    await login();
    google.verify.mockResolvedValue({
      ...identity,
      sub: 'different-google-id',
    });
    await expect(login()).rejects.toMatchObject({ status: 409 });
    expect(await repository.db.select().from(users)).toHaveLength(1);
    expect(await repository.db.select().from(userSessions)).toHaveLength(1);
  });

  it('blocks enrollment without a configured role but allows existing accounts', async () => {
    const first = await login();
    config.set('AUTH_DEFAULT_ROLE_ID', undefined);
    await expect(login()).resolves.toMatchObject({
      user: { id: first.user.id },
    });
    google.verify.mockResolvedValue({
      sub: 'new-id',
      email: 'new@example.com',
      name: 'New',
    });
    await expect(login()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rotates refresh credentials and preserves the absolute expiration', async () => {
    const first = await login();
    const second = await service.refresh(first.refreshToken, metadata);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.refreshExpiresAt).toBe(first.refreshExpiresAt);
    expect(await service.authenticate(second.accessToken)).toBeDefined();
    const stored = await repository.db.select().from(refreshTokens);
    expect(stored.filter((token) => token.revokedAt)).toHaveLength(1);
  });

  it('revokes the entire session after reuse, including the latest credentials', async () => {
    const first = await login();
    const second = await service.refresh(first.refreshToken);
    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      service.authenticate(second.accessToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refresh(second.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const events = await repository.db.select().from(authOutbox);
    expect(
      events.some(
        (row) => row.payload.action === 'auth.refresh.reuse_detected',
      ),
    ).toBe(true);
  });

  it('serializes concurrent refresh attempts and revokes the replayed family', async () => {
    const first = await login();
    const attempts = await Promise.allSettled([
      service.refresh(first.refreshToken),
      service.refresh(first.refreshToken),
    ]);
    expect(
      attempts.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      attempts.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const [session] = await repository.db.select().from(userSessions);
    expect(session.isActive).toBe(false);
    const active = await repository.db.select().from(refreshTokens);
    expect(active.every((token) => token.revokedAt !== null)).toBe(true);
  });

  it('does not revoke a session when the token ID is known but its secret is wrong', async () => {
    const first = await login();
    const forged = first.refreshToken.split('.')[0] + '.' + 'a'.repeat(43);
    await expect(service.refresh(forged)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.refresh(first.refreshToken)).resolves.toBeDefined();
  });

  it('checks expiration on both sessions and refresh credentials', async () => {
    const first = await login();
    await repository.db
      .update(userSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(
      service.authenticate(first.accessToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const second = await login();
    await repository.db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.sessionId, second.sessionId));
    await expect(service.refresh(second.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('revokes access and refresh credentials on logout', async () => {
    const first = await login();
    const principal = await service.authenticate(first.accessToken);
    await service.logout(principal);
    await expect(
      service.authenticate(first.accessToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('logout-all wins against a concurrent refresh and revokes every session', async () => {
    const first = await login();
    const second = await login();
    const principal = await service.authenticate(first.accessToken);
    await Promise.allSettled([
      service.refresh(second.refreshToken),
      service.logoutAll(principal),
    ]);
    const sessions = await repository.db.select().from(userSessions);
    expect(sessions.every((session) => !session.isActive)).toBe(true);
    await expect(
      service.authenticate(first.accessToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.authenticate(second.accessToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows revoking another owned device while keeping the current one active', async () => {
    const first = await login();
    const second = await login();
    const principal = await service.authenticate(first.accessToken);
    const sessions = await service.sessions(principal);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
    await service.revokeSession(principal, second.sessionId);
    await expect(
      service.authenticate(first.accessToken),
    ).resolves.toBeDefined();
    await expect(
      service.authenticate(second.accessToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not let a user revoke another user session', async () => {
    const alice = await login();
    google.verify.mockResolvedValue({
      sub: 'bob-google-id',
      email: 'bob@example.com',
      name: 'Bob',
    });
    const bob = await login();
    const principal = await service.authenticate(alice.accessToken);
    await expect(
      service.revokeSession(principal, bob.sessionId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.authenticate(bob.accessToken)).resolves.toBeDefined();
  });

  it.each(['user', 'role'])(
    'rejects disabled %s and revokes the session on refresh',
    async (kind) => {
      const first = await login();
      if (kind === 'user')
        await repository.db.update(users).set({ isActive: false });
      else await repository.db.update(roles).set({ isActive: false });
      await expect(
        service.authenticate(first.accessToken),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      const [session] = await repository.db.select().from(userSessions);
      expect(session.isActive).toBe(false);
    },
  );

  it('reads current active permissions instead of trusting stale JWT claims', async () => {
    const first = await login();
    const principal = await service.authenticate(first.accessToken);
    const [permission] = await repository.db
      .insert(permissions)
      .values({ key: 'resources.read', name: 'Read', module: 'resources' })
      .returning();
    await repository.db
      .insert(rolePermissions)
      .values({ roleId, permissionId: permission.id });
    expect(await service.profile(principal)).toMatchObject({
      permissions: ['resources.read'],
    });
    await repository.db.update(permissions).set({ isActive: false });
    expect(await service.profile(principal)).toMatchObject({ permissions: [] });
  });

  it('rolls back login and enrollment if the outbox insert fails', async () => {
    await repository.db.execute(
      sql.raw(
        "ALTER TABLE auth_outbox ADD CONSTRAINT test_reject_event CHECK (payload->>'action' <> 'auth.login.succeeded')",
      ),
    );
    try {
      const secret = createRefreshToken();
      await expect(
        repository.login(
          identity,
          roleId,
          randomUUID(),
          secret,
          new Date(Date.now() + 60000),
          metadata,
        ),
      ).rejects.toThrow();
      expect(await repository.db.select().from(users)).toHaveLength(0);
      expect(await repository.db.select().from(userSessions)).toHaveLength(0);
      expect(await repository.db.select().from(refreshTokens)).toHaveLength(0);
      expect(await repository.db.select().from(authOutbox)).toHaveLength(0);
    } finally {
      await repository.db.execute(
        sql.raw('ALTER TABLE auth_outbox DROP CONSTRAINT test_reject_event'),
      );
    }
  });

  it('rolls back rotation if its audit event cannot be recorded', async () => {
    const first = await login();
    await repository.db.execute(
      sql.raw(
        "ALTER TABLE auth_outbox ADD CONSTRAINT test_reject_refresh CHECK (payload->>'action' <> 'auth.token.refreshed')",
      ),
    );
    try {
      await expect(service.refresh(first.refreshToken)).rejects.toThrow();
    } finally {
      await repository.db.execute(
        sql.raw('ALTER TABLE auth_outbox DROP CONSTRAINT test_reject_refresh'),
      );
    }
    await expect(service.refresh(first.refreshToken)).resolves.toBeDefined();
  });

  it('leases pending deliveries so concurrent workers do not claim the same rows', async () => {
    await login();
    const batches = await Promise.all([
      repository.claimDeliveries(),
      repository.claimDeliveries(),
    ]);
    const ids = batches.flat().map((row) => row.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    const row = batches.flat()[0];
    await repository.delivered(row.id, randomUUID());
    const [stillPending] = await repository.db
      .select()
      .from(authOutbox)
      .where(eq(authOutbox.id, row.id));
    expect(stillPending.publishedAt).toBeNull();
    await repository.db
      .update(authOutbox)
      .set({ lockedUntil: new Date(Date.now() - 1000) });
    expect(await repository.claimDeliveries()).toHaveLength(4);
  });

  it('retries failed Kafka deliveries independently of successful RabbitMQ deliveries', async () => {
    await login();
    const publisher = {
      publish: jest.fn((destination: string) =>
        destination === 'kafka'
          ? Promise.reject(new Error('offline'))
          : Promise.resolve(),
      ),
    };
    const worker = new AuthJobsService(
      repository,
      publisher as unknown as AuthEventsPublisher,
      config,
    );
    await worker.tick();
    const events = await repository.db.select().from(authOutbox);
    expect(
      events
        .filter((row) => row.destination === 'rabbit')
        .every((row) => row.publishedAt),
    ).toBe(true);
    expect(
      events
        .filter((row) => row.destination === 'kafka')
        .every((row) => !row.publishedAt && row.attempts === 1),
    ).toBe(true);
    publisher.publish.mockImplementation(() => Promise.resolve());
    await repository.db
      .update(authOutbox)
      .set({ availableAt: new Date(Date.now() - 1000) });
    await worker.tick();
    expect(
      (await repository.db.select().from(authOutbox)).every(
        (row) => row.publishedAt,
      ),
    ).toBe(true);
  });

  it('cleans only expired sessions beyond retention and keeps pending messages', async () => {
    const first = await login();
    const second = await login();
    await repository.db
      .update(userSessions)
      .set({ expiresAt: new Date(Date.now() - 40 * 86400000) })
      .where(eq(userSessions.id, first.sessionId));
    await repository.cleanup(30);
    expect(await repository.db.select().from(userSessions)).toHaveLength(1);
    const tokens = await repository.db.select().from(refreshTokens);
    expect(tokens.every((token) => token.sessionId === second.sessionId)).toBe(
      true,
    );
    expect(await repository.db.select().from(authOutbox)).toHaveLength(6);
  });

  it('does not accept legacy refresh tokens without a session relationship', async () => {
    const first = await login();
    await repository.db
      .update(refreshTokens)
      .set({ sessionId: null })
      .where(
        and(
          eq(refreshTokens.userId, first.user.id),
          eq(refreshTokens.sessionId, first.sessionId),
        ),
      );
    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
