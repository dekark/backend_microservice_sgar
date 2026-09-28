import type { PoolClient } from "pg";
import { CrudError } from "./crud";
import { ImageStore } from "./image-store";
import type { ImageAccess, StoredImage } from "./image-store";

export interface ResourceFile extends StoredImage {
  originalFileName: string;
}
export interface ResourceContent {
  type: string;
  url: string | null;
  file: ResourceFile | null;
}

export class ResourceFileStore extends ImageStore {
  private async content(
    client: PoolClient,
    id: string,
    access: ImageAccess,
    write: boolean,
  ): Promise<ResourceContent> {
    await this.target(client, "resources", id, access, write);
    const { rows } = await client.query<{
      type: string;
      url: string | null;
      bucket: string | null;
      key: string | null;
      mimeType: string | null;
      fileSize: string | null;
      originalFileName: string | null;
    }>(
      `SELECT type, url, s3_bucket AS bucket, s3_key AS key, mime_type AS "mimeType",
      file_size AS "fileSize", original_file_name AS "originalFileName" FROM resources WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return {
      type: row.type,
      url: row.url,
      file:
        row.bucket && row.key && row.mimeType && row.fileSize !== null
          ? {
              bucket: row.bucket,
              key: row.key,
              mimeType: row.mimeType,
              fileSize: Number(row.fileSize),
              originalFileName: row.originalFileName ?? "download",
            }
          : null,
    };
  }
  readContent(id: string, access: ImageAccess, write = false) {
    return this.transaction((client) =>
      this.content(client, id, access, write),
    );
  }
  replaceContent(
    id: string,
    access: ImageAccess,
    value: ResourceFile | string | null,
    expectedType?: string,
  ) {
    return this.transaction(async (client) => {
      const previous = await this.content(client, id, access, true);
      if (expectedType !== undefined && previous.type !== expectedType)
        throw new CrudError(
          409,
          "El tipo de recurso cambio durante la subida; vuelve a intentarlo",
        );
      if (value && typeof value !== "string" && previous.type === "LINK")
        throw new CrudError(400, "El recurso LINK requiere una URL");
      if (typeof value === "string") {
        let valid = false;
        try {
          const url = new URL(value);
          valid =
            ["https:", "http:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            value.length <= 4096;
        } catch {
          /* invalid URL */
        }
        if (!valid)
          throw new CrudError(
            400,
            "Se requiere una URL HTTP o HTTPS sin credenciales",
          );
      }
      const file = value && typeof value !== "string" ? value : null;
      await client.query(
        `UPDATE resources SET url = $2, s3_bucket = $3, s3_key = $4,
        mime_type = $5, file_size = $6, original_file_name = $7, updated_at = now() WHERE id = $1`,
        [
          id,
          typeof value === "string" ? value : null,
          file?.bucket ?? null,
          file?.key ?? null,
          file?.mimeType ?? null,
          file?.fileSize ?? null,
          file?.originalFileName ?? null,
        ],
      );
      return previous;
    });
  }
  async isFileReferenced(id: string, file: ResourceFile): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT 1 FROM resources WHERE id = $1 AND s3_bucket = $2 AND s3_key = $3",
      [id, file.bucket, file.key],
    );
    return Boolean(result.rowCount);
  }
}
