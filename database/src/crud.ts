import type { Pool } from "pg";

export class CrudError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Field = {
  column: string;
  kind: "text" | "integer" | "boolean" | "uuid" | "email" | "url" | "json";
  required?: boolean;
  nullable?: boolean;
  immutable?: boolean;
  max?: number;
  min?: number;
  choices?: readonly string[];
};
const text = (column: string, max: number, required = false): Field => ({
  column,
  kind: "text",
  max,
  required,
});
const description: Field = { ...text("description", 10000), nullable: true };
const active: Field = { column: "is_active", kind: "boolean" };
const uuid = (column: string, required = false, nullable = false): Field => ({
  column,
  kind: "uuid",
  required,
  nullable,
});

// Identifiers below are application constants. Request values always use SQL parameters.
const definitions = {
  roles: {
    numericId: true,
    fields: { name: text("name", 100, true), description, isActive: active },
    columns: {
      id: "id",
      name: "name",
      description: "description",
      isActive: "is_active",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  permissions: {
    numericId: true,
    fields: {
      key: text("key", 150, true),
      name: text("name", 150, true),
      module: text("module", 100, true),
      description,
      isActive: active,
    },
    columns: {
      id: "id",
      key: "key",
      name: "name",
      module: "module",
      description: "description",
      isActive: "is_active",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  areas: {
    numericId: false,
    fields: { name: text("name", 150, true), description, isActive: active },
    columns: {
      id: "id",
      name: "name",
      description: "description",
      isActive: "is_active",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  users: {
    numericId: false,
    fields: {
      googleSub: { ...text("google_sub", 255, true), immutable: true },
      email: { ...text("email", 255, true), kind: "email" },
      name: text("name", 150, true),
      roleId: {
        column: "role_id",
        kind: "integer",
        required: true,
        min: 1,
        max: 2147483647,
      },
      areaId: uuid("area_id", false, true),
      isActive: active,
    },
    columns: {
      id: "id",
      email: "email",
      name: "name",
      roleId: "role_id",
      areaId: "area_id",
      isActive: "is_active",
      lastLoginAt: "last_login_at",
      avatarS3Bucket: "avatar_s3_bucket",
      avatarS3Key: "avatar_s3_key",
      avatarMimeType: "avatar_mime_type",
      avatarFileSize: "avatar_file_size",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  resources: {
    numericId: false,
    fields: {
      areaId: uuid("area_id", true),
      name: text("name", 200, true),
      description,
      type: {
        ...text("type", 30, true),
        choices: [
          "DOCUMENT",
          "FILE",
          "LINK",
          "IMAGE",
          "VIDEO",
          "SOFTWARE",
          "LICENSE",
          "EQUIPMENT",
          "OTHER",
        ],
      },
      status: {
        ...text("status", 30),
        choices: ["ACTIVE", "INACTIVE", "ARCHIVED"],
      },
      url: { ...text("url", 4096), kind: "url", nullable: true },
      s3Bucket: { ...text("s3_bucket", 255), nullable: true },
      s3Key: { ...text("s3_key", 1024), nullable: true },
      originalFileName: { ...text("original_file_name", 1024), nullable: true },
      mimeType: { ...text("mime_type", 150), nullable: true },
      fileSize: {
        column: "file_size",
        kind: "integer",
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        nullable: true,
      },
    },
    columns: {
      id: "id",
      areaId: "area_id",
      name: "name",
      description: "description",
      type: "type",
      status: "status",
      url: "url",
      s3Bucket: "s3_bucket",
      s3Key: "s3_key",
      originalFileName: "original_file_name",
      mimeType: "mime_type",
      fileSize: "file_size",
      createdById: "created_by_id",
      imageS3Bucket: "image_s3_bucket",
      imageS3Key: "image_s3_key",
      imageMimeType: "image_mime_type",
      imageFileSize: "image_file_size",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  audit: {
    numericId: false,
    fields: {
      action: text("action", 150, true),
      entity: text("entity", 100, true),
      entityId: { ...text("entity_id", 255), nullable: true },
      areaId: uuid("area_id", false, true),
      metadata: { column: "metadata", kind: "json" },
    },
    columns: {
      id: "id",
      userId: "user_id",
      action: "action",
      entity: "entity",
      entityId: "entity_id",
      areaId: "area_id",
      metadata: "metadata",
      ipAddress: "ip_address",
      createdAt: "created_at",
    },
  },
} satisfies Record<
  string,
  {
    numericId: boolean;
    fields: Record<string, Field>;
    columns: Record<string, string>;
  }
>;

export type CrudEntity = keyof typeof definitions;
export type WritableEntity = CrudEntity;
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const table = (entity: CrudEntity) =>
  entity === "audit" ? "audit_logs" : entity;
export const projection = (entity: CrudEntity, prefix = "") =>
  Object.entries(definitions[entity].columns)
    .map(([key, column]) => `${prefix}"${column}" AS "${key}"`)
    .join(", ");

export function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CrudError(400, "Se requiere un objeto JSON");
  return value as Row;
}
export function idValue(entity: CrudEntity, value: string): string | number {
  if (definitions[entity].numericId) {
    if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647)
      throw new CrudError(400, "ID invalido");
    return Number(value);
  }
  if (!UUID.test(value))
    throw new CrudError(400, "Se requiere un ID UUID valido");
  return value;
}
export function bodyValues(
  entity: WritableEntity,
  value: unknown,
  update: boolean,
): Record<string, unknown> {
  const body = object(value);
  const fields: Record<string, Field> = definitions[entity].fields;
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(body)) {
    if (!Object.hasOwn(fields, key) || (update && fields[key].immutable))
      throw new CrudError(400, `Campo no permitido: ${key}`);
    const field = fields[key];
    if (raw === null && field.nullable) {
      result[field.column] = null;
      continue;
    }
    let parsed: unknown = raw;
    let valid = false;
    if (field.kind === "json") {
      const metadata = object(raw);
      const reserved = [
        "eventHash",
        "source",
        "version",
        "eventId",
        "originalUserId",
        "sessionId",
        "userAgent",
        "receivedAt",
      ];
      if (Object.keys(metadata).some((key) => reserved.includes(key)))
        throw new CrudError(
          400,
          "No se pueden modificar metadatos internos de entrega",
        );
      valid = Buffer.byteLength(JSON.stringify(metadata)) <= 65536;
    } else if (field.kind === "boolean") valid = typeof raw === "boolean";
    else if (field.kind === "integer")
      valid =
        typeof raw === "number" &&
        Number.isSafeInteger(raw) &&
        raw >= (field.min ?? 1) &&
        raw <= (field.max ?? 2147483647);
    else if (typeof raw === "string") {
      const string = raw.trim();
      parsed = string;
      valid = string.length > 0 && string.length <= (field.max ?? 255);
      if (field.kind === "uuid") valid = valid && UUID.test(string);
      if (field.kind === "email") {
        valid = valid && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(string);
        parsed = string.toLowerCase();
      }
      if (field.kind === "url") {
        try {
          valid =
            valid && ["http:", "https:"].includes(new URL(string).protocol);
        } catch {
          valid = false;
        }
      }
      if (field.choices) valid = valid && field.choices.includes(string);
    }
    if (!valid) throw new CrudError(400, `Valor invalido para ${key}`);
    result[field.column] = parsed;
  }
  if (!update) {
    for (const [key, field] of Object.entries(fields)) {
      if (field.required && !Object.hasOwn(body, key))
        throw new CrudError(400, `${key} es obligatorio`);
    }
  }
  if (!Object.keys(result).length)
    throw new CrudError(400, "Debes enviar al menos un campo");
  return result;
}
export function pagination(input: unknown) {
  const query = object(input);
  function integer(key: string, fallback: number, max: number) {
    const raw = query[key];
    if (raw === undefined) return fallback;
    if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw) || Number(raw) > max)
      throw new CrudError(400, `${key} invalido`);
    return Number(raw);
  }
  return { page: integer("page", 1, 10000), limit: integer("limit", 20, 100) };
}

const filters: Record<CrudEntity, readonly string[]> = {
  roles: ["id", "name", "isActive"],
  permissions: ["id", "name", "key", "module", "isActive"],
  areas: ["id", "name", "isActive"],
  users: ["id", "name", "email", "roleId", "areaId", "isActive"],
  resources: [
    "id",
    "name",
    "areaId",
    "type",
    "status",
    "createdById",
    "mimeType",
    "originalFileName",
  ],
  audit: ["id", "action", "entity", "entityId", "areaId", "userId"],
};
const searchFields: Record<CrudEntity, readonly string[]> = {
  roles: ["name", "description"],
  permissions: ["name", "key", "module", "description"],
  areas: ["name", "description"],
  users: ["name", "email"],
  resources: ["name", "description", "originalFileName", "url"],
  audit: ["action", "entity", "entityId"],
};

export function listQuery(
  entity: CrudEntity,
  input: unknown,
  scopedAreaId?: string,
) {
  const query = object(input);
  const allowed = [
    "page",
    "limit",
    "q",
    "sortBy",
    "order",
    "createdFrom",
    "createdTo",
    ...filters[entity],
  ];
  if (Object.keys(query).some((key) => !allowed.includes(key)))
    throw new CrudError(400, "Parametros de consulta no permitidos");
  const { page, limit } = pagination(query);
  const columns: Record<string, string> = definitions[entity].columns;
  const fields: Record<string, Field> = definitions[entity].fields;
  const values: unknown[] = [];
  const conditions: string[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return "$" + values.length;
  };
  const column = (key: string) => '"' + columns[key] + '"';
  function string(key: string, max = 255) {
    const raw = query[key];
    if (typeof raw !== "string" || !raw.trim() || raw.trim().length > max)
      throw new CrudError(400, key + " invalido");
    return raw.trim();
  }
  if (scopedAreaId !== undefined)
    conditions.push("area_id = " + bind(scopedAreaId));
  for (const key of filters[entity]) {
    if (query[key] === undefined) continue;
    const raw = string(key, fields[key]?.max ?? 255);
    if (
      key === "areaId" &&
      scopedAreaId !== undefined &&
      raw.toLowerCase() !== scopedAreaId.toLowerCase()
    )
      throw new CrudError(403, "No puedes consultar otra area");
    if (key === "id") {
      conditions.push("id = " + bind(idValue(entity, raw)));
      continue;
    }
    const field =
      fields[key] ??
      (key === "userId" ? uuid("user_id", false, true) : uuid("created_by_id"));
    if (raw === "null" && field.nullable && field.kind === "uuid") {
      conditions.push(column(key) + " IS NULL");
      continue;
    }
    let parsed: unknown = raw;
    if (field.kind === "uuid") {
      if (!UUID.test(raw)) throw new CrudError(400, key + " invalido");
    } else if (field.kind === "boolean") {
      if (!["true", "false"].includes(raw))
        throw new CrudError(400, key + " invalido");
      parsed = raw === "true";
    } else if (field.kind === "integer") {
      if (
        !/^[1-9]\d*$/.test(raw) ||
        !Number.isSafeInteger(Number(raw)) ||
        Number(raw) > (field.max ?? 2147483647)
      )
        throw new CrudError(400, key + " invalido");
      parsed = Number(raw);
    } else if (field.choices && !field.choices.includes(raw)) {
      throw new CrudError(400, key + " invalido");
    }
    const parameter = bind(parsed);
    conditions.push(
      ["text", "email"].includes(field.kind) && !field.choices
        ? "LOWER(" + column(key) + ") = LOWER(" + parameter + ")"
        : column(key) + " = " + parameter,
    );
  }
  if (query.q !== undefined) {
    const pattern = "%" + string("q", 200).replace(/[!%_]/g, "!$&") + "%";
    const parameter = bind(pattern);
    conditions.push(
      "(" +
        searchFields[entity]
          .map((key) => column(key) + " ILIKE " + parameter + " ESCAPE '!'")
          .join(" OR ") +
        ")",
    );
  }
  function date(key: string): Date | undefined {
    if (query[key] === undefined) return;
    const raw = string(key, 30);
    // Explicit UTC timestamps avoid timezone-dependent results and normalized invalid dates.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw))
      throw new CrudError(
        400,
        key + " requiere fecha ISO UTC, ejemplo 2026-01-01T00:00:00Z",
      );
    const value = new Date(raw);
    if (
      !Number.isFinite(value.getTime()) ||
      value.getUTCFullYear() < 1 ||
      value.toISOString().slice(0, 19) !== raw.slice(0, 19)
    )
      throw new CrudError(400, key + " invalido");
    return value;
  }
  const from = date("createdFrom");
  const to = date("createdTo");
  if (from && to && from > to)
    throw new CrudError(400, "createdFrom no puede ser posterior a createdTo");
  if (from) conditions.push("created_at >= " + bind(from));
  if (to) conditions.push("created_at <= " + bind(to));
  const sortBy =
    query.sortBy === undefined ? "createdAt" : string("sortBy", 40);
  const sortable = [
    ...filters[entity],
    "createdAt",
    ...(entity === "audit" ? [] : ["updatedAt"]),
  ];
  if (!sortable.includes(sortBy))
    throw new CrudError(400, "sortBy no permitido");
  const order =
    query.order === undefined ? "desc" : string("order", 4).toLowerCase();
  if (!["asc", "desc"].includes(order))
    throw new CrudError(400, "order debe ser asc o desc");
  return {
    page,
    limit,
    values,
    where: conditions.length ? "WHERE " + conditions.join(" AND ") : "",
    orderBy:
      column(sortBy) +
      " " +
      order +
      " NULLS LAST" +
      (sortBy === "id" ? "" : ", id " + order),
  };
}

export function pageResult(
  entity: CrudEntity,
  rows: Row[],
  total: number,
  page: number,
  limit: number,
) {
  return {
    data: rows.map((row) => publicRow(entity, row)),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasNextPage: page * limit < total,
    hasPreviousPage: page > 1 && total > 0,
  };
}
export function publicRow(entity: CrudEntity, row: Row): Row {
  for (const key of ["avatarFileSize", "imageFileSize"]) {
    if (typeof row[key] === "string") row[key] = Number(row[key]);
  }
  if (entity === "resources" && row.fileSize !== null)
    row.fileSize = Number(row.fileSize);
  return row;
}

export class CrudStore {
  constructor(private readonly pool: Pool) {}

  async list(entity: CrudEntity, query: unknown = {}) {
    const { page, limit, values, where, orderBy } = listQuery(entity, query);
    const rows = await this.pool.query<Row>(
      `SELECT ${projection(entity)} FROM "${table(entity)}" ${where} ORDER BY ${orderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, (page - 1) * limit],
    );
    const total = await this.pool.query<{ total: string }>(
      `SELECT count(*) AS total FROM "${table(entity)}" ${where}`,
      values,
    );
    return pageResult(
      entity,
      rows.rows,
      Number(total.rows[0].total),
      page,
      limit,
    );
  }
  async get(entity: CrudEntity, id: string) {
    const rows = await this.pool.query<Row>(
      `SELECT ${projection(entity)} FROM "${table(entity)}" WHERE id = $1`,
      [idValue(entity, id)],
    );
    if (!rows.rows[0]) throw new CrudError(404, "Registro no encontrado");
    return publicRow(entity, rows.rows[0]);
  }
  async create(entity: WritableEntity, input: unknown, actorId: string) {
    const body = bodyValues(entity, input, false);
    if (entity === "resources") body.created_by_id = idValue("users", actorId);
    if (entity === "audit") body.user_id = idValue("users", actorId);
    const columns = Object.keys(body);
    const rows = await this.pool.query<Row>(
      `INSERT INTO "${table(entity)}" (${columns.map((key) => `"${key}"`).join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING ${projection(entity)}`,
      Object.values(body),
    );
    return publicRow(entity, rows.rows[0]);
  }
  async update(entity: WritableEntity, id: string, input: unknown) {
    const key = idValue(entity, id);
    const body = bodyValues(entity, input, true);
    const values = Object.values(body);
    const assignments = Object.keys(body).map((column, index) =>
      entity === "audit" && column === "metadata"
        ? `metadata = COALESCE(metadata, '{}'::jsonb) || $${index + 1}::jsonb`
        : `"${column}" = $${index + 1}`,
    );
    if (entity !== "audit") assignments.push("updated_at = now()");
    const rows = await this.pool.query<Row>(
      `UPDATE "${table(entity)}" SET ${assignments.join(", ")} WHERE id = $${values.length + 1} RETURNING ${projection(entity)}`,
      [...values, key],
    );
    if (!rows.rows[0]) throw new CrudError(404, "Registro no encontrado");
    return publicRow(entity, rows.rows[0]);
  }
  async remove(entity: WritableEntity, id: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM "${table(entity)}" WHERE id = $1 RETURNING id`,
      [idValue(entity, id)],
    );
    if (!result.rowCount) throw new CrudError(404, "Registro no encontrado");
  }
  async rolePermissions(id: string) {
    const roleId = idValue("roles", id);
    await this.get("roles", id);
    const result = await this.pool.query<Row>(
      `SELECT ${projection("permissions", "p.")} FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = $1 ORDER BY p.id`,
      [roleId],
    );
    return result.rows;
  }
  async setRolePermissions(id: string, input: unknown) {
    const roleId = idValue("roles", id);
    const body = object(input);
    if (
      Object.keys(body).length !== 1 ||
      !Array.isArray(body.permissionIds) ||
      body.permissionIds.length > 1000 ||
      body.permissionIds.some(
        (value: unknown) =>
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < 1 ||
          value > 2147483647,
      )
    ) {
      throw new CrudError(
        400,
        "Se requiere permissionIds como array de IDs enteros positivos (maximo 1000)",
      );
    }
    const ids = [...new Set(body.permissionIds as number[])];
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const role = await client.query(
        "SELECT id FROM roles WHERE id = $1 FOR UPDATE",
        [roleId],
      );
      if (!role.rowCount) throw new CrudError(404, "Rol no encontrado");
      await client.query("DELETE FROM role_permissions WHERE role_id = $1", [
        roleId,
      ]);
      await client.query(
        "INSERT INTO role_permissions (role_id, permission_id) SELECT $1, unnest($2::integer[])",
        [roleId, ids],
      );
      const result = await client.query<Row>(
        `SELECT ${projection("permissions", "p.")} FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = $1 ORDER BY p.id`,
        [roleId],
      );
      await client.query("COMMIT");
      return result.rows;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function crudErrorStatus(
  error: unknown,
): { status: number; message: string } | undefined {
  if (error instanceof CrudError)
    return { status: error.status, message: error.message };
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (code === "23505")
    return {
      status: 409,
      message: "Ya existe un registro con esos datos unicos",
    };
  if (code === "23503")
    return {
      status: 409,
      message:
        "Una relacion no existe o hay registros vinculados que impiden la operacion",
    };
  return undefined;
}
