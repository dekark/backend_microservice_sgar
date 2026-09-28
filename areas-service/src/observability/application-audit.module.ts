import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import type { Request, Response, NextFunction } from 'express';
import { lastValueFrom, timeout } from 'rxjs';
import {
  ApplicationOutbox,
  applicationMessagingConfig,
  createTransactionalDatabase,
} from 'database';
import type { ApplicationEvent, EventDestination } from 'database';
import { KafkaModule } from '../kafka/kafka.module';
import { RabbitModule } from '../rabbit/rabbit.module';

@Injectable()
export class ApplicationAuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApplicationAuditService.name);
  private readonly connection: ReturnType<typeof createTransactionalDatabase>;
  private readonly outbox: ApplicationOutbox;
  private readonly settings: ReturnType<typeof applicationMessagingConfig>;
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(
    config: ConfigService,
    @Inject('KAFKA_SERVICE') private readonly kafka: ClientProxy,
    @Inject('RABBITMQ_SERVICE') private readonly rabbit: ClientProxy,
  ) {
    this.settings = applicationMessagingConfig(config);
    this.connection = createTransactionalDatabase(
      config.getOrThrow<string>('DATABASE_URL'),
    );
    this.connection.pool.on('error', () =>
      this.logger.error('Audit database connection error'),
    );
    this.outbox = new ApplicationOutbox(
      this.connection.pool,
      'areas-service',
      (message) => this.logger.error(message),
    );
  }
  use(request: Request, response: Response, next: NextFunction) {
    this.outbox.trackHttp(request, response, next);
  }
  onModuleInit() {
    // This flag pauses transport delivery only; capture remains mandatory.
    if (!this.settings.enabled) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.outbox
        .deliver((destination, event) => this.publish(destination, event))
        .catch(() =>
          this.logger.error(
            'Application event delivery unavailable; pending events are retained',
          ),
        )
        .finally(() => {
          this.running = undefined;
        });
    }, this.settings.interval);
    this.timer.unref();
  }
  private async publish(
    destination: EventDestination,
    event: ApplicationEvent,
  ) {
    const delivery =
      destination === 'kafka'
        ? this.kafka.emit(this.settings.topic, {
            key: event.entityId ?? event.requestId ?? event.eventId,
            value: event,
          })
        : this.rabbit.emit(
            'audit.application.record',
            new RmqRecordBuilder(event)
              .setOptions({
                persistent: true,
                messageId: event.eventId,
                contentType: 'application/json',
              })
              .build(),
          );
    await lastValueFrom(delivery.pipe(timeout(5000)));
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
    await this.outbox.drain();
    await this.connection.pool.end();
  }
}

@Module({
  imports: [ConfigModule, KafkaModule, RabbitModule],
  providers: [ApplicationAuditService],
  exports: [ApplicationAuditService],
})
export class ApplicationAuditModule {}
