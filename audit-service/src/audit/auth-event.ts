import type { AuthEvent } from 'database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set([
  'auth.user.registered',
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.token.refreshed',
  'auth.refresh.failed',
  'auth.refresh.reuse_detected',
  'auth.logout',
  'auth.logout_all',
  'auth.session.revoked',
]);
const REASONS = new Set([
  'http_401',
  'http_403',
  'http_409',
  'invalid_refresh_token',
  'account_inactive',
]);
const KEYS = new Set([
  'eventId',
  'version',
  'source',
  'action',
  'occurredAt',
  'userId',
  'sessionId',
  'ipAddress',
  'userAgent',
  'reason',
]);

export class InvalidAuthEventError extends Error {}
export class ConflictingAuthEventError extends Error {}

export function parseAuthEvent(value: unknown): AuthEvent {
  const invalid = () => {
    throw new InvalidAuthEventError('Invalid authentication event');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !KEYS.has(key))) return invalid();
  if (
    input.version !== 1 ||
    input.source !== 'auth-service' ||
    typeof input.eventId !== 'string' ||
    !UUID.test(input.eventId) ||
    typeof input.action !== 'string' ||
    !ACTIONS.has(input.action)
  )
    return invalid();
  if (
    typeof input.occurredAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.occurredAt) ||
    input.occurredAt.startsWith('0000-') ||
    !Number.isFinite(Date.parse(input.occurredAt)) ||
    new Date(input.occurredAt).toISOString() !== input.occurredAt
  )
    return invalid();
  for (const key of ['userId', 'sessionId']) {
    if (
      input[key] !== null &&
      (typeof input[key] !== 'string' || !UUID.test(input[key]))
    )
      return invalid();
  }
  for (const [key, max] of [
    ['ipAddress', 100],
    ['userAgent', 512],
  ] as const) {
    if (
      input[key] !== null &&
      (typeof input[key] !== 'string' ||
        input[key].length > max ||
        input[key].includes('\u0000'))
    )
      return invalid();
  }
  if (
    input.reason !== undefined &&
    (typeof input.reason !== 'string' || !REASONS.has(input.reason))
  )
    return invalid();
  // Rebuild a canonical object: stable hashing, allowlisted fields only.
  return {
    eventId: input.eventId.toLowerCase(),
    version: 1,
    source: 'auth-service',
    action: input.action,
    occurredAt: input.occurredAt,
    userId:
      input.userId === null ? null : (input.userId as string).toLowerCase(),
    sessionId:
      input.sessionId === null
        ? null
        : (input.sessionId as string).toLowerCase(),
    ipAddress: input.ipAddress as string | null,
    userAgent: input.userAgent as string | null,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}
