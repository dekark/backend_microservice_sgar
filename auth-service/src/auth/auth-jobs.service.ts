import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthRepository } from './auth.repository';
import { AuthEventsPublisher } from './auth-events.publisher';

@Injectable()
export class AuthJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthJobsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private lastCleanup = 0;
  constructor(
    private readonly repository: AuthRepository,
    private readonly publisher: AuthEventsPublisher,
    private readonly config: ConfigService,
  ) {}
  onModuleInit() {
    if (!this.config.get<boolean>('AUTH_BACKGROUND_JOBS_ENABLED')) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.tick()
        .catch(() => {
          this.logger.error(
            'No se pudo procesar la cola de eventos de autenticacion',
          );
        })
        .finally(() => {
          this.running = undefined;
        });
    }, this.config.getOrThrow<number>('AUTH_OUTBOX_INTERVAL_MS'));
    this.timer.unref();
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  async tick() {
    const deliveries = await this.repository.claimDeliveries();
    for (const row of deliveries) {
      if (!row.claimedBy) continue;
      try {
        await this.publisher.publish(row.destination, row.payload);
        await this.repository.delivered(row.id, row.claimedBy);
      } catch {
        await this.repository.retryDelivery(
          row.id,
          row.claimedBy,
          row.attempts + 1,
        );
        this.logger.warn(
          `Entrega pendiente: ${row.destination}, evento ${row.eventId}`,
        );
      }
    }
    if (Date.now() - this.lastCleanup > 3600000) {
      await this.repository.cleanup(
        this.config.getOrThrow<number>('AUTH_RETENTION_DAYS'),
      );
      this.lastCleanup = Date.now();
    }
  }
}
