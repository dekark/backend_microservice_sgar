import { Module } from '@nestjs/common';
import { AdminPermissionsController } from './admin-permissions.controller';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';
import { SecurityModule } from '../security/security.module';
import { CrudModule } from '../crud/crud.module';
@Module({
  imports: [SecurityModule, CrudModule],
  providers: [PermissionsService],
  controllers: [PermissionsController, AdminPermissionsController],
})
export class PermissionsModule {}
