import { ConfigService } from '@nestjs/config';
import { auditRabbitOptions } from './rabbit.options';
describe('Rabbit consumer deserialization', () => {
  const options = auditRabbitOptions(
    new ConfigService({
      RABBITMQ_URL: 'amqp://localhost',
      AUTH_AUDIT_QUEUE: 'audit_queue',
      AUDIT_PREFETCH_COUNT: 10,
    }),
  );
  it('enables manual acknowledgement and a bounded prefetch', () => {
    expect(options.options).toMatchObject({ noAck: false, prefetchCount: 10 });
  });
  it.each([
    'invalid json',
    { pattern: 'unknown', data: {} },
    { id: 'rpc', pattern: 'audit.auth.record', data: {} },
  ])('routes unsupported envelopes through validation', (value) => {
    expect(options.options?.deserializer?.deserialize(value)).toEqual({
      pattern: 'audit.auth.record',
      data: null,
    });
  });
  it('unwraps auth-service event envelopes', () => {
    expect(
      options.options?.deserializer?.deserialize({
        pattern: 'audit.auth.record',
        data: { eventId: 'test' },
      }),
    ).toEqual({ pattern: 'audit.auth.record', data: { eventId: 'test' } });
  });
  it('unwraps application event envelopes without changing the pattern', () => {
    expect(
      options.options?.deserializer?.deserialize({
        pattern: 'audit.application.record',
        data: { eventId: 'test' },
      }),
    ).toEqual({
      pattern: 'audit.application.record',
      data: { eventId: 'test' },
    });
  });
});
