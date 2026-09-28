import type { ClientProxy } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';
import { RejectedEventsPublisher } from './rejected-events.publisher';

describe('RejectedEventsPublisher', () => {
  it('publishes a persistent fingerprint without retaining the original payload', async () => {
    const client = { emit: jest.fn().mockReturnValue(of(undefined)) };
    const publisher = new RejectedEventsPublisher(
      client as unknown as ClientProxy,
    );
    await publisher.publish(Buffer.from('sensitive-token'), 'invalid_event');
    const serialized = JSON.stringify(client.emit.mock.calls);
    expect(serialized).not.toContain('sensitive-token');
    expect(serialized).toContain('audit.auth.rejected');
    expect(serialized).toContain('"persistent":true');
    expect(serialized).toContain('"reason":"invalid_event"');
  });
  it('propagates broker failure', async () => {
    const client = {
      emit: jest.fn().mockReturnValue(throwError(() => new Error('offline'))),
    };
    await expect(
      new RejectedEventsPublisher(client as unknown as ClientProxy).publish(
        Buffer.from('{}'),
        'invalid_event',
      ),
    ).rejects.toThrow('offline');
  });
});
