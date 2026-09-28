import { Controller, Injectable, Logger, Module } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  Ctx,
  MessagePattern,
  Payload,
  RmqContext,
  Transport,
} from '@nestjs/microservices';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import {
  ApplicationOutbox,
  BrokerRpcExecutor,
  brokerRpcConfig,
  createTransactionalDatabase,
  kafkaClientConfig,
} from 'database';
import type { BrokerReply } from 'database';
import { BrokerClientModule } from './broker-client.module';

@Injectable()
export class BrokerRpcService implements OnModuleDestroy {
  private readonly logger = new Logger(BrokerRpcService.name);
  private readonly connection: ReturnType<typeof createTransactionalDatabase>;
  private readonly executor: BrokerRpcExecutor;
  private readonly audit: ApplicationOutbox;
  private readonly pending = new Set<Promise<BrokerReply>>();
  constructor(config: ConfigService) {
    this.connection = createTransactionalDatabase(
      config.getOrThrow<string>('DATABASE_URL'),
    );
    this.connection.pool.on('error', () =>
      this.logger.error('RPC database connection unavailable'),
    );
    this.executor = new BrokerRpcExecutor(
      this.connection.pool,
      'users',
      `http://127.0.0.1:${config.getOrThrow<number>('PORT')}`,
      brokerRpcConfig(config).timeout,
    );
    this.audit = new ApplicationOutbox(
      this.connection.pool,
      'users-service',
      (message) => this.logger.error(message),
    );
  }
  async handle(payload: unknown): Promise<BrokerReply> {
    const work = this.perform(payload);
    this.pending.add(work);
    try {
      return await work;
    } finally {
      this.pending.delete(work);
    }
  }
  private async perform(payload: unknown): Promise<BrokerReply> {
    const started = Date.now();
    let result: BrokerReply;
    try {
      result = await this.executor.execute(payload);
    } catch {
      result = {
        requestId: null,
        ok: false,
        statusCode: 500,
        data: { message: 'No se pudo procesar el comando' },
      };
    }
    try {
      await this.audit.enqueue({
        eventId: randomUUID(),
        version: 1,
        source: 'users-service',
        action: 'rpc.completed',
        occurredAt: new Date().toISOString(),
        requestId: result.requestId,
        userId: null,
        areaId: null,
        entity: 'http',
        entityId: null,
        metadata: {
          statusCode: result.statusCode,
          durationMs: Math.max(0, Date.now() - started),
        },
      });
    } catch {
      this.logger.error('RPC audit result could not be persisted');
    }
    return result;
  }
  async onModuleDestroy() {
    await Promise.all([...this.pending]);
    await this.connection.pool.end();
  }
}
@Controller()
export class BrokerRpcController {
  constructor(private readonly rpc: BrokerRpcService) {}
  @MessagePattern('users.rpc.v1', Transport.RMQ)
  async rabbit(@Payload() payload: unknown, @Ctx() context: RmqContext) {
    const response = await this.rpc.handle(payload);
    const channel = context.getChannelRef() as { ack(message: unknown): void };
    channel.ack(context.getMessage() as unknown);
    return response;
  }
  @MessagePattern('users.rpc.v1', Transport.KAFKA)
  kafka(@Payload() payload: unknown) {
    return this.rpc.handle(payload);
  }
}
@Module({
  imports: [ConfigModule, BrokerClientModule],
  controllers: [BrokerRpcController],
  providers: [BrokerRpcService],
  exports: [BrokerClientModule],
})
export class BrokerRpcModule {}

export function brokerRpcOptions(config: ConfigService): MicroserviceOptions[] {
  if (!brokerRpcConfig(config).enabled) return [];
  return [
    {
      transport: Transport.RMQ,
      options: {
        urls: [config.getOrThrow<string>('RABBITMQ_URL')],
        queue: 'users_rpc',
        queueOptions: { durable: true },
        noAck: false,
        prefetchCount: 10,
      },
    },
    {
      transport: Transport.KAFKA,
      options: {
        client: kafkaClientConfig(config, 'users-service-rpc'),
        consumer: { groupId: 'users-service-rpc-v1' },
        subscribe: { fromBeginning: false },
      },
    },
  ];
}
