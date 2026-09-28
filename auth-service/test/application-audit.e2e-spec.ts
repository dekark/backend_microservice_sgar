import {
  Controller,
  Get,
  Post,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import type { INestApplication, CanActivate } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ApplicationOutbox } from 'database';
import type { ApplicationEvent } from 'database';

class DenyGuard implements CanActivate {
  canActivate(): boolean {
    throw new ForbiddenException();
  }
}
@Controller('test')
class TestController {
  @Get('items/:id') read() {
    return { ok: true };
  }
  @Post('items') create() {
    return { ok: true };
  }
  @Get('denied') @UseGuards(DenyGuard) denied() {
    throw new Error('must not run');
  }
}

describe('Audit middleware before routing and guards', () => {
  let app: INestApplication<App>;
  let outbox: ApplicationOutbox;
  const query = jest.fn();
  const events = () =>
    (query.mock.calls as [string, [string, string, string]][]).map(
      (call) => JSON.parse(call[1][2]) as ApplicationEvent,
    );
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TestController],
    }).compile();
    app = module.createNestApplication();
    outbox = new ApplicationOutbox(
      { query } as unknown as ConstructorParameters<
        typeof ApplicationOutbox
      >[0],
      'resources-service',
      () => undefined,
    );
    app.use(outbox.trackHttp.bind(outbox));
    await app.init();
  });
  beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [] });
  });
  afterAll(async () => {
    await app.close();
    await outbox.drain();
  });
  it('captures read results without persisting path parameters, headers or query values', async () => {
    await request(app.getHttpServer())
      .get('/test/items/private-id?search=private-search')
      .set('Authorization', 'Bearer private-token')
      .expect(200)
      .expect('X-Request-Id', /^[0-9a-f-]{36}$/);
    await outbox.drain();
    expect(events()).toHaveLength(2);
    expect(events()[1]).toMatchObject({
      action: 'http.completed',
      metadata: { route: '/test/items/:id', statusCode: 200 },
    });
    expect(JSON.stringify(events())).not.toContain('private');
  });
  it('identifies the requested record using only UUID or numeric route IDs', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    await request(app.getHttpServer()).get(`/test/items/${id}`).expect(200);
    await outbox.drain();
    expect(events()[1]).toMatchObject({ entity: 'resources', entityId: id });
  });
  it('captures rejected guards and unmatched endpoints', async () => {
    await request(app.getHttpServer()).get('/test/denied').expect(403);
    await request(app.getHttpServer()).get('/private-secret-route').expect(404);
    await outbox.drain();
    expect(
      events()
        .filter((event) => event.action === 'http.completed')
        .map((event) => event.metadata.statusCode),
    ).toEqual([403, 404]);
    expect(JSON.stringify(events())).not.toContain('private-secret');
  });
  it('captures parser errors before controllers run', async () => {
    await request(app.getHttpServer())
      .post('/test/items')
      .set('Content-Type', 'application/json')
      .send('{malformed-private')
      .expect(400);
    await outbox.drain();
    expect(events()[1]).toMatchObject({
      action: 'http.completed',
      metadata: { statusCode: 400 },
    });
    expect(JSON.stringify(events())).not.toContain('malformed-private');
  });
  it('returns 503 instead of executing a request without a durable admission event', async () => {
    query.mockRejectedValue(new Error('private database error'));
    const response = await request(app.getHttpServer())
      .post('/test/items')
      .send({})
      .expect(503);
    expect(JSON.stringify(response.body)).not.toContain('private');
  });
});
