import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function createRefreshToken() {
  const id = randomUUID();
  const value = `${id}.${randomBytes(32).toString('base64url')}`;
  return { id, value, hash: hashToken(value) };
}
export function parseRefreshToken(value: string) {
  const parts = value.split('.');
  if (
    parts.length !== 2 ||
    !UUID_PATTERN.test(parts[0]) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[1])
  ) {
    throw new UnauthorizedException('Refresh token invalido');
  }
  return { id: parts[0], hash: hashToken(value) };
}
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return (
    left.length === 32 && right.length === 32 && timingSafeEqual(left, right)
  );
}
