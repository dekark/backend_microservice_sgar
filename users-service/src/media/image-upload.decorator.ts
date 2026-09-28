import { UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

export interface ImageFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ImageUpload = () =>
  UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 2 },
    }),
  );
