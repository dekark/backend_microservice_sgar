import {
  Controller,
  Get,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { UsersModule } from '../src/users/users.module';
import { SecurityModule } from '../src/security/security.module';
import { AuthSessionService } from '../src/security/auth-session.service';
import { AuthSessionGuard } from '../src/security/auth-session.guard';
import { RolesPermissionsGuard } from '../src/security/roles-permissions.guard';
import {
  RequirePermissions,
  RequireRoles,
} from '../src/security/access.decorators';
import type { CurrentUser } from '../src/security/security.types';

// Only test routes: no administrative API is added to production as a side effect.
@Controller('protected-test')
@UseGuards(AuthSessionGuard, RolesPermissionsGuard)
@RequireRoles('admin', 'auditor')
@RequirePermissions('users.read')
class ProtectedController {
  @Get()
  read() {
    return { allowed: true };
  }

  @Get('export')
  @RequirePermissions('users.export')
  export() {
    return { allowed: true };
  }

  @Get('admin')
  @RequireRoles('admin')
  admin() {
    return { allowed: true };
  }
}

describe('Session, roles and permissions (HTTP)', () => {
  let app: INestApplication<App>;
  let user: CurrentUser;
  const authenticate = jest.fn<Promise<CurrentUser>, [string]>();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [UsersModule, SecurityModule],
      controllers: [ProtectedController],
    })
      .overrideProvider(AuthSessionService)
      .useValue({ authenticate })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    user = {
      id: 'user-id',
      email: 'person@example.com',
      name: 'Person',
      roleId: 1,
      role: 'auditor',
      areaId: null,
      permissions: ['users.read'],
    };
    authenticate.mockReset().mockImplementation((token) => {
      if (token !== 'valid-token')
        return Promise.reject(new UnauthorizedException());
      return Promise.resolve(user);
    });
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each([undefined, 'Basic token', 'Bearer', 'Bearer one two'])(
    'rejects a missing or malformed bearer: %s',
    async (authorization) => {
      const call = request(app.getHttpServer()).get('/users/me');
      if (authorization) call.set('Authorization', authorization);
      await call.expect(401);
      expect(authenticate).not.toHaveBeenCalled();
    },
  );
  it('rejects a revoked or invalid token', async () => {
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer revoked-token')
      .expect(401);
  });
  it('protects the administrative controller with the inherited session and role guards', async () => {
    await request(app.getHttpServer()).get('/admin/users/me').expect(401);
    await request(app.getHttpServer())
      .get('/admin/users/me')
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
    user.role = 'superadministrador';
    user.permissions = [];
    await request(app.getHttpServer())
      .get('/admin/users/me')
      .set('Authorization', 'Bearer valid-token')
      .expect(200)
      .expect(user);
  });
  it('returns the authenticated user with current role and permissions', async () => {
    user.role = 'superadministrador';
    user.permissions = [];
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer valid-token')
      .expect('Cache-Control', 'no-store')
      .expect(200)
      .expect(user);
  });
  it('rejects an authenticated user without the superadmin role', async () => {
    user.role = 'local_user';
    user.permissions = [];
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
  });
  it.each([
    'admin',
    'superadministardor',
    'Superadministrador',
    'superadministrador ',
  ])('requires the exact role name: %s', async (role) => {
    user.role = role;
    await request(app.getHttpServer())
      .get('/users/me?role=superadministrador')
      .set('Authorization', 'Bearer valid-token')
      .set('x-role', 'superadministrador')
      .expect(403);
  });
  it('applies role changes immediately with the same access token', async () => {
    user.role = 'superadministrador';
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);
    user.role = 'auditor';
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
  });
  it('accepts a listed role with all required permissions', async () => {
    await request(app.getHttpServer())
      .get('/protected-test')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);
  });
  it('rejects the wrong role despite having the permission', async () => {
    user.role = 'local_user';
    await request(app.getHttpServer())
      .get('/protected-test')
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
  });
  it('requires method permissions in addition to controller permissions', async () => {
    await request(app.getHttpServer())
      .get('/protected-test/export')
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
    user.permissions = ['users.export'];
    await request(app.getHttpServer())
      .get('/protected-test/export')
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
    user.permissions = ['users.read', 'users.export'];
    await request(app.getHttpServer())
      .get('/protected-test/export')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);
  });
  it('requires the narrower method role as well as the controller role', async () => {
    await request(app.getHttpServer())
      .get('/protected-test/admin')
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
    user.role = 'admin';
    await request(app.getHttpServer())
      .get('/protected-test/admin')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);
  });
  it('does not grant an implicit permission bypass to admin', async () => {
    user.role = 'admin';
    user.permissions = [];
    await request(app.getHttpServer())
      .get('/protected-test/admin')
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
  });
  it('ignores roles and permissions supplied in headers or query parameters', async () => {
    user.permissions = [];
    await request(app.getHttpServer())
      .get('/protected-test?role=admin&permissions=users.read')
      .set('Authorization', 'Bearer valid-token')
      .set('x-role', 'admin')
      .set('x-permissions', 'users.read')
      .expect(403);
  });
  it('enforces changes to permissions on the next request with the same token', async () => {
    await request(app.getHttpServer())
      .get('/protected-test')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);
    user.permissions = [];
    await request(app.getHttpServer())
      .get('/protected-test')
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
  });
});
