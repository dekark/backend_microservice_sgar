import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ImageAccess, ResourceFile, ResourceContent } from 'database';
import { DatabaseCrudService } from '../crud/database-crud.service';
import { ImageStorageService } from './image-storage.service';
import { validateResourceFile } from './resource-file-policy';
import type { ResourceUpload } from './resource-file-policy';

@Injectable()
export class ResourceFilesService {
  private readonly logger = new Logger(ResourceFilesService.name);
  constructor(
    private readonly database: DatabaseCrudService,
    private readonly storage: ImageStorageService,
  ) {}
  async upload(
    id: string,
    access: ImageAccess,
    file: ResourceUpload | undefined,
  ) {
    const current = await this.database.runFiles((store) =>
      store.readContent(id, access, true),
    );
    const validated = await validateResourceFile(file, current.type);
    const uploaded = await this.storage.putFile(
      id,
      validated.body,
      validated.mimeType,
      validated.originalFileName,
    );
    let previous: ResourceContent;
    try {
      previous = await this.database.runFiles((store) =>
        store.replaceContent(id, access, uploaded, current.type),
      );
    } catch (error) {
      try {
        if (
          !(await this.database.runFiles((store) =>
            store.isFileReferenced(id, uploaded),
          ))
        )
          await this.storage.removeFile(id, uploaded);
      } catch {
        this.logger.warn('Limpieza de archivo pendiente');
      }
      throw error;
    }
    await this.cleanup(id, previous.file);
    return uploaded;
  }
  async read(id: string, access: ImageAccess) {
    const content = await this.database.runFiles((store) =>
      store.readContent(id, access),
    );
    if (content.file)
      return {
        ...content,
        downloadUrl: await this.storage.fileUrl(id, content.file),
        expiresIn: 300,
      };
    if (content.url) return content;
    throw new NotFoundException('El recurso no tiene archivo ni URL');
  }
  async setUrl(id: string, access: ImageAccess, url: string) {
    const previous = await this.database.runFiles((store) =>
      store.replaceContent(id, access, url),
    );
    await this.cleanup(id, previous.file);
    return { url };
  }
  async remove(id: string, access: ImageAccess) {
    const previous = await this.database.runFiles((store) =>
      store.replaceContent(id, access, null),
    );
    await this.cleanup(id, previous.file);
  }
  private async cleanup(id: string, file: ResourceFile | null) {
    if (!file) return;
    try {
      await this.storage.removeFile(id, file);
    } catch {
      this.logger.warn('Contenido actualizado; limpieza de S3 pendiente');
    }
  }
}
