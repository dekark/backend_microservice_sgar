import { BrokerRpcModule } from './messaging/broker-rpc.module';
import { ApplicationAuditModule } from './observability/application-audit.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { validateEnvironment } from './config/environment';

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
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
