import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'RABBITMQ_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [
              config.get<string>('RABBITMQ_URL') ??
                'amqp://admin:admin123@localhost:5672',
            ],
            queue: config.get<string>('AUTH_AUDIT_QUEUE') ?? 'audit_queue',
            persistent: true,
            queueOptions: { durable: true },
            // ClientProxy's direct reply queue requires automatic acknowledgement.
            noAck: true,
          },
        }),
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class RabbitModule {}
