import { BrokerRpcModule } from './messaging/broker-rpc.module';
import { ApplicationAuditModule } from './observability/application-audit.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateEnvironment } from './config/environment';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ResourcesModule } from './resources/resources.module';
import { KafkaModule } from './kafka/kafka.module';
import { RabbitModule } from './rabbit/rabbit.module';

@Module({
  imports: [
    ApplicationAuditModule,
    BrokerRpcModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(__dirname, '../../database/.env'),
        resolve(__dirname, '../.env'),
      ],
      validate: validateEnvironment,
    }),
    ResourcesModule,
    KafkaModule,
    RabbitModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
