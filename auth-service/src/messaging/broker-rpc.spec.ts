import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { RmqContext, Transport } from '@nestjs/microservices';
import { BrokerRpcExecutor, parseBrokerCommand } from 'database';
import type { BrokerCommand } from 'database';
import {
  BrokerRpcController,
  BrokerRpcService,
  brokerRpcOptions,
} from './broker-rpc.module';

const command = (changes: Partial<BrokerCommand> = {}): BrokerCommand => ({
  version: 1,
  requestId: randomUUID(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  method: 'GET',
  path: '/auth/me',
  accessToken: 'private-token',
  ...changes,
});
describe('Broker command validation', () => {
  it.each([
    'https://evil.test',
    '//evil.test',
    '/a/../auth/me',
    '/a/%2e%2e/auth/me',
    '/a\\b',
    '/a?token=secret',
    '/a#fragment',
  ])('rejects routing outside the declared local path: %s', (path) => {
    expect(() => parseBrokerCommand(command({ path }))).toThrow();
  });
  it('rejects caller-supplied identities or headers', () => {
    expect(() =>
      parseBrokerCommand({
        ...command(),
        user: { role: 'superadministrador' },
      }),
    ).toThrow();
    expect(() =>
      parseBrokerCommand({
        ...command(),
        headers: { authorization: 'secret' },
      }),
    ).toThrow();
  });
  it('rejects expired messages before dispatch', () => {
    expect(() =>
      parseBrokerCommand(command({ expiresAt: new Date(0).toISOString() })),
    ).toThrow('vencido');
  });
  it('bounds files and rejects noncanonical base64', () => {
    expect(() =>
      parseBrokerCommand(
        command({
          method: 'POST',
          file: {
            filename: 'a.png',
            contentType: 'image/png',
            base64: '@@invalid@@',
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      parseBrokerCommand(
        command({
          method: 'POST',
          file: {
            filename: 'a.png',
            contentType: 'image/png',
            base64: Buffer.alloc(262145).toString('base64'),
          },
        }),
      ),
    ).toThrow('256 KiB');
  });
});

describe('RPC dispatch and duplicate protection', () => {
  let query: jest.Mock;
  let send: jest.Mock;
  let executor: BrokerRpcExecutor;
  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [{ request_id: 'reserved' }] });
    send = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'result' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    executor = new BrokerRpcExecutor(
      { query } as unknown as ConstructorParameters<
        typeof BrokerRpcExecutor
      >[0],
      'auth',
      'http://127.0.0.1:3000',
      1000,
      send as typeof fetch,
    );
  });
  it('sends only the bearer credential, query and body through the real router', async () => {
    const result = await executor.execute(command({ query: { page: 2 } }));
    expect(result).toMatchObject({
      ok: true,
      statusCode: 200,
      data: { id: 'result' },
    });
    expect(send).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:3000/auth/me?page=2'),
      expect.objectContaining({
        redirect: 'manual',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer private-token',
        },
      }),
    );
    expect(query).not.toHaveBeenCalled();
  });
  it('does not execute a redelivered write', async () => {
    query.mockResolvedValue({ rows: [] });
    const result = await executor.execute(
      command({ method: 'POST', path: '/auth/logout' }),
    );
    expect(result.statusCode).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });
  it('accepts a local origin with a trailing slash', async () => {
    const local = new BrokerRpcExecutor(
      {} as ConstructorParameters<typeof BrokerRpcExecutor>[0],
      'auth',
      'http://127.0.0.1:3000/',
      1000,
      send as typeof fetch,
    );
    expect((await local.execute(command())).statusCode).toBe(200);
  });
  it('does not mark a write as uncertain if it expires before HTTP dispatch', async () => {
    const input = command({
      method: 'POST',
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    const now = jest.spyOn(Date, 'now');
    query.mockImplementation(() => {
      now.mockReturnValue(Date.parse(input.expiresAt) + 1);
      return Promise.resolve({ rows: [{ request_id: input.requestId }] });
    });
    try {
      expect((await executor.execute(input)).statusCode).toBe(408);
      expect(send).not.toHaveBeenCalled();
      expect(query).toHaveBeenLastCalledWith(
        expect.stringContaining('UPDATE broker_commands'),
        expect.arrayContaining(['completed', 408]),
      );
    } finally {
      now.mockRestore();
    }
  });
  it('does not execute writes if the reservation cannot be persisted', async () => {
    query.mockRejectedValue(new Error('private database details'));
    expect(
      (await executor.execute(command({ method: 'POST' }))).statusCode,
    ).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });
  it('keeps timed-out mutations reserved and never caches credentials', async () => {
    send.mockRejectedValue(new Error('private upstream details'));
    const result = await executor.execute(
      command({
        method: 'POST',
        path: '/auth/google',
        body: { idToken: 'private-google' },
      }),
    );
    expect(result.statusCode).toBe(504);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE broker_commands'),
      expect.arrayContaining(['uncertain']),
    );
    expect(JSON.stringify(query.mock.calls)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it.each([401, 403, 404, 422])(
    'preserves controller rejection %s',
    async (status) => {
      send.mockResolvedValue(
        new Response('{}', {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
      expect(await executor.execute(command())).toMatchObject({
        statusCode: status,
        ok: false,
      });
    },
  );
  it('refuses to construct a dispatcher for a remote server', () => {
    expect(
      () =>
        new BrokerRpcExecutor(
          {} as ConstructorParameters<typeof BrokerRpcExecutor>[0],
          'auth',
          'https://evil.test',
        ),
    ).toThrow();
  });
});

describe('Transport registration and acknowledgements', () => {
  it('registers independent RPC queues and Kafka consumer groups', () => {
    const options = brokerRpcOptions(
      new ConfigService({ RABBITMQ_URL: 'amqp://localhost' }),
    );
    expect(options).toMatchObject([
      {
        transport: Transport.RMQ,
        options: { queue: 'auth_rpc', noAck: false },
      },
      {
        transport: Transport.KAFKA,
        options: { consumer: { groupId: 'auth-service-rpc-v1' } },
      },
    ]);
  });
  it('acknowledges RabbitMQ only after processing completes and shares execution with Kafka', async () => {
    let finish!: (value: unknown) => void;
    const rpc = {
      handle: jest.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const controller = new BrokerRpcController(
      rpc as unknown as BrokerRpcService,
    );
    const channel = { ack: jest.fn() };
    const message = {};
    const pending = controller.rabbit(
      {},
      new RmqContext([message, channel, 'auth.rpc.v1']),
    );
    expect(channel.ack).not.toHaveBeenCalled();
    finish({ statusCode: 200 });
    await pending;
    expect(channel.ack).toHaveBeenCalledWith(message);
    const kafka = controller.kafka({ version: 1 });
    finish({ statusCode: 200 });
    await kafka;
    expect(rpc.handle).toHaveBeenLastCalledWith({ version: 1 });
  });
});
