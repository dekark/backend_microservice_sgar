import type { Pool, PoolClient } from "pg";
import {
  CrudError,
  bodyValues,
  idValue,
  object,
  listQuery,
  pageResult,
  projection,
  publicRow,
} from "./crud";

export type AreaCrudEntity = "resources" | "users" | "audit";
export const AREA_USER_ROLE = "usuario normal";
const table = (entity: AreaCrudEntity) =>
  entity === "audit" ? "audit_logs" : entity;
export interface AssignedArea {
  id: string;
  name: string;
}
const protectedRoles = [
  "administrador",
  "superadministrador",
  "superadministardor",
];

export class AreaCrudStore {
  constructor(
    private readonly pool: Pool,
    private readonly access: "administrator" | "user" = "administrator",
  ) {}

  private requireEntityAccess(entity: AreaCrudEntity) {
    if (this.access === "user" && entity !== "resources") {
      throw new CrudError(
        403,
        "El usuario de area solo puede gestionar recursos",
      );
    }
  }

  async authorize(
    actorId: string,
    reference: string,
    client?: PoolClient,
  ): Promise<AssignedArea> {
    if (
      typeof reference !== "string" ||
      !reference.length ||
      reference.length > 150
    ) {
      throw new CrudError(400, "Area invalida: usa su ID o nombre exacto");
    }
    if (this.access === "user") {
      const result = await (client ?? this.pool).query<AssignedArea>(
        `SELECT a.id, a.name FROM users u
         JOIN roles r ON r.id = u.role_id
         JOIN areas a ON a.id = u.area_id
         WHERE u.id = $1 AND u.is_active AND r.is_active AND a.is_active
           AND r.name = $3 AND (a.id::text = $2 OR a.name = $2)
         ${client ? "FOR SHARE OF u, r, a" : ""}`,
        [idValue("users", actorId), reference, AREA_USER_ROLE],
      );
      if (!result.rows[0])
        throw new CrudError(
          403,
          "Se requiere rol usuario normal y un area activa asignada",
        );
      return result.rows[0];
    }
    const result = await (client ?? this.pool).query<AssignedArea>(
      `SELECT a.id, a.name FROM users u
       JOIN roles r ON r.id = u.role_id
       JOIN areas a ON a.id = u.area_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE u.id = $1 AND u.is_active AND r.is_active AND a.is_active
         AND r.name = 'administrador' AND p.is_active AND p.module = a.name
         AND (a.id::text = $2 OR a.name = $2)
       ORDER BY p.id LIMIT 1 ${client ? "FOR SHARE OF u, r, a, rp, p" : ""}`,
      [idValue("users", actorId), reference],
    );
    if (!result.rows[0])
      throw new CrudError(
        403,
        "Se requiere rol administrador, area asignada y permiso activo cuyo module sea el nombre exacto del area",
      );
    return result.rows[0];
  }

  private async within<T>(
    actorId: string,
    reference: string,
    operation: (client: PoolClient, area: AssignedArea) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Keep the assignment and permission valid for the whole operation.
      const area = await this.authorize(actorId, reference, client);
      const result = await operation(client, area);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private scopedBody(input: unknown, area: AssignedArea, update: boolean) {
    const body = { ...object(input) };
    if (Object.hasOwn(body, "areaId") && body.areaId !== area.id) {
      throw new CrudError(403, "No puedes mover registros a otra area");
    }
    if (Object.hasOwn(body, "areaName") && body.areaName !== area.name) {
      throw new CrudError(
        403,
        "El nombre del area no coincide con el area asignada",
      );
    }
    delete body.areaName;
    if (!update) body.areaId = area.id;
    return body;
  }

  async list(
    entity: AreaCrudEntity,
    actorId: string,
    reference: string,
    query: unknown,
  ) {
    this.requireEntityAccess(entity);
    return this.within(actorId, reference, async (client, area) => {
      const { page, limit, values, where, orderBy } = listQuery(
        entity,
        query,
        area.id,
      );
      const rows = await client.query(
        `SELECT ${projection(entity)} FROM "${table(entity)}" ${where} ORDER BY ${orderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, (page - 1) * limit],
      );
      const count = await client.query<{ total: string }>(
        `SELECT count(*) AS total FROM "${table(entity)}" ${where}`,
        values,
      );
      return pageResult(
        entity,
        rows.rows,
        Number(count.rows[0].total),
        page,
        limit,
      );
    });
  }

  async get(
    entity: AreaCrudEntity,
    actorId: string,
    reference: string,
    id: string,
  ) {
    this.requireEntityAccess(entity);
    const key = idValue(entity, id);
    return this.within(actorId, reference, async (client, area) => {
      const result = await client.query(
        `SELECT ${projection(entity)} FROM "${table(entity)}" WHERE id = $1 AND area_id = $2`,
        [key, area.id],
      );
      if (!result.rows[0])
        throw new CrudError(404, "Registro no encontrado en tu area");
      return publicRow(entity, result.rows[0]);
    });
  }

  async create(
    entity: AreaCrudEntity,
    actorId: string,
    reference: string,
    input: unknown,
  ) {
    this.requireEntityAccess(entity);
    return this.within(actorId, reference, async (client, area) => {
      const body = bodyValues(
        entity,
        this.scopedBody(input, area, false),
        false,
      );
      if (entity === "users") {
        const role = await client.query<{ name: string }>(
          "SELECT name FROM roles WHERE id = $1 AND is_active FOR SHARE",
          [body.role_id],
        );
        if (!role.rows[0] || protectedRoles.includes(role.rows[0].name)) {
          throw new CrudError(
            403,
            "Solo el superadministrador puede asignar roles administrativos",
          );
        }
      } else if (entity === "resources") body.created_by_id = actorId;
      else body.user_id = actorId;
      const columns = Object.keys(body);
      const result = await client.query(
        `INSERT INTO "${table(entity)}" (${columns.map((key) => `"${key}"`).join(", ")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING ${projection(entity)}`,
        Object.values(body),
      );
      return publicRow(entity, result.rows[0]);
    });
  }

  private async lockOrdinaryUser(
    client: PoolClient,
    id: string | number,
    area: AssignedArea,
  ) {
    const result = await client.query<{ name: string }>(
      "SELECT r.name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.area_id = $2 FOR UPDATE OF u FOR SHARE OF r",
      [id, area.id],
    );
    if (!result.rows[0])
      throw new CrudError(404, "Registro no encontrado en tu area");
    if (protectedRoles.includes(result.rows[0].name))
      throw new CrudError(
        403,
        "Solo el superadministrador puede modificar usuarios administrativos",
      );
  }

  async update(
    entity: AreaCrudEntity,
    actorId: string,
    reference: string,
    id: string,
    input: unknown,
  ) {
    this.requireEntityAccess(entity);
    const key = idValue(entity, id);
    return this.within(actorId, reference, async (client, area) => {
      const scoped = this.scopedBody(input, area, true);
      if (entity === "users") {
        if (Object.hasOwn(scoped, "roleId"))
          throw new CrudError(
            403,
            "Solo el superadministrador puede cambiar roles",
          );
        await this.lockOrdinaryUser(client, key, area);
      }
      const body = bodyValues(entity, scoped, true);
      const values = Object.values(body);
      const assignments = Object.keys(body).map((column, i) =>
        entity === "audit" && column === "metadata"
          ? `metadata = COALESCE(metadata, '{}'::jsonb) || $${i + 1}::jsonb`
          : `"${column}" = $${i + 1}`,
      );
      if (entity !== "audit") assignments.push("updated_at = now()");
      const result = await client.query(
        `UPDATE "${table(entity)}" SET ${assignments.join(", ")} WHERE id = $${values.length + 1} AND area_id = $${values.length + 2} RETURNING ${projection(entity)}`,
        [...values, key, area.id],
      );
      if (!result.rows[0])
        throw new CrudError(404, "Registro no encontrado en tu area");
      return publicRow(entity, result.rows[0]);
    });
  }

  async remove(
    entity: AreaCrudEntity,
    actorId: string,
    reference: string,
    id: string,
  ): Promise<void> {
    this.requireEntityAccess(entity);
    const key = idValue(entity, id);
    return this.within(actorId, reference, async (client, area) => {
      if (entity === "users") await this.lockOrdinaryUser(client, key, area);
      const result = await client.query(
        `DELETE FROM "${table(entity)}" WHERE id = $1 AND area_id = $2 RETURNING id`,
        [key, area.id],
      );
      if (!result.rowCount)
        throw new CrudError(404, "Registro no encontrado en tu area");
    });
  }
}
