import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { extname } from 'node:path';
import type { ImageFile } from './image-upload.decorator';

export interface ResourceUpload extends ImageFile {
  originalname: string;
}
export const MAX_RESOURCE_BYTES = 25 * 1024 * 1024;
const textExtensions: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.rtf': 'application/rtf',
  '.svg': 'image/svg+xml',
  '.log': 'text/plain',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.lic': 'text/plain',
  '.license': 'text/plain',
  '.key': 'text/plain',
};

// The database type determines the category; client MIME/extension cannot turn binary data into an image/video.
export async function validateResourceFile(
  file: ResourceUpload | undefined,
  type: string,
) {
  if (type === 'LINK')
    throw new BadRequestException('LINK requiere una URL, no un archivo');
  if (!file?.buffer?.length)
    throw new BadRequestException('Adjunta un archivo en el campo file');
  if (file.buffer.length > MAX_RESOURCE_BYTES)
    throw new PayloadTooLargeException('El archivo supera 25 MiB');
  const originalFileName =
    (file.originalname ?? 'download')
      .split(/[\\/]/)
      .pop()!
      // Strip control characters from the download filename.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, '')
      .slice(0, 255) || 'download';
  const { fileTypeFromBuffer } = await import('file-type');
  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {
    detected = await fileTypeFromBuffer(file.buffer);
  } catch {
    throw new BadRequestException('Cabecera de archivo invalida');
  }
  let mimeType = detected?.mime;
  let text = false;
  if (!detected || detected.ext === 'xml') {
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
        file.buffer,
      );
      // UTF-8 without binary control characters; tabs and newlines are allowed.
      // eslint-disable-next-line no-control-regex
      text = !/[\x00-\x08\x0e-\x1f]/.test(decoded);
      if (text)
        mimeType =
          textExtensions[extname(originalFileName).toLowerCase()] ??
          'text/plain';
      // SVG is active XML content, accepted only as a download, never as a preview/avatar.
      if (mimeType === 'image/svg+xml' && !/<svg(?:\s|>)/i.test(decoded))
        mimeType = 'text/plain';
    } catch {
      /* Unknown binary is supported by generic resource categories. */
    }
  }
  mimeType ??= 'application/octet-stream';
  const document =
    text ||
    (detected?.ext === 'cfb' &&
      ['.doc', '.xls', '.ppt', '.msg'].includes(
        extname(originalFileName).toLowerCase(),
      )) ||
    [
      'pdf',
      'rtf',
      'doc',
      'xls',
      'ppt',
      'docx',
      'xlsx',
      'pptx',
      'odt',
      'ods',
      'odp',
      'epub',
      'mobi',
    ].includes(detected?.ext ?? '') ||
    mimeType.includes('officedocument') ||
    mimeType.includes('opendocument');
  const allowed =
    type === 'IMAGE'
      ? mimeType.startsWith('image/')
      : type === 'VIDEO'
        ? mimeType.startsWith('video/')
        : type === 'DOCUMENT'
          ? document
          : ['FILE', 'SOFTWARE', 'LICENSE', 'EQUIPMENT', 'OTHER'].includes(
              type,
            );
  if (!allowed)
    throw new UnsupportedMediaTypeException(
      'El contenido del archivo no corresponde al tipo ' + type,
    );
  return { body: file.buffer, mimeType, originalFileName };
}
