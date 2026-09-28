import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import { BrokerRpcExecutor } from 'database';
import type { BrokerCommand } from 'database';
import { UsersModule } from '../src/users/users.module';
import { UsersService } from '../src/users/users.service';
import { AreaUsersService } from '../src/users/area-users.service';
import { DatabaseCrudService } from '../src/crud/database-crud.service';
import { ImagesService } from '../src/media/images.service';
import { BrokerGateway } from '../src/messaging/broker-client.module';
import {
  BrokerRpcController,
  BrokerRpcService,
} from '../src/messaging/broker-rpc.module';

describe('Existing user controllers over both broker entry points', () => {
  let app: INestApplication;
  let controller: BrokerRpcController;
  const userId = randomUUID();
  const areaId = randomUUID();
  const users = { list: jest.fn(), create: jest.fn() };
  const areas = { list: jest.fn() };
  const images = { upload: jest.fn() };
  const gateway = { send: jest.fn() };
  const baseProfile = {
    id: userId,
    name: 'Test',
    email: 'test@example.com',
    roleId: 1,
    areaId,
    permissions: [],
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
        }),
        UsersModule,
      ],
    })
      .overrideProvider(UsersService)
      .useValue(users)
      .overrideProvider(AreaUsersService)
      .useValue(areas)
      .overrideProvider(ImagesService)
      .useValue(images)
      .overrideProvider(BrokerGateway)
      .useValue(gateway)
      .overrideProvider(DatabaseCrudService)
      .useValue({
        runArea: (work: (store: unknown) => unknown) =>
          work({
            authorize: (_: string, area: string) => {
              if (area !== areaId) throw new ForbiddenException();
            },
          }),
      })
      .compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const pool = {
      query: jest
        .fn()
        .mockResolvedValue({ rows: [{ request_id: 'reserved' }] }),
    };
    const executor = new BrokerRpcExecutor(
      pool as unknown as ConstructorParameters<typeof BrokerRpcExecutor>[0],
      'users',
      await app.getUrl(),
    );
    controller = new BrokerRpcController({
      handle: (input: unknown) => executor.execute(input),
    } as BrokerRpcService);
  });
  beforeEach(() => {
    jest.clearAllMocks();
    users.list.mockResolvedValue({ items: [], total: 0 });
    areas.list.mockResolvedValue({ items: [], total: 0 });
    images.upload.mockResolvedValue({ uploaded: true });
    gateway.send.mockImplementation(
      (_service: string, command: BrokerCommand) =>
        Promise.resolve({
          statusCode: command.accessToken === 'invalid' ? 401 : 200,
          ok: command.accessToken !== 'invalid',
          data: {
            ...baseProfile,
            role:
              command.accessToken === 'super'
                ? 'superadministrador'
                : command.accessToken === 'admin'
                  ? 'administrador'
                  : 'usuario normal',
          },
        }),
    );
  });
  afterAll(async () => {
    await app.close();
  });
  const command = (changes: Partial<BrokerCommand>): BrokerCommand => ({
    version: 1,
    requestId: randomUUID(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    method: 'GET',
    path: '/users',
    ...changes,
  });
  async function send(transport: string, input: BrokerCommand) {
    if (transport === 'kafka') return controller.kafka(input);
    const channel = { ack: jest.fn() };
    const result = await controller.rabbit(
      input,
      new RmqContext([{}, channel, 'users.rpc.v1']),
    );
    expect(channel.ack).toHaveBeenCalledTimes(1);
    return result;
  }
  it.each(['rabbit', 'kafka'])(
    '%s rejects anonymous, expired and wrong-role requests',
    async (transport) => {
      expect((await send(transport, command({}))).statusCode).toBe(401);
      expect(
        (await send(transport, command({ accessToken: 'invalid' }))).statusCode,
      ).toBe(401);
      expect(
        (await send(transport, command({ accessToken: 'normal' }))).statusCode,
      ).toBe(403);
      expect(users.list).not.toHaveBeenCalled();
    },
  );
  it.each(['rabbit', 'kafka'])(
    '%s preserves inherited administrative routes and search parameters',
    async (transport) => {
      expect(
        (
          await send(
            transport,
            command({
              path: '/admin/users',
              accessToken: 'super',
              query: { search: 'alice', page: 2 },
            }),
          )
        ).statusCode,
      ).toBe(200);
      expect(users.list).toHaveBeenCalledWith({ search: 'alice', page: '2' });
      expect(gateway.send).toHaveBeenCalledWith(
        'auth',
        expect.objectContaining({ path: '/auth/me', accessToken: 'super' }),
        'rabbit',
      );
    },
  );
  it.each(['rabbit', 'kafka'])(
    '%s enforces the assigned area before dispatching CRUD',
    async (transport) => {
      expect(
        (
          await send(
            transport,
            command({
              path: `/area-admin/areas/${areaId}/users`,
              accessToken: 'admin',
            }),
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await send(
            transport,
            command({
              path: `/area-admin/areas/${randomUUID()}/users`,
              accessToken: 'admin',
            }),
          )
        ).statusCode,
      ).toBe(403);
      expect(areas.list).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['rabbit', 'kafka'])(
    '%s executes avatar upload through the multipart interceptor',
    async (transport) => {
      const result = await send(
        transport,
        command({
          method: 'POST',
          path: '/users/me/avatar',
          accessToken: 'normal',
          file: {
            filename: 'avatar.png',
            contentType: 'image/png',
            base64: Buffer.from('test-file').toString('base64'),
          },
        }),
      );
      expect(result.statusCode).toBe(200);
      expect(images.upload).toHaveBeenCalledWith(
        'users',
        userId,
        expect.objectContaining({ actorId: userId, mode: 'self' }),
        expect.objectContaining({ buffer: Buffer.from('test-file') }),
      );
    },
  );
});
