const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");

module.exports = async function testAreaAccess({
  store,
  pool,
  services,
  auth,
  superToken,
}) {
  let checks = 0;
  const ownArea = await store.create(
    "areas",
    { name: "Finanzas Norte" },
    randomUUID(),
  );
  const otherArea = await store.create(
    "areas",
    { name: "Ventas" },
    randomUUID(),
  );
  const adminRole = await store.create(
    "roles",
    { name: "administrador" },
    randomUUID(),
  );
  const ordinaryRole = await store.create(
    "roles",
    { name: "usuario-area" },
    randomUUID(),
  );
  const permission = await store.create(
    "permissions",
    { key: "area.finanzas", name: "Finanzas", module: ownArea.name },
    randomUUID(),
  );
  const actor = await store.create(
    "users",
    {
      googleSub: "area-admin-subject",
      email: "area-admin@example.com",
      name: "Area admin",
      areaId: ownArea.id,
      roleId: adminRole.id,
    },
    randomUUID(),
  );
  const sid = randomUUID();
  await pool.query(
    "INSERT INTO user_sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
    [sid, actor.id],
  );
  const { JwtService } = auth.requireService("@nestjs/jwt");
  const token = new JwtService({ secret: process.env.JWT_SECRET }).sign(
    { sub: actor.id, sid, token_use: "access" },
    {
      algorithm: "HS256",
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
      expiresIn: 900,
    },
  );
  async function call(
    entity,
    method,
    suffix,
    body,
    status,
    area = ownArea.id,
    bearer = token,
  ) {
    if (bearer) await delay(550);
    const response = await fetch(
      `${services[entity].base}/area-admin/areas/${encodeURIComponent(area)}/${entity}${suffix}`,
      {
        method,
        headers: {
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          "x-role": "administrador",
          "x-area-id": ownArea.id,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const result = response.status === 204 ? undefined : await response.json();
    assert.equal(
      response.status,
      status,
      `${method} ${entity}${suffix}: ${JSON.stringify(result)}`,
    );
    checks++;
    return result;
  }
  for (const entity of ["users", "resources", "audit"]) {
    await call(entity, "GET", "", undefined, 401, ownArea.id, null);
    await call(entity, "GET", "", undefined, 401, ownArea.id, "invalid-token");
    await call(entity, "GET", "", undefined, 403, ownArea.id, superToken);
    await call(entity, "GET", "", undefined, 403); // permission exists but is not linked
  }
  await store.setRolePermissions(String(adminRole.id), {
    permissionIds: [permission.id],
  });
  for (const entity of ["users", "resources", "audit"]) {
    await call(entity, "GET", "", undefined, 200);
    await call(entity, "GET", "", undefined, 200, ownArea.name);
    await call(entity, "GET", "", undefined, 403, otherArea.id);
    await call(entity, "GET", "", undefined, 403, otherArea.name);
    await call(entity, "GET", "", undefined, 403, ownArea.name.toLowerCase());
  }
  // Verify every dependency in the authorization join with the same signed JWT.
  for (const [table, column, id, disabled, restored] of [
    ["permissions", "is_active", permission.id, false, true],
    [
      "permissions",
      "module",
      permission.id,
      ownArea.name.toLowerCase(),
      ownArea.name,
    ],
    ["areas", "is_active", ownArea.id, false, true],
    ["areas", "name", ownArea.id, "Renamed area", ownArea.name],
    ["roles", "is_active", adminRole.id, false, true],
    ["roles", "name", adminRole.id, "Administrador", "administrador"],
    ["users", "is_active", actor.id, false, true],
    ["users", "area_id", actor.id, otherArea.id, ownArea.id],
    ["users", "area_id", actor.id, null, ownArea.id],
    ["users", "role_id", actor.id, ordinaryRole.id, adminRole.id],
  ]) {
    // Table and column are fixed test constants, never HTTP input.
    await pool.query(`UPDATE ${table} SET ${column} = $1 WHERE id = $2`, [
      disabled,
      id,
    ]);
    await call("resources", "GET", "", undefined, 403);
    await pool.query(`UPDATE ${table} SET ${column} = $1 WHERE id = $2`, [
      restored,
      id,
    ]);
  }
  const records = {};
  for (const entity of ["resources", "users", "audit"]) {
    const body =
      entity === "resources"
        ? { name: "Area document", type: "DOCUMENT", areaName: ownArea.name }
        : entity === "audit"
          ? {
              action: "area.note",
              entity: "resources",
              metadata: { note: "Within area" },
            }
          : {
              name: "Area user",
              email: "scoped-user@example.com",
              googleSub: "scoped-user-subject",
              roleId: ordinaryRole.id,
            };
    const record = await call(entity, "POST", "", body, 201, ownArea.name);
    records[entity] = record;
    if (entity === "users") {
      await call(
        entity,
        "PATCH",
        "/" + record.id + "/deactivate",
        undefined,
        401,
        ownArea.id,
        null,
      );
      assert.equal(
        (
          await call(
            entity,
            "PATCH",
            "/" + record.id + "/deactivate",
            undefined,
            200,
          )
        ).isActive,
        false,
      );
      assert.equal(
        (await call(entity, "GET", "/" + record.id, undefined, 200)).isActive,
        false,
      );
      assert.equal(
        (
          await call(
            entity,
            "PATCH",
            "/" + record.id + "/activate",
            undefined,
            200,
          )
        ).isActive,
        true,
      );
      for (const action of ["activate", "deactivate"]) {
        await call(
          entity,
          "PATCH",
          "/" + record.id + "/" + action,
          undefined,
          403,
          otherArea.id,
        );
      }
    } else {
      await call(
        entity,
        "PATCH",
        "/" + record.id + "/activate",
        undefined,
        404,
      );
    }
    assert.equal(record.areaId, ownArea.id);
    assert.equal(record.googleSub, undefined);
    if (entity === "resources") assert.equal(record.createdById, actor.id);
    if (entity === "audit") assert.equal(record.userId, actor.id);
    const field = entity === "audit" ? "action" : "name";
    const list = await call(entity, "GET", "?limit=1", undefined, 200);
    assert.equal(list.total, entity === "users" ? 2 : 1);
    assert.ok(list.data.every((item) => item.areaId === ownArea.id));
    assert.equal(
      (await call(entity, "GET", "/" + record.id, undefined, 200)).id,
      record.id,
    );
    await call(
      entity,
      "PATCH",
      "/" + record.id,
      { [field]: "Updated within area" },
      200,
    );
    await call(entity, "PATCH", "/" + record.id, { areaId: otherArea.id }, 403);
    await call(entity, "PATCH", "/" + record.id, { areaId: null }, 403);
    await call(entity, "POST", "", { ...body, areaId: otherArea.id }, 403);
    await call(entity, "POST", "", { ...body, areaName: otherArea.name }, 403);
    await call(
      entity,
      "PATCH",
      "/" + record.id,
      { role: "superadministrador" },
      400,
    );
    await call(entity, "GET", "?areaId=" + otherArea.id, undefined, 403);
    // A valid ID from another area must not be exposed or modified.
    await store.update(entity, record.id, { areaId: otherArea.id });
    if (entity === "users") {
      for (const action of ["activate", "deactivate"]) {
        await call(
          entity,
          "PATCH",
          "/" + record.id + "/" + action,
          undefined,
          404,
        );
      }
    }
    const empty = await call(entity, "GET", "", undefined, 200);
    assert.equal(empty.total, entity === "users" ? 1 : 0);
    assert.ok(empty.data.every((item) => item.areaId === ownArea.id));
    await call(entity, "GET", "/" + record.id, undefined, 404);
    await call(
      entity,
      "PATCH",
      "/" + record.id,
      { [field]: "Cross-area write" },
      404,
    );
    await call(entity, "DELETE", "/" + record.id, undefined, 404);
    await store.update(entity, record.id, { areaId: ownArea.id });
  }
  // Preserve delivery metadata and exclude audit records without an area.
  await pool.query(
    "UPDATE audit_logs SET metadata = metadata || $1::jsonb WHERE id = $2",
    [JSON.stringify({ eventHash: "original-area-event" }), records.audit.id],
  );
  await call(
    "audit",
    "PATCH",
    "/" + records.audit.id,
    { metadata: { eventHash: "forged" } },
    400,
  );
  const changedAudit = await call(
    "audit",
    "PATCH",
    "/" + records.audit.id,
    { metadata: { note: "Updated" } },
    200,
  );
  assert.equal(changedAudit.metadata.eventHash, "original-area-event");
  assert.equal(changedAudit.metadata.note, "Updated");
  const unassigned = await store.create(
    "audit",
    { action: "global.note", entity: "test" },
    actor.id,
  );
  await call("audit", "GET", "/" + unassigned.id, undefined, 404);
  await call("audit", "DELETE", "/" + unassigned.id, undefined, 404);
  const superRole = (
    await pool.query("SELECT id FROM roles WHERE name = 'superadministrador'")
  ).rows[0];
  for (const roleId of [adminRole.id, superRole.id]) {
    await call(
      "users",
      "POST",
      "",
      {
        name: "Escalation",
        googleSub: "escalation",
        email: "escalation@example.com",
        roleId,
      },
      403,
    );
    await call("users", "PATCH", "/" + records.users.id, { roleId }, 403);
  }
  await call(
    "users",
    "PATCH",
    "/" + actor.id,
    { name: "Changed administrator" },
    403,
  );
  await call("users", "DELETE", "/" + actor.id, undefined, 403);
  for (const action of ["activate", "deactivate"]) {
    await call("users", "PATCH", "/" + actor.id + "/" + action, undefined, 403);
  }
  await store.update("users", records.users.id, { roleId: superRole.id });
  await call(
    "users",
    "PATCH",
    "/" + records.users.id + "/deactivate",
    undefined,
    403,
  );
  await call(
    "users",
    "PATCH",
    "/" + records.users.id,
    { isActive: false },
    403,
  );
  await call("users", "DELETE", "/" + records.users.id, undefined, 403);
  await store.update("users", records.users.id, { roleId: ordinaryRole.id });
  // The area administrator cannot use the global superadministrator controller.
  await delay(550);
  assert.equal(
    (
      await fetch(services.resources.base + "/admin/resources", {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status,
    403,
  );
  checks++;
  await store.setRolePermissions(String(adminRole.id), { permissionIds: [] });
  await call("resources", "DELETE", "/" + records.resources.id, undefined, 403);
  await store.setRolePermissions(String(adminRole.id), {
    permissionIds: [permission.id],
  });
  await pool.query("UPDATE user_sessions SET is_active = false WHERE id = $1", [
    sid,
  ]);
  await call("resources", "GET", "", undefined, 401);
  await pool.query("UPDATE user_sessions SET is_active = true WHERE id = $1", [
    sid,
  ]);
  for (const entity of ["resources", "users", "audit"]) {
    await call(entity, "DELETE", "/" + records[entity].id, undefined, 204);
    await call(entity, "GET", "/" + records[entity].id, undefined, 404);
  }
  console.log(
    `OK: ${checks} HTTP checks for area assignments, role/permission joins and isolated CRUD.`,
  );
  return checks;
};
