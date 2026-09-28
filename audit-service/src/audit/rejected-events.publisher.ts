import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { createHash } from 'node:crypto';
import { lastValueFrom, timeout } from 'rxjs';

@Injectable()
export class RejectedEventsPublisher {
  constructor(
    @Inject('AUDIT_REJECTED_EVENTS') private readonly client: ClientProxy,
  ) {}
  async publish(
    content: Buffer,
    reason: 'invalid_event' | 'conflicting_event',
  ): Promise<void> {
    // Do not copy malformed payloads: they may contain credentials or arbitrary data.
    const digest = createHash('sha256').update(content).digest('hex');
    const record = new RmqRecordBuilder({
      source: 'audit-service',
      reason,
      digest,
      rejectedAt: new Date().toISOString(),
    })
      .setOptions({
        persistent: true,
        messageId: digest,
        contentType: 'application/json',
      })
      .build();
    await lastValueFrom(
      this.client.emit('audit.auth.rejected', record).pipe(timeout(5000)),
    );
  }
}
