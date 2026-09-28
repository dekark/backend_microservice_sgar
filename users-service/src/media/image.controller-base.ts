import {
  BadRequestException,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Put,
  Req,
  UploadedFile,
} from '@nestjs/common';
import type { ImageAccess, ImageEntity } from 'database';
import type { AuthenticatedRequest } from '../security/security.types';
import { ImagesService } from './images.service';
import { ImageUpload } from './image-upload.decorator';
import type { ImageFile } from './image-upload.decorator';

export abstract class ImageControllerBase {
  protected constructor(
    private readonly images: ImagesService,
    private readonly entity: ImageEntity,
    private readonly mode: ImageAccess['mode'],
  ) {}
  private context(request: AuthenticatedRequest) {
    const id = this.mode === 'self' ? request.user.id : request.params.id;
    if (typeof id !== 'string') throw new BadRequestException('ID requerido');
    let access: ImageAccess;
    if (this.mode === 'area-admin' || this.mode === 'area-user') {
      const area = request.params.area;
      if (typeof area !== 'string')
        throw new BadRequestException('Area requerida');
      access = { mode: this.mode, actorId: request.user.id, area };
    } else access = { mode: this.mode, actorId: request.user.id };
    return { id, access };
  }
  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ImageUpload()
  upload(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: ImageFile | undefined,
  ) {
    const { id, access } = this.context(request);
    return this.images.upload(this.entity, id, access, file);
  }
  @Put()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ImageUpload()
  replace(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: ImageFile | undefined,
  ) {
    return this.upload(request, file);
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  read(@Req() request: AuthenticatedRequest) {
    const { id, access } = this.context(request);
    return this.images.read(this.entity, id, access);
  }
  @Delete()
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async remove(@Req() request: AuthenticatedRequest) {
    const { id, access } = this.context(request);
    await this.images.remove(this.entity, id, access);
  }
}
