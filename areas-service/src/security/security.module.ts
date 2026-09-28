import { BrokerClientModule } from '../messaging/broker-client.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthSessionService } from './auth-session.service';
import { AuthSessionGuard } from './auth-session.guard';
import { SuperadminGuard } from './superadmin.guard';
@Module({
  imports: [BrokerClientModule, ConfigModule],
  providers: [AuthSessionService, AuthSessionGuard, SuperadminGuard],
  exports: [AuthSessionService, AuthSessionGuard, SuperadminGuard],
})
export class SecurityModule {}
