import type { Request } from 'express';

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roleId: number;
  role: string;
  areaId: string | null;
  isActive: boolean;
  roleIsActive: boolean;
}
export interface RequestMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}
export interface AuthPrincipal {
  user: AuthUser;
  sessionId: string;
}
export type AuthenticatedRequest = Request & AuthPrincipal;
export interface RefreshSecret {
  id: string;
  hash: string;
}
export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roleId: user.roleId,
    role: user.role,
    areaId: user.areaId,
  };
}
