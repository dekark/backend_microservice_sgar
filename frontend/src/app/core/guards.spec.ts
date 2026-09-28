import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
} from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { ApiService } from './api.service';
import { areaGuard, authGuard, permissionGuard, roleGuard, safeReturnUrl } from './guards';
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'administrador',
  areaId: '22222222-2222-4222-8222-222222222222',
  permissions: ['resources.read'],
};
describe('Route guards', () => {
  const auth = { ensureSession: vi.fn() };
  const api = { list: vi.fn() };
  const state = { url: '/mi-area/resources' } as RouterStateSnapshot;
  const route = (data: Record<string, unknown>) => ({ data }) as ActivatedRouteSnapshot;
  beforeEach(() => {
    auth.ensureSession.mockResolvedValue(user);
    api.list.mockResolvedValue({ data: [] });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: ApiService, useValue: api },
      ],
    });
  });
  afterEach(() => vi.clearAllMocks());
  it('sends an anonymous user to login with a local return path', async () => {
    auth.ensureSession.mockRejectedValue(new HttpErrorResponse({ status: 401 }));
    const result = await TestBed.runInInjectionContext(() => authGuard(route({}), state));
    expect(TestBed.inject(Router).serializeUrl(result as never)).toContain('/login?returnUrl=');
  });
  it('rejects the wrong role', async () => {
    const result = await TestBed.runInInjectionContext(() =>
      roleGuard(route({ roles: ['superadministrador'] }), state),
    );
    expect(TestBed.inject(Router).serializeUrl(result as never)).toBe('/sin-acceso');
  });
  it('checks permission keys when a route requires them', async () => {
    const allowed = await TestBed.runInInjectionContext(() =>
      permissionGuard(route({ permissions: ['resources.read'] }), state),
    );
    expect(allowed).toBe(true);
    const denied = await TestBed.runInInjectionContext(() =>
      permissionGuard(route({ permissions: ['users.delete'] }), state),
    );
    expect(denied).not.toBe(true);
  });
  it('asks the scoped backend to validate the area module permission', async () => {
    expect(
      await TestBed.runInInjectionContext(() => areaGuard(route({ scope: 'area-admin' }), state)),
    ).toBe(true);
    expect(api.list).toHaveBeenCalledWith('resources', 'area-admin', { page: 1, limit: 1 });
  });
  it('denies an area if the backend rejects its permission', async () => {
    api.list.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
    const result = await TestBed.runInInjectionContext(() =>
      areaGuard(route({ scope: 'area-admin' }), state),
    );
    expect(TestBed.inject(Router).serializeUrl(result as never)).toBe('/sin-acceso');
  });
  it('does not probe an unassigned area', async () => {
    auth.ensureSession.mockResolvedValue({ ...user, areaId: null });
    expect(
      await TestBed.runInInjectionContext(() => areaGuard(route({ scope: 'area-admin' }), state)),
    ).not.toBe(true);
    expect(api.list).not.toHaveBeenCalled();
  });
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/login', null])(
    'rejects unsafe return URL %s',
    (value) => {
      expect(safeReturnUrl(value)).toBe('/inicio');
    },
  );
});
