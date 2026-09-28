import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientProxy, Transport } from '@nestjs/microservices';
import { connect } from 'amqplib';
import type { ChannelModel, ConfirmChannel } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { auditLogs, eq, roles, sql, users } from 'database';
import type { AuthEvent } from 'database';
import { AuditModule } from '../src/audit/audit.module';
import { AuditRepository } from '../src/audit/audit.repository';
import { auditRabbitOptions } from '../src/rabbit/rabbit.options';
import { validateEnvironment } from '../src/config/environment';

const databaseUrl = process.env.AUDIT_TEST_DATABASE_URL;
const rabbitUrl = process.env.AUDIT_TEST_RABBITMQ_URL;
if (!databaseUrl || !rabbitUrl)
  throw new Error('Use test/run-integration.ps1 to create disposable services');
const dbTarget = new URL(databaseUrl);
const brokerTarget = new URL(rabbitUrl);
if (
  !['127.0.0.1', 'localhost'].includes(dbTarget.hostname) ||
  dbTarget.pathname !== '/audit_test' ||
  dbTarget.password !== 'audit-local-test-only' ||
  !['127.0.0.1', 'localhost'].includes(brokerTarget.hostname) ||
  brokerTarget.username !== 'audit-test' ||
  brokerTarget.password !== 'audit-local-test-only'
) {
  throw new Error('Only isolated local audit test containers are allowed');
}

// Exercise the actual compiled auth-service publisher, not a reconstructed event sender.
const authRequire = createRequire(
  resolve(__dirname, '../../auth-service/package.json'),
);
// RmqRecord uses instanceof: the producer and client must share auth-service's Nest copy.
const authClients = authRequire('@nestjs/microservices') as {
  ClientProxyFactory: { create(options: unknown): ClientProxy };
};
const publisherModule = authRequire('./dist/auth/auth-events.publisher.js') as {
  AuthEventsPublisher: new (
    kafka: ClientProxy,
    rabbit: ClientProxy,
    config: ConfigService,
  ) => {
    publish(destination: 'kafka' | 'rabbit', event: AuthEvent): Promise<void>;
  };
};

describe('auth-service -> RabbitMQ -> audit-service -> PostgreSQL', () => {
  let app: INestApplication;
  let repository: AuditRepository;
  let connection: ChannelModel;
  let channel: ConfirmChannel;
  let client: ClientProxy;
  let publisher: InstanceType<typeof publisherModule.AuthEventsPublisher>;
  const queue = 'audit_integration_' + randomUUID();
  const invalidQueue = queue + '.invalid';
  const configValues = validateEnvironment({
    DATABASE_URL: databaseUrl,
    RABBITMQ_URL: rabbitUrl,
    AUTH_AUDIT_QUEUE: queue,
    AUDIT_REJECTED_QUEUE: invalidQueue,
    AUDIT_PREFETCH_COUNT: 5,
    AUDIT_RETRY_DELAY_MS: 25,
  });

  async function eventually(check: () => Promise<boolean>) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await delay(50);
    }
    throw new Error('Timed out waiting for asynchronous message processing');
  }
  const event = (overrides: Partial<AuthEvent> = {}): AuthEvent => ({
    eventId: randomUUID(),
    version: 1,
    source: 'auth-service',
    action: 'auth.login.succeeded',
    occurredAt: new Date().toISOString(),
    userId: null,
    sessionId: randomUUID(),
    ipAddress: '127.0.0.1',
    userAgent: 'integration-test',
    ...overrides,
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [() => configValues],
        }),
        AuditModule,
      ],
    }).compile();
    repository = module.get(AuditRepository);
    const present = await repository.db.execute(
      sql`select to_regclass('public.users') as name`,
    );
    if (!(present.rows[0] as { name: string | null }).name) {
      for (const migration of [
        '0000_silky_mandroid.sql',
        '0001_auth_sessions_outbox.sql',
      ]) {
        await repository.db.execute(
          sql.raw(
            readFileSync(
              resolve(__dirname, '../../database/drizzle', migration),
              'utf8',
            ),
          ),
        );
      }
    }
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        connection = await connect(rabbitUrl);
        break;
      } catch (error) {
        if (attempt === 59) throw error;
        await delay(500);
      }
    }
    channel = await connection.createConfirmChannel();
    await channel.assertQueue(invalidQueue, { durable: true });
    app = module.createNestApplication({ logger: false });
    app.connectMicroservice(auditRabbitOptions(module.get(ConfigService)));
    await app.init();
    await app.startAllMicroservices();
    client = authClients.ClientProxyFactory.create({
      transport: Transport.RMQ,
      options: {
        urls: [rabbitUrl],
        queue,
        queueOptions: { durable: true },
        persistent: true,
      },
    });
    await client.connect();
    publisher = new publisherModule.AuthEventsPublisher(
      {} as ClientProxy,
      client,
      new ConfigService({ AUTH_KAFKA_TOPIC: 'unused' }),
    );
  });

  beforeEach(async () => {
    await channel.purgeQueue(invalidQueue);
    await repository.db.delete(auditLogs);
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    client?.close();
    if (app) await app.close();
    if (channel) await channel.close();
    if (connection) await connection.close();
  });

  async function rows(id: string) {
    return repository.db.select().from(auditLogs).where(eq(auditLogs.id, id));
  }

  it('persists a real auth-service publication with the correct user and timestamp', async () => {
    const [role] = await repository.db
      .insert(roles)
      .values({ name: 'reader' })
      .returning();
    const [user] = await repository.db
      .insert(users)
      .values({
        googleSub: 'google-test',
        email: 'user@example.com',
        name: 'User',
        roleId: role.id,
      })
      .returning();
    const payload = event({ userId: user.id });
    await publisher.publish('rabbit', payload);
    await eventually(async () => (await rows(payload.eventId)).length === 1);
    const [stored] = await rows(payload.eventId);
    expect(stored).toMatchObject({
      userId: user.id,
      action: payload.action,
      entityId: payload.sessionId,
      createdAt: new Date(payload.occurredAt),
    });
    expect(stored.metadata).toMatchObject({
      originalUserId: user.id,
      source: 'auth-service',
    });
  });

  it('deduplicates concurrent deliveries without losing any acknowledgement', async () => {
    const payload = event();
    await Promise.all(
      Array.from({ length: 5 }, () => publisher.publish('rabbit', payload)),
    );
    await eventually(async () => (await rows(payload.eventId)).length === 1);
    await delay(150);
    expect(await rows(payload.eventId)).toHaveLength(1);
    expect((await channel.checkQueue(invalidQueue)).messageCount).toBe(0);
  });

  it('retains the original user ID when a delayed event refers to a deleted user', async () => {
    const originalUserId = randomUUID();
    const payload = event({ userId: originalUserId });
    await publisher.publish('rabbit', payload);
    await eventually(async () => (await rows(payload.eventId)).length === 1);
    const [stored] = await rows(payload.eventId);
    expect(stored.userId).toBeNull();
    expect(stored.metadata).toMatchObject({ originalUserId });
  });

  it('quarantines a conflicting event ID while preserving the first audit entry', async () => {
    const first = event();
    await publisher.publish('rabbit', first);
    await eventually(async () => (await rows(first.eventId)).length === 1);
    await publisher.publish('rabbit', { ...first, action: 'auth.logout' });
    await eventually(
      async () => (await channel.checkQueue(invalidQueue)).messageCount === 1,
    );
    expect((await rows(first.eventId))[0].action).toBe(first.action);
    const receipt = await channel.get(invalidQueue, { noAck: true });
    expect(receipt && receipt.content.toString()).toContain(
      'conflicting_event',
    );
  });

  it('quarantines unexpected fields without copying sensitive payloads', async () => {
    const packet = {
      pattern: 'audit.auth.record',
      data: { ...event(), accessToken: 'do-not-copy-this-secret' },
    };
    channel.sendToQueue(queue, Buffer.from(JSON.stringify(packet)), {
      persistent: true,
    });
    await channel.waitForConfirms();
    await eventually(
      async () => (await channel.checkQueue(invalidQueue)).messageCount === 1,
    );
    const receipt = await channel.get(invalidQueue, { noAck: true });
    expect(receipt && receipt.content.toString()).toContain('invalid_event');
    expect(receipt && receipt.content.toString()).not.toContain(
      'do-not-copy-this-secret',
    );
    expect(await repository.db.select().from(auditLogs)).toHaveLength(0);
  });

  it.each(['not-json', JSON.stringify({ pattern: 'unknown.topic', data: {} })])(
    'handles malformed JSON and unknown routing patterns',
    async (body) => {
      channel.sendToQueue(queue, Buffer.from(body), { persistent: true });
      await channel.waitForConfirms();
      await eventually(
        async () => (await channel.checkQueue(invalidQueue)).messageCount === 1,
      );
      expect(await repository.db.select().from(auditLogs)).toHaveLength(0);
    },
  );

  it('redelivers after a transient persistence failure and then commits only once', async () => {
    const persist = jest
      .spyOn(repository, 'persist')
      .mockRejectedValueOnce(new Error('temporary database failure'));
    const payload = event();
    await publisher.publish('rabbit', payload);
    await eventually(async () => (await rows(payload.eventId)).length === 1);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(await rows(payload.eventId)).toHaveLength(1);
  });
});
