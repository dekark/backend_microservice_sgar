import type { Pool, PoolClient } from "pg";
import { AreaCrudStore } from "./area-crud";
import { CrudError, idValue } from "./crud";

export type ImageEntity = "users" | "resources";
export type ImageAccess = { actorId: string } & (
  | { mode: "self" | "superadmin" }
  | { mode: "member"; area?: string }
  | { mode: "area-admin" | "area-user"; area: string }
);
export interface StoredImage {
  bucket: string;
  key: string;
  mimeType: string;
  fileSize: number;
}
type ImageRow = {
  bucket: string | null;
  key: string | null;
  mimeType: string | null;
  fileSize: string | null;
};
const columns = (entity: ImageEntity) =>
  entity === "users"
    ? [
        "avatar_s3_bucket",
        "avatar_s3_key",
        "avatar_mime_type",
        "avatar_file_size",
      ]
    : ["image_s3_bucket", "image_s3_key", "image_mime_type", "image_file_size"];

export class ImageStore {
  constructor(protected readonly pool: Pool) {}

  protected async target(
    client: PoolClient,
    entity: ImageEntity,
    id: string,
    access: ImageAccess,
    write: boolean,
  ): Promise<StoredImage | null> {
    idValue(entity, id);
    idValue("users", access.actorId);
    let areaId: string | undefined;
    if (access.mode === "member") {
      if (entity !== "resources") throw new CrudError(403, "Solo recursos");
      const actor = await client.query<{ name: string; areaId: string | null }>(
        'SELECT r.name, u.area_id AS "areaId" FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.is_active AND r.is_active FOR SHARE OF u, r',
        [access.actorId],
      );
      if (!actor.rows[0]) throw new CrudError(403, "Usuario inactivo");
      if (actor.rows[0].name !== "superadministrador") {
        const area = await client.query<{ id: string }>(
          "SELECT id FROM areas WHERE id = $1 AND is_active AND ($2::text IS NULL OR id::text = $2 OR name = $2) FOR SHARE",
          [actor.rows[0].areaId, access.area ?? null],
        );
        if (!area.rows[0])
          throw new CrudError(403, "Se requiere un area activa asignada");
        areaId = area.rows[0].id;
      } else if (access.area !== undefined) {
        const area = await client.query<{ id: string }>(
          "SELECT id FROM areas WHERE id::text = $1 OR name = $1 FOR SHARE",
          [access.area],
        );
        if (!area.rows[0]) throw new CrudError(404, "Area no encontrada");
        areaId = area.rows[0].id;
      }
    } else if (access.mode === "area-admin" || access.mode === "area-user") {
      if (access.mode === "area-user" && entity !== "resources")
        throw new CrudError(403, "Solo recursos del area");
      const area = await new AreaCrudStore(
        this.pool,
        access.mode === "area-user" ? "user" : "administrator",
      ).authorize(access.actorId, access.area, client);
      areaId = area.id;
    } else {
      if (
        access.mode === "self" &&
        (entity !== "users" || id !== access.actorId)
      )
        throw new CrudError(403, "Solo puedes modificar tu propio avatar");
      const actor = await client.query<{ name: string }>(
        "SELECT r.name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.is_active AND r.is_active FOR SHARE OF u, r",
        [access.actorId],
      );
      if (
        !actor.rows[0] ||
        (access.mode === "superadmin" &&
          actor.rows[0].name !== "superadministrador")
      )
        throw new CrudError(403, "Acceso no autorizado a la imagen");
    }
    const [bucket, key, mime, size] = columns(entity);
    const result = await client.query<ImageRow>(
      `SELECT ${bucket} AS bucket, ${key} AS key, ${mime} AS "mimeType", ${size} AS "fileSize" FROM "${entity}" WHERE id = $1 ${areaId ? "AND area_id = $2" : ""} FOR ${write ? "UPDATE" : "SHARE"}`,
      areaId ? [id, areaId] : [id],
    );
    if (!result.rows[0]) throw new CrudError(404, "Registro no encontrado");
    if (entity === "users" && access.mode === "area-admin" && write) {
      const role = await client.query<{ name: string }>(
        "SELECT r.name FROM roles r JOIN users u ON u.role_id = r.id WHERE u.id = $1 FOR SHARE OF r",
        [id],
      );
      if (
        ["administrador", "superadministrador", "superadministardor"].includes(
          role.rows[0].name,
        )
      )
        throw new CrudError(
          403,
          "Solo el superadministrador puede modificar otros usuarios administrativos",
        );
    }
    const row = result.rows[0];
    return row.bucket && row.key && row.mimeType && row.fileSize !== null
      ? {
          bucket: row.bucket,
          key: row.key,
          mimeType: row.mimeType,
          fileSize: Number(row.fileSize),
        }
      : null;
  }

  async read(
    entity: ImageEntity,
    id: string,
    access: ImageAccess,
  ): Promise<StoredImage | null> {
    return this.transaction((client) =>
      this.target(client, entity, id, access, false),
    );
  }

  async checkWrite(
    entity: ImageEntity,
    id: string,
    access: ImageAccess,
  ): Promise<void> {
    await this.transaction((client) =>
      this.target(client, entity, id, access, true),
    );
  }

  async replace(
    entity: ImageEntity,
    id: string,
    access: ImageAccess,
    image: StoredImage | null,
  ) {
    return this.transaction(async (client) => {
      const previous = await this.target(client, entity, id, access, true);
      const assignments = columns(entity).map(
        (column, i) => `${column} = $${i + 2}`,
      );
      await client.query(
        `UPDATE "${entity}" SET ${assignments.join(", ")}, updated_at = now() WHERE id = $1`,
        [
          id,
          image?.bucket ?? null,
          image?.key ?? null,
          image?.mimeType ?? null,
          image?.fileSize ?? null,
        ],
      );
      return previous;
    });
  }

  async isReferenced(
    entity: ImageEntity,
    id: string,
    image: StoredImage,
  ): Promise<boolean> {
    const [bucket, key] = columns(entity);
    const result = await this.pool.query(
      `SELECT 1 FROM "${entity}" WHERE id = $1 AND ${bucket} = $2 AND ${key} = $3`,
      [id, image.bucket, image.key],
    );
    return Boolean(result.rowCount);
  }

  protected async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
