import { ConfigService } from '@nestjs/config';
import { RmqContext } from '@nestjs/microservices';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { RejectedEventsPublisher } from './rejected-events.publisher';
import { InvalidAuthEventError, ConflictingAuthEventError } from './auth-event';
import { InvalidApplicationEventError } from 'database';

describe('AuditController acknowledgements', () => {
  let controller: AuditController;
  let audit: { recordAuthEvent: jest.Mock; recordApplicationEvent: jest.Mock };
  let rejected: { publish: jest.Mock };
  let channel: { ack: jest.Mock; nack: jest.Mock };
  let context: RmqContext;
  const message = { content: Buffer.from('secret-input') };
  beforeEach(() => {
    audit = {
      recordAuthEvent: jest.fn().mockResolvedValue(undefined),
      recordApplicationEvent: jest.fn().mockResolvedValue(undefined),
    };
    rejected = { publish: jest.fn().mockResolvedValue(undefined) };
    channel = { ack: jest.fn(), nack: jest.fn() };
    context = new RmqContext([message, channel, 'audit.auth.record']);
    controller = new AuditController(
      audit as unknown as AuditService,
      rejected as unknown as RejectedEventsPublisher,
      new ConfigService({ AUDIT_RETRY_DELAY_MS: 1 }),
    );
  });
  it('does not acknowledge until persistence completes', async () => {
    let finish: () => void = () => undefined;
    audit.recordAuthEvent.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = controller.record({}, context);
    expect(channel.ack).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });
  it('requeues a database failure without acknowledging it', async () => {
    audit.recordAuthEvent.mockRejectedValue(new Error('database offline'));
    await controller.record({}, context);
    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
    expect(channel.ack).not.toHaveBeenCalled();
  });
  it('routes application messages to the application validator and acknowledges persistence', async () => {
    const ctx = new RmqContext([message, channel, 'audit.application.record']);
    await controller.record({ version: 1 }, ctx);
    expect(audit.recordApplicationEvent).toHaveBeenCalledWith({ version: 1 });
    expect(audit.recordAuthEvent).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(message);
  });
  it('quarantines malformed application messages instead of retrying forever', async () => {
    audit.recordApplicationEvent.mockRejectedValue(
      new InvalidApplicationEventError(),
    );
    await controller.record(
      {},
      new RmqContext([message, channel, 'audit.application.record']),
    );
    expect(rejected.publish).toHaveBeenCalledWith(
      message.content,
      'invalid_event',
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
  });
  it.each([
    [new InvalidAuthEventError(), 'invalid_event'],
    [new ConflictingAuthEventError(), 'conflicting_event'],
  ])(
    'acknowledges rejected input only after publishing a rejection receipt',
    async (error, reason) => {
      audit.recordAuthEvent.mockRejectedValue(error);
      await controller.record({}, context);
      expect(rejected.publish).toHaveBeenCalledWith(message.content, reason);
      expect(channel.ack).toHaveBeenCalledWith(message);
    },
  );
  it('requeues if the rejection receipt cannot be persisted to RabbitMQ', async () => {
    audit.recordAuthEvent.mockRejectedValue(new InvalidAuthEventError());
    rejected.publish.mockRejectedValue(new Error('broker down'));
    await controller.record({}, context);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
  });
});
