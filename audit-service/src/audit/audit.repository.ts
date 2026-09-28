import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  auditLogs,
  auditEventReceipts,
  areas,
  createTransactionalDatabase,
  eq,
  users,
  sql,
} from 'database';
import type { AuthEvent, ApplicationEvent } from 'database';
import { ConflictingAuthEventError } from './auth-event';

@Injectable()
export class AuditRepository implements OnApplicationShutdown {
  private readonly connection: ReturnType<typeof createTransactionalDatabase>;
  private readonly logger = new Logger(AuditRepository.name);
  readonly db: ReturnType<typeof createTransactionalDatabase>['db'];
  constructor(config: ConfigService) {
    this.connection = createTransactionalDatabase(
      config.getOrThrow<string>('DATABASE_URL'),
    );
    this.connection.pool.on('error', () =>
      this.logger.error('Audit database connection error'),
    );
    this.db = this.connection.db;
  }
  async onApplicationShutdown() {
    await this.connection.pool.end();
  }

  async persist(event: AuthEvent): Promise<void> {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(event))
      .digest('hex');
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.audit_ingest', 'true', true)`,
      );
      // Delayed events remain auditable even if the account has already been deleted.
      // KEY SHARE prevents a concurrent deletion between this lookup and the insert.
      const account = event.userId
        ? await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, event.userId))
            .for('key share')
        : [];
      const inserted = await tx
        .insert(auditLogs)
        .values({
          id: event.eventId,
          userId: account[0]?.id ?? null,
          action: event.action,
          entity: 'user_sessions',
          entityId: event.sessionId,
          ipAddress: event.ipAddress,
          createdAt: new Date(event.occurredAt),
          metadata: {
            source: event.source,
            version: event.version,
            eventId: event.eventId,
            originalUserId: event.userId,
            sessionId: event.sessionId,
            userAgent: event.userAgent,
            receivedAt: new Date().toISOString(),
            eventHash: fingerprint,
            ...(event.reason ? { reason: event.reason } : {}),
          },
        })
        .onConflictDoNothing({ target: auditLogs.id })
        .returning({ id: auditLogs.id });
      if (!inserted.length) {
        const [existing] = await tx
          .select({ metadata: auditLogs.metadata })
          .from(auditLogs)
          .where(eq(auditLogs.id, event.eventId));
        const stored = existing?.metadata as Record<string, unknown> | null;
        if (stored?.eventHash !== fingerprint)
          throw new ConflictingAuthEventError(
            'Event ID reused with different content',
          );
      }
    });
  }

  async persistApplication(event: ApplicationEvent): Promise<void> {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(event))
      .digest('hex');
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.audit_ingest', 'true', true)`,
      );
      const receipt = await tx
        .insert(auditEventReceipts)
        .values({
          eventId: event.eventId,
          eventHash: fingerprint,
        })
        .onConflictDoNothing()
        .returning();
      if (!receipt.length) {
        const [existing] = await tx
          .select()
          .from(auditEventReceipts)
          .where(eq(auditEventReceipts.eventId, event.eventId));
        if (existing?.eventHash !== fingerprint)
          throw new ConflictingAuthEventError(
            'Event ID reused with different content',
          );
        return;
      }
      const account = event.userId
        ? await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, event.userId))
            .for('key share')
        : [];
      const area = event.areaId
        ? await tx
            .select({ id: areas.id })
            .from(areas)
            .where(eq(areas.id, event.areaId))
            .for('key share')
        : [];
      const inserted = await tx
        .insert(auditLogs)
        .values({
          id: event.eventId,
          userId: account[0]?.id ?? null,
          areaId: area[0]?.id ?? null,
          action: event.action,
          entity: event.entity,
          entityId: event.entityId,
          createdAt: new Date(event.occurredAt),
          metadata: {
            source: event.source,
            version: event.version,
            eventId: event.eventId,
            requestId: event.requestId,
            originalUserId: event.userId,
            originalAreaId: event.areaId,
            ...event.metadata,
            eventHash: fingerprint,
            receivedAt: new Date().toISOString(),
          },
        })
        .onConflictDoNothing({ target: auditLogs.id })
        .returning({ id: auditLogs.id });
      if (!inserted.length)
        throw new ConflictingAuthEventError(
          'Event ID already used by another audit record',
        );
    });
  }
}
