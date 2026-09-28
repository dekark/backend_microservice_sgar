import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { firstValueFrom, from, lastValueFrom, timeout } from 'rxjs';
import type { Subscription } from 'rxjs';
import type { AuthEvent } from 'database';

@Injectable()
export class AuthEventsPublisher implements OnModuleInit, OnModuleDestroy {
  private states = { kafka: 'disconnected', rabbit: 'disconnected' };
  private subscriptions: Subscription[] = [];
  constructor(
    @Inject('KAFKA_SERVICE') private readonly kafka: ClientProxy,
    @Inject('RABBITMQ_SERVICE') private readonly rabbit: ClientProxy,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.subscriptions = [
      this.kafka.status.subscribe((status) => {
        this.states.kafka = status;
      }),
      this.rabbit.status.subscribe((status) => {
        this.states.rabbit = status;
      }),
    ];
  }
  onModuleDestroy() {
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
  }

  async connections() {
    const result = await Promise.allSettled([
      firstValueFrom(from(this.kafka.connect()).pipe(timeout(4000))),
      firstValueFrom(from(this.rabbit.connect()).pipe(timeout(4000))),
    ]);
    return {
      kafka:
        result[0].status === 'fulfilled' && this.states.kafka === 'connected',
      rabbitmq:
        result[1].status === 'fulfilled' && this.states.rabbit === 'connected',
    };
  }
  async publish(
    destination: 'kafka' | 'rabbit',
    event: AuthEvent,
  ): Promise<void> {
    const delivery =
      destination === 'kafka'
        ? this.kafka.emit(this.config.getOrThrow<string>('AUTH_KAFKA_TOPIC'), {
            key: event.userId ?? event.eventId,
            value: event,
          })
        : this.rabbit.emit(
            'audit.auth.record',
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
}
