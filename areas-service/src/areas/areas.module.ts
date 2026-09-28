import { Module } from '@nestjs/common';
import { AdminAreasController } from './admin-areas.controller';
import { AreasService } from './areas.service';
import { AreasController } from './areas.controller';
import { SecurityModule } from '../security/security.module';
import { CrudModule } from '../crud/crud.module';
@Module({
  imports: [SecurityModule, CrudModule],
  providers: [AreasService],
  controllers: [AreasController, AdminAreasController],
})
export class AreasModule {}
