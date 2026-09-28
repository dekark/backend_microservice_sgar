import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  and,
  or,
  eq,
  gt,
  lt,
  isNull,
  inArray,
  asc,
  desc,
  createTransactionalDatabase,
  roles,
  users,
  permissions,
  rolePermissions,
  refreshTokens,
  userSessions,
  authOutbox,
  sql,
} from 'database';
import type {
  AuthEvent,
  DatabaseTransaction,
  TransactionalDatabase,
} from 'database';
import type {
  AuthUser,
  GoogleIdentity,
  RefreshSecret,
  RequestMetadata,
} from './auth.types';
import { sameHash } from './tokens';

type Executor = TransactionalDatabase | DatabaseTransaction;
const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  roleId: users.roleId,
  role: roles.name,
  areaId: users.areaId,
  isActive: users.isActive,
  roleIsActive: roles.isActive,
};

@Injectable()
export class AuthRepository implements OnApplicationShutdown {
  private readonly connection: ReturnType<typeof createTransactionalDatabase>;
  private readonly logger = new Logger(AuthRepository.name);
  readonly db: TransactionalDatabase;

  constructor(config: ConfigService) {
    this.connection = createTransactionalDatabase(
      config.getOrThrow<string>('DATABASE_URL'),
    );
    this.connection.pool.on('error', () =>
      this.logger.error('PostgreSQL pool connection error'),
    );
    this.db = this.connection.db;
  }
  async onApplicationShutdown() {
    await this.connection.pool.end();
  }

  async ping(): Promise<void> {
    // Validate the migration-dependent columns as well as connectivity.
    await this.db.execute(
      sql`select o.id, s.expires_at, r.session_id from auth_outbox o, user_sessions s, refresh_tokens r limit 0`,
    );
  }

  private async findUser(
    db: Executor,
    id: string,
  ): Promise<AuthUser | undefined> {
    const [user] = await db
      .select(userColumns)
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, id))
      .limit(1);
    return user;
  }
  private async lockUser(tx: DatabaseTransaction, id: string) {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .for('update');
  }
  private assertActive(user: AuthUser | undefined): asserts user is AuthUser {
    if (!user || !user.isActive || !user.roleIsActive) {
      throw new ForbiddenException('Usuario o rol inactivo');
    }
  }
  private async enqueue(
    tx: Executor,
    action: string,
    userId: string | null,
    sessionId: string | null,
    metadata: RequestMetadata,
    reason?: string,
  ) {
    const event: AuthEvent = {
      eventId: randomUUID(),
      version: 1,
      source: 'auth-service',
      action,
      occurredAt: new Date().toISOString(),
      userId,
      sessionId,
      ...metadata,
      ...(reason ? { reason } : {}),
    };
    await tx.insert(authOutbox).values(
      (['kafka', 'rabbit'] as const).map((destination) => ({
        eventId: event.eventId,
        destination,
        payload: event,
      })),
    );
  }

  async login(
    identity: GoogleIdentity,
    defaultRoleId: number | undefined,
    sessionId: string,
    secret: RefreshSecret,
    expiresAt: Date,
    metadata: RequestMetadata,
  ) {
    return this.db.transaction(async (tx) => {
      let [account] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.googleSub, identity.sub))
        .limit(1);
      let registered = false;
      if (!account) {
        const [existingByEmail] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, identity.email))
          .limit(1);

        if (existingByEmail) {
          await tx
            .update(users)
            .set({ googleSub: identity.sub, name: identity.name })
            .where(eq(users.id, existingByEmail.id));
          account = existingByEmail;
        } else {
          if (!defaultRoleId)
            throw new ForbiddenException('El registro no esta habilitado');
          const [role] = await tx
            .select({ id: roles.id })
            .from(roles)
            .where(and(eq(roles.id, defaultRoleId), eq(roles.isActive, true)))
            .for('share');
          if (!role)
            throw new ForbiddenException('El rol de registro no esta disponible');
          const inserted = await tx
            .insert(users)
            .values({
              googleSub: identity.sub,
              email: identity.email,
              name: identity.name,
              roleId: defaultRoleId,
            })
            .onConflictDoNothing()
            .returning({ id: users.id });
          registered = inserted.length > 0;
          [account] = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.googleSub, identity.sub))
            .limit(1);
          if (!account)
            throw new ConflictException('No se pudo registrar esta identidad');
        }
      }
      // All session mutations for one user take this lock, including logout-all.
      await this.lockUser(tx, account.id);
      const user = await this.findUser(tx, account.id);
      this.assertActive(user);
      const now = new Date();
      await tx.insert(userSessions).values({
        id: sessionId,
        userId: user.id,
        expiresAt,
        ...metadata,
      });
      await tx.insert(refreshTokens).values({
        id: secret.id,
        tokenHash: secret.hash,
        userId: user.id,
        sessionId,
        expiresAt,
      });
      await tx
        .update(users)
        .set({ lastLoginAt: now, updatedAt: now })
        .where(eq(users.id, user.id));
      if (registered)
        await this.enqueue(
          tx,
          'auth.user.registered',
          user.id,
          sessionId,
          metadata,
        );
      await this.enqueue(
        tx,
        'auth.login.succeeded',
        user.id,
        sessionId,
        metadata,
      );
      return user;
    });
  }

  async rotate(
    oldSecret: RefreshSecret,
    next: RefreshSecret,
    metadata: RequestMetadata,
  ) {
    return this.db.transaction(async (tx) => {
      const [candidate] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.id, oldSecret.id))
        .limit(1);
      if (
        !candidate ||
        !candidate.sessionId ||
        !sameHash(candidate.tokenHash, oldSecret.hash)
      )
        return null;
      await this.lockUser(tx, candidate.userId);
      const [token] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.id, candidate.id));
      const [session] = await tx
        .select()
        .from(userSessions)
        .where(
          and(
            eq(userSessions.id, candidate.sessionId),
            eq(userSessions.userId, candidate.userId),
          ),
        );
      const now = new Date();
      if (!token || !session || !session.isActive || session.expiresAt <= now)
        return null;
      if (token.revokedAt) {
        // Commit the revocation before returning an error to the client.
        await this.revokeInTransaction(tx, candidate.userId, session.id, now);
        await this.enqueue(
          tx,
          'auth.refresh.reuse_detected',
          candidate.userId,
          session.id,
          metadata,
        );
        return null;
      }
      if (token.expiresAt <= now) return null;
      const user = await this.findUser(tx, candidate.userId);
      if (!user || !user.isActive || !user.roleIsActive) {
        await this.revokeInTransaction(tx, candidate.userId, session.id, now);
        await this.enqueue(
          tx,
          'auth.session.revoked',
          candidate.userId,
          session.id,
          metadata,
          'account_inactive',
        );
        return null;
      }
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(eq(refreshTokens.id, token.id));
      await tx.insert(refreshTokens).values({
        id: next.id,
        tokenHash: next.hash,
        userId: user.id,
        sessionId: session.id,
        expiresAt: session.expiresAt,
      });
      await tx
        .update(userSessions)
        .set({ lastActiveAt: now })
        .where(eq(userSessions.id, session.id));
      await this.enqueue(
        tx,
        'auth.token.refreshed',
        user.id,
        session.id,
        metadata,
      );
      return { user, sessionId: session.id, expiresAt: session.expiresAt };
    });
  }

  async findPrincipal(userId: string, sessionId: string) {
    const [row] = await this.db
      .select({ user: userColumns, sessionId: userSessions.id })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .innerJoin(
        userSessions,
        and(eq(userSessions.userId, users.id), eq(userSessions.id, sessionId)),
      )
      .where(
        and(
          eq(users.id, userId),
          eq(userSessions.isActive, true),
          gt(userSessions.expiresAt, new Date()),
        ),
      );
    return row;
  }

  async permissionKeys(userId: string) {
    const rows = await this.db
      .select({ key: permissions.key })
      .from(users)
      .innerJoin(
        roles,
        and(eq(users.roleId, roles.id), eq(roles.isActive, true)),
      )
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(
        permissions,
        and(
          eq(permissions.id, rolePermissions.permissionId),
          eq(permissions.isActive, true),
        ),
      )
      .where(and(eq(users.id, userId), eq(users.isActive, true)))
      .orderBy(asc(permissions.key));
    return rows.map((row) => row.key);
  }

  async listSessions(userId: string) {
    return this.db
      .select({
        id: userSessions.id,
        ipAddress: userSessions.ipAddress,
        userAgent: userSessions.userAgent,
        createdAt: userSessions.createdAt,
        lastActiveAt: userSessions.lastActiveAt,
        expiresAt: userSessions.expiresAt,
      })
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, userId),
          eq(userSessions.isActive, true),
          gt(userSessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(userSessions.createdAt));
  }

  private async revokeInTransaction(
    tx: DatabaseTransaction,
    userId: string,
    sessionId: string | undefined,
    now: Date,
  ) {
    await tx
      .update(userSessions)
      .set({ isActive: false })
      .where(
        and(
          eq(userSessions.userId, userId),
          sessionId ? eq(userSessions.id, sessionId) : undefined,
        ),
      );
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          sessionId ? eq(refreshTokens.sessionId, sessionId) : undefined,
        ),
      );
  }

  async revoke(
    userId: string,
    sessionId: string | undefined,
    metadata: RequestMetadata,
    action: string,
  ) {
    await this.db.transaction(async (tx) => {
      await this.lockUser(tx, userId);
      if (sessionId) {
        const [session] = await tx
          .select({ id: userSessions.id })
          .from(userSessions)
          .where(
            and(
              eq(userSessions.id, sessionId),
              eq(userSessions.userId, userId),
            ),
          );
        if (!session) throw new NotFoundException('Sesion no encontrada');
      }
      await this.revokeInTransaction(tx, userId, sessionId, new Date());
      await this.enqueue(tx, action, userId, sessionId ?? null, metadata);
    });
  }

  async recordFailure(
    action: string,
    metadata: RequestMetadata,
    reason: string,
  ) {
    await this.enqueue(this.db, action, null, null, metadata, reason);
  }

  async claimDeliveries() {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const rows = await tx
        .select()
        .from(authOutbox)
        .where(
          and(
            isNull(authOutbox.publishedAt),
            lt(authOutbox.availableAt, now),
            or(isNull(authOutbox.lockedUntil), lt(authOutbox.lockedUntil, now)),
          ),
        )
        .orderBy(asc(authOutbox.createdAt))
        .limit(10)
        .for('update', { skipLocked: true });
      if (!rows.length) return [];
      const claim = randomUUID();
      return tx
        .update(authOutbox)
        .set({
          claimedBy: claim,
          lockedUntil: new Date(now.getTime() + 120000),
        })
        .where(
          inArray(
            authOutbox.id,
            rows.map((row) => row.id),
          ),
        )
        .returning();
    });
  }
  async delivered(id: string, claim: string) {
    await this.db
      .update(authOutbox)
      .set({ publishedAt: new Date(), lockedUntil: null, claimedBy: null })
      .where(and(eq(authOutbox.id, id), eq(authOutbox.claimedBy, claim)));
  }
  async retryDelivery(id: string, claim: string, attempts: number) {
    const delay = Math.min(3600000, 1000 * 2 ** Math.min(attempts, 12));
    await this.db
      .update(authOutbox)
      .set({
        attempts,
        availableAt: new Date(Date.now() + delay),
        lockedUntil: null,
        claimedBy: null,
      })
      .where(and(eq(authOutbox.id, id), eq(authOutbox.claimedBy, claim)));
  }

  async cleanup(retentionDays: number) {
    const cutoff = new Date(Date.now() - retentionDays * 86400000);
    // Retain rotated tokens for the entire session lifetime to detect reuse.
    const expired = await this.db
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(lt(userSessions.expiresAt, cutoff))
      .limit(500);
    if (expired.length)
      await this.db.delete(userSessions).where(
        inArray(
          userSessions.id,
          expired.map((row) => row.id),
        ),
      );
    const delivered = await this.db
      .select({ id: authOutbox.id })
      .from(authOutbox)
      .where(lt(authOutbox.publishedAt, cutoff))
      .limit(500);
    if (delivered.length)
      await this.db.delete(authOutbox).where(
        inArray(
          authOutbox.id,
          delivered.map((row) => row.id),
        ),
      );
    // Legacy unlinked tokens are never accepted by the new authentication flow.
    const legacy = await this.db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(
        and(
          isNull(refreshTokens.sessionId),
          lt(refreshTokens.expiresAt, cutoff),
        ),
      )
      .limit(500);
    if (legacy.length)
      await this.db.delete(refreshTokens).where(
        inArray(
          refreshTokens.id,
          legacy.map((row) => row.id),
        ),
      );
  }
}
