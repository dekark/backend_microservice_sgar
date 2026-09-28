export type Entity = 'roles' | 'permissions' | 'areas' | 'users' | 'resources' | 'audit';
export type Service = Entity | 'auth';
export type Scope = 'admin' | 'area-admin' | 'area-user';
export type RecordData = Record<string, unknown> & {
  id: string | number;
  name?: string;
  action?: string;
  isActive?: boolean;
  type?: string;
  status?: string;
};
export interface Page<T = RecordData> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}
export interface User {
  id: string;
  email: string;
  name: string;
  roleId: number;
  role: string;
  areaId: string | null;
  permissions: string[];
}
export interface Tokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
}
export interface Session {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  expiresAt: string;
  current: boolean;
}
export const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export function parseUser(input: unknown): User {
  const u = input as User;
  if (
    !u ||
    !UUID.test(u.id) ||
    typeof u.email !== 'string' ||
    typeof u.name !== 'string' ||
    !Number.isInteger(u.roleId) ||
    u.roleId < 1 ||
    typeof u.role !== 'string' ||
    !u.role ||
    !(u.areaId === null || (typeof u.areaId === 'string' && UUID.test(u.areaId))) ||
    !Array.isArray(u.permissions) ||
    !u.permissions.every((p) => typeof p === 'string')
  )
    throw Error('El perfil recibido no es válido.');
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    roleId: u.roleId,
    role: u.role,
    areaId: u.areaId,
    permissions: [...u.permissions],
  };
}
export function safeLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
