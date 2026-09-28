import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthModule } from '../src/auth/auth.module';
import { AuthRepository } from '../src/auth/auth.repository';
import { GoogleTokenService } from '../src/auth/google-token.service';
import { validateEnvironment } from '../src/config/environment';

describe('Authentication HTTP flow', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    name: 'User',
    roleId: 1,
    role: 'reader',
    areaId: null,
    isActive: true,
    roleIsActive: true,
  };
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const repository = {
    login: jest.fn(),
    findPrincipal: jest.fn(),
    permissionKeys: jest.fn().mockResolvedValue(['resources.read']),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    revoke: jest.fn().mockResolvedValue(undefined),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [
            () =>
              validateEnvironment({
                DATABASE_URL: 'postgresql://user:password@localhost/test',
                GOOGLE_CLIENT_ID: 'test-client',
                JWT_SECRET: 'test-secret-only-'.repeat(3),
                AUTH_BACKGROUND_JOBS_ENABLED: 'false',
              }),
          ],
        }),
        AuthModule,
      ],
    })
      .overrideProvider(AuthRepository)
      .useValue(repository)
      .overrideProvider(GoogleTokenService)
      .useValue({
        verify: jest.fn().mockResolvedValue({
          sub: 'google-sub',
          email: user.email,
          name: user.name,
        }),
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
    jwt = module.get(JwtService);
  });
  beforeEach(() => {
    repository.login.mockResolvedValue(user);
    repository.findPrincipal.mockResolvedValue({ user, sessionId });
  });
  afterAll(async () => {
    await app.close();
  });
  it('exchanges a Google token for application credentials and reads the profile', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: 'google-credential' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    const body = login.body as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    };
    expect(body.expiresIn).toBe(900);
    expect(body.refreshToken).toBeTruthy();
    const profile = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect(profile.body).toMatchObject({
      id: user.id,
      permissions: ['resources.read'],
    });
  });
  it('rejects missing Google credentials', async () => {
    await request(app.getHttpServer())
      .post('/auth/google')
      .send({})
      .expect(400);
  });
  it.each([
    { code: 'authorization-code' },
    { accessToken: 'google-api-access-token' },
  ])('requires an ID token for frontend login: %p', async (body) => {
    await request(app.getHttpServer())
      .post('/auth/google')
      .send(body)
      .expect(400);
  });
  it('does not expose a backend Google authorization flow', async () => {
    await request(app.getHttpServer()).get('/auth/google/config').expect(404);
    await request(app.getHttpServer()).post('/auth/google/start').expect(404);
    await request(app.getHttpServer())
      .post('/auth/google/callback')
      .send({ code: 'code', state: 'state', flowToken: 'flow' })
      .expect(404);
  });
  it.each(['', 'Basic abc', 'Bearer broken', 'Bearer a b'])(
    'rejects bad authorization %s',
    async (header) => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', header)
        .expect(401);
    },
  );
  it.each([
    { expiresIn: -1 },
    { issuer: 'other' },
    { audience: 'other' },
    { secret: 'another-secret-that-is-long-enough' },
    { algorithm: 'HS384' as const },
  ])('rejects JWTs with wrong signatures or claims: %p', async (options) => {
    const token = await jwt.signAsync(
      { sub: user.id, sid: sessionId, token_use: 'access' },
      options,
    );
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
  it('rejects disabled accounts', async () => {
    const token = await jwt.signAsync({
      sub: user.id,
      sid: sessionId,
      token_use: 'access',
    });
    repository.findPrincipal.mockResolvedValue({
      user: { ...user, isActive: false },
      sessionId,
    });
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
  it('protects session management and validates session IDs', async () => {
    await request(app.getHttpServer()).post('/auth/logout-all').expect(401);
    const token = await jwt.signAsync({
      sub: user.id,
      sid: sessionId,
      token_use: 'access',
    });
    await request(app.getHttpServer())
      .delete('/auth/sessions/not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
  it('limits repeated login attempts', async () => {
    // Earlier cases have already used requests from this IP.
    let status = 0;
    for (let i = 0; i < 11; i++) {
      status = (
        await request(app.getHttpServer())
          .post('/auth/google')
          .send({ idToken: 'token' })
      ).status;
      if (status === 429) break;
    }
    expect(status).toBe(429);
  });
});
