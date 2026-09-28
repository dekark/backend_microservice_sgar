import { ConfigService } from '@nestjs/config';
import { Transport } from '@nestjs/microservices';
import type { RmqOptions } from '@nestjs/microservices';

export function auditRabbitOptions(config: ConfigService): RmqOptions {
  return {
    transport: Transport.RMQ,
    options: {
      urls: [config.getOrThrow<string>('RABBITMQ_URL')],
      queue: config.getOrThrow<string>('AUTH_AUDIT_QUEUE'),
      queueOptions: { durable: true },
      noAck: false,
      prefetchCount: config.getOrThrow<number>('AUDIT_PREFETCH_COUNT'),
      // Route malformed/unknown envelopes to validation instead of silently dropping them.
      deserializer: {
        deserialize(value: unknown) {
          const packet =
            value && typeof value === 'object'
              ? (value as Record<string, unknown>)
              : {};
          const supported =
            packet.pattern === 'audit.auth.record' ||
            packet.pattern === 'audit.application.record';
          return {
            pattern: supported ? packet.pattern : 'audit.auth.record',
            data: supported && !('id' in packet) ? packet.data : null,
          };
        },
      },
    },
  };
}
