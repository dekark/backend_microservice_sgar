import { BrokerClientModule } from '../messaging/broker-client.module';
import { Module } from '@nestjs/common';
import { AreaAdminGuard } from './area-admin.guard';
import { CrudModule } from '../crud/crud.module';
import { ConfigModule } from '@nestjs/config';
import { AuthSessionService } from './auth-session.service';
import { AuthSessionGuard } from './auth-session.guard';
import { SuperadminGuard } from './superadmin.guard';
import { RolesPermissionsGuard } from './roles-permissions.guard';

@Module({
  imports: [BrokerClientModule, ConfigModule, CrudModule],
  providers: [
    AreaAdminGuard,
    AuthSessionService,
    AuthSessionGuard,
    RolesPermissionsGuard,
    SuperadminGuard,
  ],
  exports: [
    AreaAdminGuard,
    AuthSessionService,
    AuthSessionGuard,
    RolesPermissionsGuard,
    SuperadminGuard,
  ],
})
export class SecurityModule {}
