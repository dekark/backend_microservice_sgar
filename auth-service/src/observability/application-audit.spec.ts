import { EventEmitter } from 'node:events';
import {
  ApplicationOutbox,
  parseApplicationEvent,
  InvalidApplicationEventError,
  applicationMessagingConfig,
  kafkaClientConfig,
  auditContext,
} from 'database';
import type { ApplicationEvent, AuditHttpRequest } from 'database';
import { ConfigService } from '@nestjs/config';

const event: ApplicationEvent = {
  eventId: '11111111-1111-4111-8111-111111111111',
  version: 1,
  source: 'resources-service',
  action: 'data.updated',
  occurredAt: '2026-09-24T12:00:00.000Z',
  requestId: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
  areaId: null,
  entity: 'resources',
  entityId: '44444444-4444-4444-8444-444444444444',
  metadata: { changedFields: ['status', 'name'] },
};

describe('Application audit contract', () => {
  it('canonicalizes events for stable duplicate detection', () => {
    expect(parseApplicationEvent(event).metadata.changedFields).toEqual([
      'name',
      'status',
    ]);
  });
  it.each([
    { ...event, token: 'private' },
    { ...event, source: 'unknown' },
    { ...event, action: 'unknown' },
    { ...event, userId: 'not-a-user' },
    { ...event, metadata: { authorization: 'Bearer private' } },
    { ...event, metadata: { route: '/search?token=private' } },
    { ...event, metadata: { changedFields: ['private-value'] } },
    { ...event, metadata: { statusCode: 900 } },
    { ...event, occurredAt: '2026-02-30T00:00:00.000Z' },
  ])('rejects unsafe or malformed payloads', (value) => {
    expect(() => parseApplicationEvent(value)).toThrow(
      InvalidApplicationEventError,
    );
  });
  it('supports multiple cloud brokers and authenticated TLS', () => {
    expect(
      kafkaClientConfig(
        new ConfigService({
          KAFKA_BROKERS: 'broker-a:9096, broker-b:9096',
          KAFKA_SSL: 'true',
          KAFKA_SASL_MECHANISM: 'scram-sha-512',
          KAFKA_SASL_USERNAME: 'test',
          KAFKA_SASL_PASSWORD: 'test-only',
        }),
        'users-service',
      ),
    ).toMatchObject({
      brokers: ['broker-a:9096', 'broker-b:9096'],
      ssl: true,
      sasl: {
        mechanism: 'scram-sha-512',
        username: 'test',
        password: 'test-only',
      },
    });
  });
  it.each([
    { APPLICATION_EVENTS_ENABLED: 'maybe' },
    { APPLICATION_OUTBOX_INTERVAL_MS: '0' },
    { APPLICATION_KAFKA_TOPIC: 'unsafe topic' },
    { AUTH_AUDIT_QUEUE: 'amq.reserved' },
  ])('rejects ambiguous application messaging settings', (value) => {
    expect(() =>
      applicationMessagingConfig(new ConfigService(value)),
    ).toThrow();
  });
});

describe('Durable application outbox', () => {
  let query: jest.Mock;
  let report: jest.Mock;
  let outbox: ApplicationOutbox;
  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    report = jest.fn();
    outbox = new ApplicationOutbox(
      { query } as unknown as ConstructorParameters<
        typeof ApplicationOutbox
      >[0],
      'resources-service',
      report,
    );
  });
  it('atomically queues both brokers without copying secrets', async () => {
    await outbox.enqueue(event);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("'kafka'"), [
      event.eventId,
      event.source,
      JSON.stringify(parseApplicationEvent(event)),
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("'rabbit'"),
      expect.any(Array),
    );
  });
  it('marks only confirmed destinations and retries a failed broker independently', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 'delivery-kafka', destination: 'kafka', payload: event },
        { id: 'delivery-rabbit', destination: 'rabbit', payload: event },
      ],
    });
    const publish = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    await outbox.deliver(publish);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE SKIP LOCKED'),
      expect.any(Array),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('attempts = attempts + 1'),
      ['delivery-kafka', expect.any(String)],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('published_at = now()'),
      ['delivery-rabbit', expect.any(String)],
    );
  });
  it('never reports a delivery before the publisher resolves', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'delivery', destination: 'rabbit', payload: event }],
    });
    let done!: () => void;
    const publish = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          done = resolve;
        }),
    );
    const work = outbox.deliver(publish);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(query).toHaveBeenCalledTimes(1);
    done();
    await work;
    expect(query).toHaveBeenCalledTimes(2);
  });

  function response() {
    return Object.assign(new EventEmitter(), {
      statusCode: 403,
      writableFinished: false,
      destroyed: false,
      setHeader: jest.fn(),
    });
  }
  it('captures guard rejections and trusted actor after authentication, once', async () => {
    const req: AuditHttpRequest = {
      method: 'PATCH',
      route: { path: '/resources/:id/deactivate' },
    };
    const res = response();
    const next = jest.fn(() => {
      req.user = { id: event.userId!, areaId: null };
      expect(auditContext.getStore()?.actor().userId).toBe(event.userId);
      res.writableFinished = true;
      res.emit('finish');
      res.emit('close');
    });
    outbox.trackHttp(req, res, next);
    await outbox.drain();
    await outbox.drain();
    expect(next).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    const calls = query.mock.calls as [string, [string, string, string]][];
    const accepted = JSON.parse(calls[0][1][2]) as ApplicationEvent;
    const completed = JSON.parse(calls[1][1][2]) as ApplicationEvent;
    expect(accepted).toMatchObject({ action: 'http.accepted', userId: null });
    expect(completed).toMatchObject({
      action: 'http.completed',
      userId: event.userId,
      metadata: { statusCode: 403, route: '/resources/:id/deactivate' },
    });
    expect(completed.requestId).toBe(accepted.requestId);
  });
  it('records aborted connections without trusting request body or raw URL', async () => {
    const req = {
      method: 'POST',
      url: '/auth/google?token=private',
      body: { userId: event.userId, idToken: 'private' },
    };
    const res = response();
    outbox.trackHttp(req, res, () => res.emit('close'));
    await outbox.drain();
    await outbox.drain();
    expect(JSON.stringify(query.mock.calls)).not.toContain('private');
    expect(JSON.stringify(query.mock.calls)).toContain('http.aborted');
  });
  it('blocks execution if the admission event cannot be persisted', async () => {
    query.mockRejectedValue(
      new Error('database unavailable with secret details'),
    );
    const next = jest.fn();
    outbox.trackHttp({ method: 'DELETE' }, response(), next);
    await outbox.drain();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 503 }));
    expect(JSON.stringify(report.mock.calls)).not.toContain('secret');
  });
});
