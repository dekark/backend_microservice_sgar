import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import sharp from 'sharp';
import type { ImageAccess, ImageEntity, StoredImage } from 'database';
import { DatabaseCrudService } from '../crud/database-crud.service';
import { ImageStorageService } from './image-storage.service';
import { MAX_IMAGE_BYTES } from './image-upload.decorator';
import type { ImageFile } from './image-upload.decorator';

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);
  constructor(
    private readonly database: DatabaseCrudService,
    private readonly storage: ImageStorageService,
  ) {}

  private async normalize(
    file: ImageFile | undefined,
    entity: ImageEntity,
  ): Promise<Buffer> {
    if (!file?.buffer?.length)
      throw new BadRequestException('Adjunta una imagen en el campo file');
    if (file.buffer.length > MAX_IMAGE_BYTES)
      throw new PayloadTooLargeException('La imagen supera 5 MiB');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
      throw new UnsupportedMediaTypeException('Solo JPEG, PNG o WebP');
    try {
      const source = sharp(file.buffer, {
        limitInputPixels: 16777216,
        failOn: 'error',
      });
      const metadata = await source.metadata();
      const expected = {
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
      };
      if (
        !metadata.format ||
        expected[metadata.format as keyof typeof expected] !== file.mimetype ||
        (metadata.pages ?? 1) > 1
      )
        throw new UnsupportedMediaTypeException(
          'Formato de imagen invalido o animado',
        );
      const size = entity === 'users' ? 512 : 1600;
      const body = await source
        .rotate()
        .resize({
          width: size,
          height: size,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();
      if (body.length > MAX_IMAGE_BYTES)
        throw new PayloadTooLargeException('La imagen procesada supera 5 MiB');
      return body;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        'Imagen corrupta o superior a 16 megapixeles',
      );
    }
  }

  async upload(
    entity: ImageEntity,
    id: string,
    access: ImageAccess,
    file: ImageFile | undefined,
  ) {
    await this.database.runImages((store) =>
      store.checkWrite(entity, id, access),
    );
    const body = await this.normalize(file, entity);
    const image = await this.storage.put(entity, id, body);
    let previous: StoredImage | null;
    try {
      previous = await this.database.runImages((store) =>
        store.replace(entity, id, access, image),
      );
    } catch (error) {
      // An uncertain COMMIT must not lead to deleting the image now referenced by SQL.
      try {
        const referenced = await this.database.runImages((store) =>
          store.isReferenced(entity, id, image),
        );
        if (!referenced) await this.storage.remove(entity, id, image);
      } catch {
        this.logger.warn('No se pudo limpiar una subida pendiente');
      }
      throw error;
    }
    if (previous) await this.cleanup(entity, id, previous);
    return { ...image };
  }

  async read(entity: ImageEntity, id: string, access: ImageAccess) {
    const image = await this.database.runImages((store) =>
      store.read(entity, id, access),
    );
    if (!image) throw new NotFoundException('No hay imagen asignada');
    return { ...image, url: await this.storage.url(image), expiresIn: 300 };
  }

  async remove(entity: ImageEntity, id: string, access: ImageAccess) {
    const previous = await this.database.runImages((store) =>
      store.replace(entity, id, access, null),
    );
    if (previous) await this.cleanup(entity, id, previous);
  }
  private async cleanup(entity: ImageEntity, id: string, image: StoredImage) {
    try {
      await this.storage.remove(entity, id, image);
    } catch {
      this.logger.warn('Imagen reemplazada; limpieza de S3 pendiente');
    }
  }
}
