import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { PermissionsModule } from '../src/permissions/permissions.module';
import { DatabaseCrudService } from '../src/crud/database-crud.service';
import { AuthSessionService } from '../src/security/auth-session.service';

describe('Permissions HTTP surface (isolated)', () => {
  let app: INestApplication<App>;
  const authenticate = jest.fn();
  const database = { run: jest.fn() };

  beforeAll(async () => {
    // Import the HTTP feature without AppModule: no .env, outbox or broker workers.
    const module = await Test.createTestingModule({
      imports: [PermissionsModule],
      controllers: [AppController],
      providers: [AppService],
    })
      .overrideProvider(DatabaseCrudService)
      .useValue(database)
      .overrideProvider(AuthSessionService)
      .useValue({ authenticate })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authenticate.mockResolvedValue({ id: 'test-user', role: 'usuario normal' });
    database.run.mockResolvedValue([]);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keeps the public root available', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it.each(['/permissions', '/admin/permissions'])(
    'requires a session for %s',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(401);
      expect(authenticate).not.toHaveBeenCalled();
      expect(database.run).not.toHaveBeenCalled();
    },
  );

  it.each(['/permissions', '/admin/permissions'])(
    'rejects a non-superadmin at %s before accessing data',
    async (path) => {
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', 'Bearer test-token')
        .expect(403);
      expect(database.run).not.toHaveBeenCalled();
    },
  );

  it.each(['/permissions', '/admin/permissions'])(
    'allows a superadmin to list %s',
    async (path) => {
      authenticate.mockResolvedValue({
        id: 'test-user',
        role: 'superadministrador',
      });
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', 'Bearer test-token')
        .expect('Cache-Control', 'no-store')
        .expect(200)
        .expect([]);
      expect(authenticate).toHaveBeenCalledWith('test-token');
      expect(database.run).toHaveBeenCalledTimes(1);
    },
  );
});
