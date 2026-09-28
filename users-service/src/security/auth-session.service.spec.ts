import { ConfigService } from '@nestjs/config';
import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthSessionService } from './auth-session.service';
import { BrokerGateway } from '../messaging/broker-client.module';
import type { BrokerReply } from 'database';

const profile = {
  id: 'user-id',
  email: 'person@example.com',
  name: 'Person',
  roleId: 1,
  role: 'auditor',
  areaId: null,
  permissions: ['users.read'],
};

const reply = (data: unknown, statusCode = 200): BrokerReply => ({
  requestId: null,
  ok: statusCode === 200,
  statusCode,
  data,
});

describe('AuthSessionService', () => {
  let service: AuthSessionService;
  let config: ConfigService;
  let send: jest.SpiedFunction<BrokerGateway['send']>;
  beforeEach(() => {
    config = new ConfigService({ AUTH_RPC_TRANSPORT: 'rabbit' });
    const gateway = new BrokerGateway(config);
    service = new AuthSessionService(config, gateway);
    send = jest.spyOn(gateway, 'send');
  });
  afterEach(() => jest.restoreAllMocks());

  it('forwards only the bearer token over RPC and filters the result', async () => {
    send.mockResolvedValue(reply({ ...profile, secret: 'must-not-return' }));
    expect(await service.authenticate('signed-token')).toEqual(profile);
    const [target, command, transport] = send.mock.calls[0];
    expect(target).toBe('auth');
    expect(transport).toBe('rabbit');
    expect(command).toMatchObject({
      version: 1,
      method: 'GET',
      path: '/auth/me',
      accessToken: 'signed-token',
    });
    expect(command).not.toHaveProperty('body');
    expect(command).not.toHaveProperty('user');
    expect(Date.parse(command.expiresAt)).toBeGreaterThan(Date.now());
  });
  it('supports Kafka session verification', async () => {
    config.set('AUTH_RPC_TRANSPORT', 'kafka');
    send.mockResolvedValue(reply(profile));
    await service.authenticate('signed-token');
    expect(send.mock.calls[0][2]).toBe('kafka');
  });
  it('rejects an invalid transport without publishing', async () => {
    config.set('AUTH_RPC_TRANSPORT', 'invalid');
    await expect(service.authenticate('token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(send).not.toHaveBeenCalled();
  });
  it('does not reuse cached roles or permissions between requests', async () => {
    send.mockResolvedValueOnce(reply(profile));
    send.mockResolvedValueOnce(reply({ ...profile, permissions: [] }));
    expect((await service.authenticate('same-token')).permissions).toEqual([
      'users.read',
    ]);
    expect((await service.authenticate('same-token')).permissions).toEqual([]);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 429, 500])(
    'rejects auth-service status %s',
    async (status) => {
      send.mockResolvedValue(reply(null, status));
      const exception =
        status === 401
          ? UnauthorizedException
          : status === 403
            ? ForbiddenException
            : ServiceUnavailableException;
      await expect(service.authenticate('token')).rejects.toBeInstanceOf(
        exception,
      );
    },
  );
  it.each([
    null,
    {},
    { ...profile, permissions: '*' },
    { ...profile, role: '' },
    { ...profile, permissions: [true] },
  ])('rejects an invalid profile: %j', async (body) => {
    send.mockResolvedValue(reply(body));
    await expect(service.authenticate('token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('rejects a non-object profile', async () => {
    send.mockResolvedValue(reply('not-json'));
    await expect(service.authenticate('token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it.each([
    null,
    undefined,
    {},
    { statusCode: 200, ok: 'true', data: profile },
  ])('fails closed with a malformed broker reply: %j', async (response) => {
    send.mockResolvedValue(response as unknown as BrokerReply);
    await expect(service.authenticate('token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('fails closed on network errors without exposing backend details', async () => {
    send.mockRejectedValue(new Error('private backend details'));
    await expect(service.authenticate('token')).rejects.toThrow(
      'No se pudo verificar la sesion',
    );
  });
});
