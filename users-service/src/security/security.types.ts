import type { Request } from 'express';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  roleId: number;
  role: string;
  areaId: string | null;
  permissions: string[];
}

export type AuthenticatedRequest = Request & { user: CurrentUser };
