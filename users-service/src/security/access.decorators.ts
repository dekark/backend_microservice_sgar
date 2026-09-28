import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ROLES = 'access:roles';
export const REQUIRED_PERMISSIONS = 'access:permissions';

function requirements(values: string[]) {
  if (
    !values.length ||
    values.some((value) => !value.trim() || value !== value.trim())
  ) {
    throw new Error(
      'Define al menos un rol o permiso no vacio, sin espacios al inicio/final',
    );
  }
  return [...new Set(values)];
}

// Any listed role is accepted; permissions require every listed key.
export const RequireRoles = (...roles: string[]) =>
  SetMetadata(REQUIRED_ROLES, requirements(roles));
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, requirements(permissions));
