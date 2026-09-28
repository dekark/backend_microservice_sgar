import { Injectable, Module } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  ClientKafka,
  ClientProxy,
  ClientProxyFactory,
  RmqRecordBuilder,
  Transport,
} from '@nestjs/microservices';
import { from, firstValueFrom, timeout } from 'rxjs';
import {
  brokerRpcConfig,
  kafkaClientConfig,
  parseBrokerCommand,
  parseBrokerReply,
  RPC_SERVICES,
} from 'database';
import type { BrokerCommand, BrokerReply, RpcService } from 'database';

@Injectable()
export class BrokerGateway implements OnModuleDestroy {
  private readonly clients = new Map<string, ClientProxy>();
  constructor(private readonly config: ConfigService) {}
  async send(
    service: RpcService,
    input: BrokerCommand,
    transport: 'rabbit' | 'kafka' = 'rabbit',
  ): Promise<BrokerReply> {
    if (
      !RPC_SERVICES.includes(service) ||
      !['rabbit', 'kafka'].includes(transport)
    )
      throw new Error('Destino RPC invalido');
    const parsed = parseBrokerCommand(input);
    const deadline = Math.min(
      Date.parse(parsed.expiresAt),
      Date.now() + brokerRpcConfig(this.config).timeout,
    );
    const command = { ...parsed, expiresAt: new Date(deadline).toISOString() };
    const pattern = `${service}.rpc.v1`;
    const key = `${transport}:${service}`;
    let client = this.clients.get(key);
    if (!client) {
      if (transport === 'kafka') {
        const kafka = new ClientKafka({
          client: kafkaClientConfig(this.config, 'users-service-rpc-client'),
          consumer: { groupId: `users-service-${service}-rpc-replies` },
        });
        kafka.subscribeToResponseOf(pattern);
        client = kafka;
      } else {
        client = ClientProxyFactory.create({
          transport: Transport.RMQ,
          options: {
            urls: [this.config.getOrThrow<string>('RABBITMQ_URL')],
            queue: `${service}_rpc`,
            queueOptions: { durable: true },
            noAck: true,
            persistent: true,
          },
        });
      }
      this.clients.set(key, client);
    }
    const remaining = () => {
      const milliseconds = deadline - Date.now();
      if (milliseconds <= 0) throw new Error('El plazo RPC ha vencido');
      return milliseconds;
    };
    const connectBudget = remaining();
    const connectingClient = client;
    const connection = connectingClient
      .connect()
      .catch(async (error: unknown) => {
        // A rejected Kafka initialization promise is cached by Nest. Discard that
        // client so a later request can establish a new connection. Never resend
        // an operation here: nothing has been published at this point.
        if (this.clients.get(key) === connectingClient) {
          this.clients.delete(key);
          try {
            await connectingClient.close();
          } catch {
            /* Preserve the original failure. */
          }
        }
        throw error;
      });
    await firstValueFrom(from(connection).pipe(timeout(connectBudget)));
    const replyBudget = remaining();
    const message =
      transport === 'rabbit'
        ? new RmqRecordBuilder(command)
            .setOptions({
              persistent: true,
              messageId: command.requestId,
              expiration: String(replyBudget),
            })
            .build()
        : command;
    const response: unknown = await firstValueFrom(
      client.send<unknown>(pattern, message).pipe(timeout(replyBudget)),
    );
    return parseBrokerReply(response, command.requestId);
  }

  async onModuleDestroy() {
    await Promise.all(
      [...this.clients.values()].map((client) =>
        Promise.resolve(client.close()),
      ),
    );
  }
}
@Module({
  imports: [ConfigModule],
  providers: [BrokerGateway],
  exports: [BrokerGateway],
})
export class BrokerClientModule {}
