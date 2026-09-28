import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { ConfigService } from './config';
import { authInterceptor } from './auth.interceptor';
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ana',
  email: 'ana@example.com',
  roleId: 1,
  role: 'superadministrador',
  areaId: null,
  permissions: ['resources.read'],
};
const tokens = {
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  sessionId: 'session',
  expiresIn: 900,
};
describe('Authentication and HTTP authorization', () => {
  let auth: AuthService;
  let backend: HttpTestingController;
  let http: HttpClient;
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('ambito.refresh', 'old-refresh');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    auth = TestBed.inject(AuthService);
    backend = TestBed.inject(HttpTestingController);
    http = TestBed.inject(HttpClient);
  });
  afterEach(() => {
    backend.verify();
    sessionStorage.clear();
  });
  it('restores a session from a rotated refresh token, never a stored role', async () => {
    sessionStorage.setItem('role', 'administrator-forged');
    const first = auth.ensureSession();
    const second = auth.ensureSession();
    expect(first).toBe(second);
    const refresh = backend.expectOne('/api/auth/auth/refresh');
    expect(refresh.request.body).toEqual({ refreshToken: 'old-refresh' });
    refresh.flush(tokens);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const me = backend.expectOne('/api/auth/auth/me');
    expect(me.request.headers.get('Authorization')).toBe('Bearer new-access');
    me.flush(user);
    expect(await first).toEqual(user);
    expect(auth.user()?.role).toBe('superadministrador');
    expect(sessionStorage.getItem('ambito.refresh')).toBe('new-refresh');
  });
  it('rotates only once for simultaneous 401s and retries both requests', async () => {
    auth.accessToken.set('old-access');
    const one = firstValueFrom(http.get('/api/resources/admin/resources'));
    const two = firstValueFrom(http.get('/api/users/admin/users'));
    backend
      .expectOne('/api/resources/admin/resources')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    backend
      .expectOne('/api/users/admin/users')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/auth/auth/refresh').flush(tokens);
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const path of ['/api/resources/admin/resources', '/api/users/admin/users']) {
      const retry = backend.expectOne(path);
      expect(retry.request.headers.get('Authorization')).toBe('Bearer new-access');
      retry.flush({ data: [] });
    }
    await Promise.all([one, two]);
  });
  it('does not send credentials to S3, Google, or a URL with a similar prefix', async () => {
    auth.accessToken.set('secret');
    for (const path of [
      'https://files.example.com/image',
      'https://accounts.google.com/example',
      '/api/users-evil/data',
    ]) {
      const pending = firstValueFrom(http.get(path));
      const req = backend.expectOne(path);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
      await pending;
    }
  });
  it('never restores credentials after the session is cleared during refresh', async () => {
    const pending = auth.renew();
    const failure = expect(pending).rejects.toThrow('La sesión cambió.');
    auth.clear();
    backend.expectOne('/api/auth/auth/refresh').flush(tokens);
    await failure;
    expect(auth.accessToken()).toBeNull();
    expect(sessionStorage.getItem('ambito.refresh')).toBeNull();
  });
  it('clears revoked refresh tokens but preserves them during an outage', async () => {
    const unavailable = auth.renew();
    const first = expect(unavailable).rejects.toBeInstanceOf(HttpErrorResponse);
    backend
      .expectOne('/api/auth/auth/refresh')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await first;
    expect(sessionStorage.getItem('ambito.refresh')).toBe('old-refresh');
    const revoked = auth.renew();
    const second = expect(revoked).rejects.toBeInstanceOf(HttpErrorResponse);
    backend
      .expectOne('/api/auth/auth/refresh')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await second;
    expect(sessionStorage.getItem('ambito.refresh')).toBeNull();
  });
  it('matches trusted API URLs on both origin and path boundary', () => {
    const config = TestBed.inject(ConfigService);
    config.settings.api.users = 'https://gateway.example.com/stage/users';
    expect(config.owns('https://gateway.example.com/stage/users/admin/users')).toBe(true);
    expect(config.owns('https://gateway.example.com.evil/stage/users/admin/users')).toBe(false);
    expect(config.owns('https://gateway.example.com/stage/users-extra')).toBe(false);
  });
  it('never retries an old account request using a new account token', async () => {
    auth.accessToken.set('old-account-token');
    const pending = firstValueFrom(http.patch('/api/users/admin/users/123', { name: 'Cambio' }));
    const failure = expect(pending).rejects.toBeInstanceOf(HttpErrorResponse);
    auth.clear();
    auth.accessToken.set('new-account-token');
    backend
      .expectOne('/api/users/admin/users/123')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await failure;
    backend.expectNone('/api/auth/auth/refresh');
    expect(auth.accessToken()).toBe('new-account-token');
  });
});
