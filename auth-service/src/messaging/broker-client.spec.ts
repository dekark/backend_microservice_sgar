import { ConfigService } from '@nestjs/config';
import { ClientProxy, ClientProxyFactory } from '@nestjs/microservices';
import { NEVER, of } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { BrokerGateway } from './broker-client.module';

describe('BrokerGateway deadlines and replies', () => {
  let gateway: BrokerGateway;
  const client = { connect: jest.fn(), send: jest.fn(), close: jest.fn() };
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    gateway = new BrokerGateway(
      new ConfigService({
        RABBITMQ_URL: 'amqp://localhost',
        BROKER_RPC_TIMEOUT_MS: 1000,
      }),
    );
    jest
      .spyOn(ClientProxyFactory, 'create')
      .mockReturnValue(client as unknown as ClientProxy);
    client.connect.mockResolvedValue(undefined);
    client.send.mockReturnValue(NEVER);
  });
  afterEach(async () => {
    await gateway.onModuleDestroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  const command = () => ({
    version: 1 as const,
    requestId: randomUUID(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    method: 'GET' as const,
    path: '/auth/me',
  });

  it('counts connection time toward the total timeout', async () => {
    client.connect.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 750)),
    );
    let failure: unknown;
    const pending = gateway.send('auth', command()).catch((error) => {
      failure = error;
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(failure).toBeInstanceOf(Error);
    await pending;
  });
  it.each([
    null,
    {},
    { requestId: 'wrong', ok: true, statusCode: 200, data: {} },
  ])('rejects a malformed or unrelated reply: %j', async (response) => {
    client.send.mockReturnValue(of(response));
    await expect(gateway.send('auth', command())).rejects.toThrow();
  });
  it('preserves a correlated controller response', async () => {
    const input = command();
    const response = {
      requestId: input.requestId,
      ok: false,
      statusCode: 403,
      data: { message: 'Forbidden' },
    };
    client.send.mockReturnValue(of(response));
    await expect(gateway.send('auth', input)).resolves.toEqual(response);
  });
  it('discards a failed initialization so the next request can reconnect', async () => {
    client.connect.mockRejectedValueOnce(new Error('Broker unavailable'));
    await expect(gateway.send('auth', command())).rejects.toThrow(
      'Broker unavailable',
    );
    expect(client.send).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledTimes(1);
    const input = command();
    const response = {
      requestId: input.requestId,
      statusCode: 200,
      ok: true,
      data: {},
    };
    client.send.mockReturnValue(of(response));
    await expect(gateway.send('auth', input)).resolves.toEqual(response);
    expect(jest.mocked(ClientProxyFactory).create.mock.calls).toHaveLength(2);
    expect(client.send).toHaveBeenCalledTimes(1);
  });
});
