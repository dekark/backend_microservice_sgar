import { validateEnvironment } from './environment';
describe('Audit configuration', () => {
  const valid = {
    DATABASE_URL: 'postgresql://user:password@localhost/audit_test',
  };
  it('uses a separate HTTP port and compatible durable queue names', () => {
    expect(validateEnvironment(valid)).toMatchObject({
      PORT: 3006,
      AUTH_AUDIT_QUEUE: 'audit_queue',
      AUDIT_REJECTED_QUEUE: 'audit_queue.invalid',
    });
  });
  it.each([
    {},
    { ...valid, DATABASE_URL: 'https://example.com' },
    { ...valid, RABBITMQ_URL: 'https://example.com' },
    { ...valid, AUDIT_PREFETCH_COUNT: 0 },
    { ...valid, AUDIT_RETRY_DELAY_MS: -1 },
    { ...valid, AUTH_AUDIT_QUEUE: 'same', AUDIT_REJECTED_QUEUE: 'same' },
  ])('fails for invalid configuration', (env) => {
    expect(() => validateEnvironment(env)).toThrow();
  });
});
