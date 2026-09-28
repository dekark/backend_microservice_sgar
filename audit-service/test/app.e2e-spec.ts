import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuditModule } from '../src/audit/audit.module';
import { AuditRepository } from '../src/audit/audit.repository';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { validateEnvironment } from '../src/config/environment';

describe('Audit HTTP surface', () => {
  let app: INestApplication<App>;
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
              }),
          ],
        }),
        AuditModule,
      ],
      controllers: [AppController],
      providers: [AppService],
    })
      .overrideProvider(AuditRepository)
      .useValue({ persist: jest.fn() })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('keeps the existing HTTP root available', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
  it('requires authentication for audit writing and reading', async () => {
    await request(app.getHttpServer()).post('/audit').send({}).expect(401);
    await request(app.getHttpServer()).get('/audit').expect(401);
  });
});
