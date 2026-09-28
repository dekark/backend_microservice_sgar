import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type { ImageEntity, StoredImage, ResourceFile } from 'database';

@Injectable()
export class ImageStorageService implements OnModuleDestroy {
  private client?: S3Client;
  constructor(private readonly config: ConfigService) {}
  private settings() {
    const bucket = this.config.get<string>('S3_MEDIA_BUCKET');
    const region = this.config.get<string>('AWS_REGION');
    if (!bucket?.trim() || !region?.trim())
      throw new ServiceUnavailableException(
        'Configura S3_MEDIA_BUCKET y AWS_REGION para gestionar imagenes',
      );
    if (!this.client) {
      const endpoint = this.config.get<string>('S3_ENDPOINT');
      this.client = new S3Client({
        region,
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
        maxAttempts: 2,
      });
    }
    return { bucket, client: this.client };
  }
  async put(
    entity: ImageEntity,
    id: string,
    body: Buffer,
  ): Promise<StoredImage> {
    const { bucket, client } = this.settings();
    const key = 'media/' + entity + '/' + id + '/' + randomUUID() + '.webp';
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: 'image/webp',
          ContentLength: body.length,
          CacheControl: 'private, max-age=300',
          ServerSideEncryption: 'AES256',
        }),
        { abortSignal: AbortSignal.timeout(15000) },
      );
      return { bucket, key, mimeType: 'image/webp', fileSize: body.length };
    } catch {
      throw new ServiceUnavailableException('No se pudo subir la imagen a S3');
    }
  }
  async putFile(
    id: string,
    body: Buffer,
    mimeType: string,
    originalFileName: string,
  ): Promise<ResourceFile> {
    const { bucket, client } = this.settings();
    const key = 'files/resources/' + id + '/' + randomUUID();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: mimeType,
          ContentLength: body.length,
          ContentDisposition: 'attachment',
          CacheControl: 'private, max-age=300',
          ServerSideEncryption: 'AES256',
        }),
        { abortSignal: AbortSignal.timeout(15000) },
      );
      return { bucket, key, mimeType, fileSize: body.length, originalFileName };
    } catch {
      throw new ServiceUnavailableException('No se pudo subir el archivo a S3');
    }
  }
  async fileUrl(id: string, file: ResourceFile): Promise<string> {
    const { bucket, client } = this.settings();
    if (
      file.bucket !== bucket ||
      !file.key.startsWith('files/resources/' + id + '/')
    )
      throw new ServiceUnavailableException(
        'Archivo fuera del almacenamiento configurado',
      );
    try {
      const filename = encodeURIComponent(file.originalFileName).replace(
        /['()*]/g,
        (c) => '%' + c.charCodeAt(0).toString(16),
      );
      return await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: file.key,
          ResponseContentType: 'application/octet-stream',
          ResponseContentDisposition:
            'attachment; filename="download"; filename*=UTF-8\'\'' + filename,
          ResponseCacheControl: 'private, max-age=300',
        }),
        { expiresIn: 300 },
      );
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo obtener la URL del archivo',
      );
    }
  }
  async removeFile(id: string, file: ResourceFile): Promise<void> {
    const { bucket, client } = this.settings();
    if (
      file.bucket !== bucket ||
      !file.key.startsWith('files/resources/' + id + '/')
    )
      return;
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: file.key }),
      { abortSignal: AbortSignal.timeout(15000) },
    );
  }
  async url(image: StoredImage): Promise<string> {
    const { bucket, client } = this.settings();
    if (image.bucket !== bucket || !image.key.startsWith('media/'))
      throw new ServiceUnavailableException(
        'Imagen fuera del almacenamiento configurado',
      );
    try {
      return await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: image.key,
          ResponseContentType: 'image/webp',
          ResponseContentDisposition: 'inline; filename="image.webp"',
          ResponseCacheControl: 'private, max-age=300',
        }),
        { expiresIn: 300 },
      );
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo obtener la URL de la imagen',
      );
    }
  }
  async remove(
    entity: ImageEntity,
    id: string,
    image: StoredImage,
  ): Promise<void> {
    const { bucket, client } = this.settings();
    // Never delete an unrelated or legacy object supplied through generic metadata.
    if (
      image.bucket !== bucket ||
      !image.key.startsWith('media/' + entity + '/' + id + '/')
    )
      return;
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: image.key }),
      { abortSignal: AbortSignal.timeout(15000) },
    );
  }
  onModuleDestroy() {
    this.client?.destroy();
  }
}
