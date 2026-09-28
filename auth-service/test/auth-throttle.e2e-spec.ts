import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { AuthenticatedThrottlerGuard } from '../src/auth/authenticated-throttler.guard';

describe('Authenticated users sharing a broker loopback address', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 2 }])],
      controllers: [AuthController],
      providers: [
        JwtAuthGuard,
        AuthenticatedThrottlerGuard,
        {
          provide: AuthService,
          useValue: {
            authenticate: (token: string) => {
              if (token === 'invalid') throw new UnauthorizedException();
              return { user: { id: token }, sessionId: 'session' };
            },
            profile: () => ({ authenticated: true }),
            loginWithGoogle: () => ({ loggedIn: true }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('limits each authenticated user without blocking another user on the same IP', async () => {
    for (let i = 0; i < 2; i++)
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer alice')
        .expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer alice')
      .expect(429);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer bob')
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer alice')
      .set('X-Forwarded-For', '203.0.113.5')
      .send({ user: { id: 'mallory' } })
      .expect(429);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
  });
  it('keeps the public Google login limit by IP', async () => {
    for (let i = 0; i < 10; i++)
      await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: 'test' })
        .expect(200);
    await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: 'test' })
      .expect(429);
  });
});
