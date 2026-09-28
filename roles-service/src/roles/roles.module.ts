import { Module } from '@nestjs/common';
import { AdminRolesController } from './admin-roles.controller';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { SecurityModule } from '../security/security.module';
import { CrudModule } from '../crud/crud.module';
@Module({
  imports: [SecurityModule, CrudModule],
  providers: [RolesService],
  controllers: [RolesController, AdminRolesController],
})
export class RolesModule {}
