import { Controller, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Ctx,
  EventPattern,
  Payload,
  RmqContext,
  Transport,
} from '@nestjs/microservices';
import type { Channel, ConsumeMessage } from 'amqplib';
import { setTimeout as delay } from 'node:timers/promises';
import { AuditService } from './audit.service';
import { ConflictingAuthEventError, InvalidAuthEventError } from './auth-event';
import { RejectedEventsPublisher } from './rejected-events.publisher';
import { InvalidApplicationEventError } from 'database';

@Controller()
export class AuditController {
  private readonly logger = new Logger(AuditController.name);
  constructor(
    private readonly audit: AuditService,
    private readonly rejected: RejectedEventsPublisher,
    private readonly config: ConfigService,
  ) {}

  @EventPattern(
    ['audit.auth.record', 'audit.application.record'],
    Transport.RMQ,
  )
  async record(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef() as Channel;
    const message = context.getMessage() as ConsumeMessage;
    try {
      if (context.getPattern() === 'audit.application.record') {
        await this.audit.recordApplicationEvent(payload);
      } else {
        await this.audit.recordAuthEvent(payload);
      }
    } catch (error) {
      if (
        error instanceof InvalidAuthEventError ||
        error instanceof InvalidApplicationEventError ||
        error instanceof ConflictingAuthEventError
      ) {
        try {
          await this.rejected.publish(
            message.content,
            error instanceof ConflictingAuthEventError
              ? 'conflicting_event'
              : 'invalid_event',
          );
        } catch {
          await this.retry(channel, message);
          return;
        }
      } else {
        await this.retry(channel, message);
        return;
      }
    }
    // DB commit or confirmed publication of a sanitized rejection must happen first.
    channel.ack(message);
  }

  private async retry(channel: Channel, message: ConsumeMessage) {
    this.logger.warn('Audit delivery pending; retrying without acknowledging');
    await delay(this.config.getOrThrow<number>('AUDIT_RETRY_DELAY_MS'));
    channel.nack(message, false, true);
  }
}
