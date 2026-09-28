import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthHealthController } from './auth-health.controller';
import { AuthRepository } from './auth.repository';
import { AuthEventsPublisher } from './auth-events.publisher';

describe('Auth readiness', () => {
  const repository = { ping: jest.fn() };
  const events = { connections: jest.fn() };
  const controller = new AuthHealthController(
    repository as unknown as AuthRepository,
    events as unknown as AuthEventsPublisher,
    new ConfigService({ AUTH_GOOGLE_ENABLED: false }),
  );
  beforeEach(() => {
    repository.ping.mockResolvedValue(undefined);
    events.connections.mockResolvedValue({ kafka: true, rabbitmq: true });
  });
  it('reports infrastructure readiness separately from Google configuration', async () => {
    await expect(controller.ready()).resolves.toMatchObject({
      status: 'ok',
      googleLoginEnabled: false,
      components: { database: true, kafka: true, rabbitmq: true },
    });
  });
  it('reports a missing migration without exposing database error details', async () => {
    repository.ping.mockRejectedValue(
      new Error('secret database connection detail'),
    );
    try {
      await controller.ready();
      throw new Error('Expected 503');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(
        JSON.stringify((error as ServiceUnavailableException).getResponse()),
      ).not.toContain('secret');
    }
  });
  it('returns 503 if a broker is disconnected', async () => {
    events.connections.mockResolvedValue({ kafka: false, rabbitmq: true });
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
