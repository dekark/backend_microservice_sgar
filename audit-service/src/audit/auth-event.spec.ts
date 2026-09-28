import { parseAuthEvent } from './auth-event';
const event = {
  eventId: '11111111-1111-4111-8111-111111111111',
  version: 1,
  source: 'auth-service',
  action: 'auth.login.succeeded',
  occurredAt: '2026-09-23T12:00:00.000Z',
  userId: null,
  sessionId: null,
  ipAddress: null,
  userAgent: null,
};
describe('Authentication event validation', () => {
  it('accepts the auth-service contract and rebuilds it in canonical order', () => {
    expect(parseAuthEvent({ ...event, userAgent: null })).toEqual(event);
  });
  it.each([
    null,
    [],
    'invalid',
    { ...event, eventId: 'bad' },
    { ...event, version: 2 },
    { ...event, source: 'other-service' },
    { ...event, action: 'unknown' },
    { ...event, occurredAt: '2026-02-30T12:00:00.000Z' },
    { ...event, occurredAt: '0000-01-01T12:00:00.000Z' },
    { ...event, userAgent: 'bad\u0000agent' },
    { ...event, ipAddress: 'bad\u0000ip' },
    { ...event, userId: 'bad' },
    { ...event, userAgent: 'x'.repeat(513) },
    { ...event, accessToken: 'secret' },
    { ...event, reason: 'arbitrary payload' },
    { ...event, sessionId: undefined },
    { ...event, ipAddress: undefined },
  ])('rejects malformed or extra fields', (value) => {
    expect(() => parseAuthEvent(value)).toThrow('Invalid authentication event');
  });
});
