import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, from, timeout } from 'rxjs';
import { AuthRepository } from './auth.repository';
import { AuthEventsPublisher } from './auth-events.publisher';

@Controller('health')
export class AuthHealthController {
  constructor(
    private readonly repository: AuthRepository,
    private readonly events: AuthEventsPublisher,
    private readonly config: ConfigService,
  ) {}
  @Get('live')
  live() {
    return { status: 'ok', service: 'auth-service' };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready() {
    const [database, messaging] = await Promise.allSettled([
      firstValueFrom(from(this.repository.ping()).pipe(timeout(4000))),
      this.events.connections(),
    ]);
    const components = {
      database: database.status === 'fulfilled',
      kafka: messaging.status === 'fulfilled' && messaging.value.kafka,
      rabbitmq: messaging.status === 'fulfilled' && messaging.value.rabbitmq,
    };
    const ready = Object.values(components).every(Boolean);
    const status = {
      status: ready ? 'ok' : 'unavailable',
      service: 'auth-service',
      components,
      googleLoginEnabled:
        this.config.get<boolean>('AUTH_GOOGLE_ENABLED') !== false,
    };
    if (!ready) throw new ServiceUnavailableException(status);
    return status;
  }
}
