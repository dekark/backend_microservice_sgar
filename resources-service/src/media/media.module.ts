import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CrudModule } from '../crud/crud.module';
import { ImagesService } from './images.service';
import { ImageStorageService } from './image-storage.service';
import { ResourceFilesService } from './resource-files.service';
@Module({
  imports: [ConfigModule, CrudModule],
  providers: [ImagesService, ImageStorageService, ResourceFilesService],
  exports: [ImagesService, ResourceFilesService],
})
export class MediaModule {}
