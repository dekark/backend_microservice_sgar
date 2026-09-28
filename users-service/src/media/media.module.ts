import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CrudModule } from '../crud/crud.module';
import { ImagesService } from './images.service';
import { ImageStorageService } from './image-storage.service';
@Module({
  imports: [ConfigModule, CrudModule],
  providers: [ImagesService, ImageStorageService],
  exports: [ImagesService],
})
export class MediaModule {}
