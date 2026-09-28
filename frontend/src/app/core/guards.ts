import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from './auth.service';
import { ApiService } from './api.service';
import { Scope } from './models';
export function safeReturnUrl(value: string | null): string {
  return value && /^\/(?!\/)/.test(value) && !/[\\\r\n]/.test(value) && !value.startsWith('/login')
    ? value
    : '/inicio';
}
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  try {
    await auth.ensureSession();
    return true;
  } catch (error) {
    return router.createUrlTree(
      [error instanceof HttpErrorResponse && error.status === 401 ? '/login' : '/sin-acceso'],
      {
        queryParams: {
          returnUrl: safeReturnUrl(state.url),
          unavailable: !(error instanceof HttpErrorResponse && [401, 403].includes(error.status))
            ? '1'
            : undefined,
        },
      },
    );
  }
};
export const roleGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  try {
    const user = await auth.ensureSession();
    return (
      (route.data['roles'] as string[]).includes(user.role) || router.createUrlTree(['/sin-acceso'])
    );
  } catch {
    return router.createUrlTree(['/login']);
  }
};
export const permissionGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  try {
    const user = await auth.ensureSession();
    return (
      ((route.data['permissions'] as string[]) ?? []).every((p) => user.permissions.includes(p)) ||
      router.createUrlTree(['/sin-acceso'])
    );
  } catch {
    return router.createUrlTree(['/login']);
  }
};
export const areaGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const api = inject(ApiService);
  const router = inject(Router);
  try {
    const user = await auth.ensureSession();
    const scope = route.data['scope'] as Scope;
    if (
      !user.areaId ||
      (scope === 'area-admin' && user.role !== 'administrador') ||
      (scope === 'area-user' && user.role !== 'usuario normal')
    )
      return router.createUrlTree(['/sin-acceso']);
    // /auth/me exposes permission keys, not their modules. Ask the existing scoped
    // controller to verify active area and permission.module == area.name in SQL.
    await api.list('resources', scope, { limit: 1, page: 1 });
    return true;
  } catch (error) {
    return router.createUrlTree(['/sin-acceso'], {
      queryParams: {
        unavailable:
          error instanceof HttpErrorResponse && error.status !== 403 && error.status !== 401
            ? '1'
            : undefined,
      },
    });
  }
};
