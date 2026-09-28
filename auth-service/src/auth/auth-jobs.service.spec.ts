import { ConfigService } from '@nestjs/config';
import { AuthJobsService } from './auth-jobs.service';
import { AuthRepository } from './auth.repository';
import { AuthEventsPublisher } from './auth-events.publisher';

describe('AuthJobsService', () => {
  it('retries one failed destination without losing the other delivery', async () => {
    const repository = {
      claimDeliveries: jest.fn().mockResolvedValue([
        {
          id: 'k',
          claimedBy: 'claim',
          destination: 'kafka',
          eventId: 'event',
          attempts: 0,
          payload: {},
        },
        {
          id: 'r',
          claimedBy: 'claim',
          destination: 'rabbit',
          eventId: 'event',
          attempts: 0,
          payload: {},
        },
      ]),
      delivered: jest.fn(),
      retryDelivery: jest.fn(),
      cleanup: jest.fn(),
    };
    const publisher = {
      publish: jest
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(undefined),
    };
    const jobs = new AuthJobsService(
      repository as unknown as AuthRepository,
      publisher as unknown as AuthEventsPublisher,
      new ConfigService({ AUTH_RETENTION_DAYS: 30 }),
    );
    await jobs.tick();
    expect(repository.retryDelivery).toHaveBeenCalledWith('k', 'claim', 1);
    expect(repository.delivered).toHaveBeenCalledWith('r', 'claim');
    expect(repository.delivered).not.toHaveBeenCalledWith('k', 'claim');
  });
});
