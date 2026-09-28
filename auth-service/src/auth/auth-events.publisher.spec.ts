import { ConfigService } from '@nestjs/config';
import type { ClientProxy } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';
import type { AuthEvent } from 'database';
import { AuthEventsPublisher } from './auth-events.publisher';

describe('AuthEventsPublisher', () => {
  const event: AuthEvent = {
    eventId: 'event',
    version: 1,
    source: 'auth-service',
    action: 'auth.logout',
    occurredAt: '2026-01-01T00:00:00Z',
    userId: 'user',
    sessionId: 'session',
    ipAddress: null,
    userAgent: null,
  };
  const kafka = { emit: jest.fn() };
  const rabbit = { emit: jest.fn() };
  const publisher = new AuthEventsPublisher(
    kafka as unknown as ClientProxy,
    rabbit as unknown as ClientProxy,
    new ConfigService({ AUTH_KAFKA_TOPIC: 'auth.events.v1' }),
  );
  beforeEach(() => {
    kafka.emit.mockReturnValue(of(undefined));
    rabbit.emit.mockReturnValue(of(undefined));
  });
  it('publishes Kafka events keyed by user', async () => {
    await publisher.publish('kafka', event);
    expect(kafka.emit).toHaveBeenCalledWith('auth.events.v1', {
      key: 'user',
      value: event,
    });
  });
  it('publishes persistent RabbitMQ jobs with a deduplication ID', async () => {
    await publisher.publish('rabbit', event);
    expect(rabbit.emit).toHaveBeenCalledWith(
      'audit.auth.record',
      expect.objectContaining({
        data: event,
        options: expect.objectContaining({
          persistent: true,
          messageId: 'event',
        }) as unknown,
      }),
    );
  });
  it('propagates broker failures so the outbox can retry', async () => {
    kafka.emit.mockReturnValue(throwError(() => new Error('offline')));
    await expect(publisher.publish('kafka', event)).rejects.toThrow('offline');
  });

  it('does not report disconnected brokers as ready even if connect is cached', async () => {
    const connected = {
      status: of('connected'),
      connect: jest.fn().mockResolvedValue(undefined),
    };
    const disconnected = {
      status: of('disconnected'),
      connect: jest.fn().mockResolvedValue(undefined),
    };
    const healthPublisher = new AuthEventsPublisher(
      connected as unknown as ClientProxy,
      disconnected as unknown as ClientProxy,
      new ConfigService(),
    );
    healthPublisher.onModuleInit();
    await expect(healthPublisher.connections()).resolves.toEqual({
      kafka: true,
      rabbitmq: false,
    });
    healthPublisher.onModuleDestroy();
  });
});
