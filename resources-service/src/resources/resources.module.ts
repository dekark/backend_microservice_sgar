import { Module } from '@nestjs/common';
import {
  ResourceFilesController,
  AdminResourceFilesController,
  AreaResourceFilesController,
} from './resource-files.controller';
import { MediaModule } from '../media/media.module';
import { AdminResourceImageController } from './admin-resource-image.controller';
import { AreaResourceImageController } from './area-resource-image.controller';
import { UserResourceImageController } from './user-resource-image.controller';
import { UserResourcesController } from './user-resources.controller';
import { UserResourcesService } from './user-resources.service';
import { AreaResourcesController } from './area-resources.controller';
import { AreaResourcesService } from './area-resources.service';
import { AdminResourcesController } from './admin-resources.controller';
import { ResourcesService } from './resources.service';
import { ResourcesController } from './resources.controller';
import { SecurityModule } from '../security/security.module';
import { CrudModule } from '../crud/crud.module';
@Module({
  imports: [SecurityModule, CrudModule, MediaModule],
  providers: [ResourcesService, AreaResourcesService, UserResourcesService],
  controllers: [
    UserResourcesController,
    ResourcesController,
    AdminResourcesController,
    AreaResourcesController,
    ResourceFilesController,
    AdminResourceFilesController,
    AreaResourceFilesController,
    AdminResourceImageController,
    AreaResourceImageController,
    UserResourceImageController,
  ],
})
export class ResourcesModule {}
