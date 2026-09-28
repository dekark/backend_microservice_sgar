import {
  BadRequestException,
  Body,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ImageAccess } from 'database';
import type { AuthenticatedRequest } from '../security/security.types';
import { ResourceFilesService } from './resource-files.service';
import { MAX_RESOURCE_BYTES } from './resource-file-policy';
import type { ResourceUpload } from './resource-file-policy';

const upload = () =>
  UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_RESOURCE_BYTES, files: 1, fields: 0, parts: 2 },
    }),
  );
export abstract class ResourceFileControllerBase {
  protected constructor(
    private readonly files: ResourceFilesService,
    private readonly mode: 'member' | 'superadmin' | 'area-admin',
  ) {}
  private context(request: AuthenticatedRequest) {
    const { id, area } = request.params;
    if (typeof id !== 'string') throw new BadRequestException('ID requerido');
    const access: ImageAccess =
      this.mode === 'area-admin'
        ? {
            mode: 'area-admin',
            actorId: request.user.id,
            area: typeof area === 'string' ? area : '',
          }
        : this.mode === 'member'
          ? {
              mode: 'member',
              actorId: request.user.id,
              area: typeof area === 'string' ? area : undefined,
            }
          : { mode: 'superadmin', actorId: request.user.id };
    return { id, access };
  }
  @Post('file')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @upload()
  create(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: ResourceUpload | undefined,
  ) {
    const { id, access } = this.context(request);
    return this.files.upload(id, access, file);
  }
  @Put('file')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @upload()
  replace(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: ResourceUpload | undefined,
  ) {
    return this.create(request, file);
  }
  @Get('file')
  @Header('Cache-Control', 'no-store')
  read(@Req() request: AuthenticatedRequest) {
    const { id, access } = this.context(request);
    return this.files.read(id, access);
  }
  @Put('url')
  @Header('Cache-Control', 'no-store')
  setUrl(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !('url' in body) ||
      typeof body.url !== 'string' ||
      !body.url.trim()
    )
      throw new BadRequestException('Envia solo { url: "https://..." }');
    const { id, access } = this.context(request);
    return this.files.setUrl(id, access, body.url.trim());
  }
  @Delete('file')
  @HttpCode(204)
  async remove(@Req() request: AuthenticatedRequest) {
    const { id, access } = this.context(request);
    await this.files.remove(id, access);
  }
}
