import { BrokerClientModule } from '../messaging/broker-client.module';
import { Module } from '@nestjs/common';
import { AreaUserGuard } from './area-user.guard';
import { AreaAdminGuard } from './area-admin.guard';
import { CrudModule } from '../crud/crud.module';
import { ConfigModule } from '@nestjs/config';
import { AuthSessionService } from './auth-session.service';
import { AuthSessionGuard } from './auth-session.guard';
import { SuperadminGuard } from './superadmin.guard';
@Module({
  imports: [BrokerClientModule, ConfigModule, CrudModule],
  providers: [
    AreaUserGuard,
    AuthSessionService,
    AuthSessionGuard,
    SuperadminGuard,
    AreaAdminGuard,
  ],
  exports: [
    AreaUserGuard,
    AuthSessionService,
    AuthSessionGuard,
    SuperadminGuard,
    AreaAdminGuard,
  ],
})
export class SecurityModule {}
