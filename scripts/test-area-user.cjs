const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");

module.exports = async function testAreaUser({
  store,
  pool,
  services,
  auth,
  superToken,
}) {
  const { AREA_USER_ROLE, AreaCrudStore } = auth.requireService("database");
  let checks = 0;
  const area = await store.create(
    "areas",
    { name: "Usuarios normales" },
    randomUUID(),
  );
  const foreignArea = await store.create(
    "areas",
    { name: "Otra area de usuarios" },
    randomUUID(),
  );
  const role = await store.create(
    "roles",
    { name: AREA_USER_ROLE },
    randomUUID(),
  );
  const actor = await store.create(
    "users",
    {
      googleSub: "normal-area-subject",
      email: "normal-area@example.com",
      name: "Normal user",
      roleId: role.id,
      areaId: area.id,
    },
    randomUUID(),
  );
  const peer = await store.create(
    "users",
    {
      googleSub: "normal-peer-subject",
      email: "normal-peer@example.com",
      name: "Peer",
      roleId: role.id,
      areaId: area.id,
    },
    randomUUID(),
  );
  const sharedResource = await store.create(
    "resources",
    { areaId: area.id, name: "Peer resource", type: "DOCUMENT" },
    peer.id,
  );
  const foreignResource = await store.create(
    "resources",
    { areaId: foreignArea.id, name: "Foreign resource", type: "DOCUMENT" },
    peer.id,
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
    method,
    suffix,
    body,
    status,
    reference = area.id,
    bearer = token,
  ) {
    if (bearer) await delay(550);
    const response = await fetch(
      `${services.resources.base}/area-user/areas/${encodeURIComponent(reference)}/resources${suffix}`,
      {
        method,
        headers: {
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          "x-role": AREA_USER_ROLE,
          "x-area-id": area.id,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const result = response.status === 204 ? undefined : await response.json();
    assert.equal(
      response.status,
      status,
      `${method} normal resources${suffix}: ${JSON.stringify(result)}`,
    );
    checks++;
    return result;
  }
  await call("GET", "", undefined, 401, area.id, null);
  await call("GET", "", undefined, 401, area.id, "invalid-token");
  await call("GET", "", undefined, 403, area.id, superToken);
  // This role intentionally has NO permissions; the user's area is the boundary.
  assert.equal((await store.rolePermissions(String(role.id))).length, 0);
  assert.equal((await call("GET", "", undefined, 200)).total, 1);
  await call("GET", "", undefined, 200, area.name);
  await call("GET", "", undefined, 403, foreignArea.id);
  await call("GET", "", undefined, 403, foreignArea.name);
  await call("GET", "", undefined, 403, area.name.toUpperCase());
  const body = {
    name: "Created by normal user",
    type: "DOCUMENT",
    areaName: area.name,
  };
  const created = await call("POST", "", body, 201);
  assert.equal(created.areaId, area.id);
  assert.equal(created.createdById, actor.id);
  const list = await call("GET", "?limit=1", undefined, 200);
  assert.equal(list.total, 2);
  assert.equal(list.data.length, 1);
  assert.ok(list.data.every((row) => row.areaId === area.id));
  await call("GET", "/" + created.id, undefined, 200);
  await call("PATCH", "/" + created.id, { name: "Edited own resource" }, 200);
  // All resources in the assigned area are available, irrespective of creator.
  await call("GET", "/" + sharedResource.id, undefined, 200);
  await call(
    "PATCH",
    "/" + sharedResource.id,
    { name: "Edited peer resource" },
    200,
  );
  await call("DELETE", "/" + sharedResource.id, undefined, 204);
  for (const [method, suffix, requestBody] of [
    ["GET", "/" + foreignResource.id, undefined],
    ["PATCH", "/" + foreignResource.id, { name: "Cross-area write" }],
    ["DELETE", "/" + foreignResource.id, undefined],
  ])
    await call(method, suffix, requestBody, 404);
  assert.equal(
    (await store.get("resources", foreignResource.id)).name,
    "Foreign resource",
  );
  await call("POST", "", { ...body, areaId: foreignArea.id }, 403);
  await call("POST", "", { ...body, areaName: foreignArea.name }, 403);
  await call("POST", "", { ...body, createdById: peer.id }, 400);
  await call("PATCH", "/" + created.id, { areaId: foreignArea.id }, 403);
  await call("PATCH", "/" + created.id, { areaId: null }, 403);
  await call("PATCH", "/" + created.id, { createdById: peer.id }, 400);
  await call("PATCH", "/" + created.id, { role: "superadministrador" }, 400);
  await call("GET", "?areaId=" + foreignArea.id, undefined, 403);
  // Role, user and area changes take effect with the same access token.
  const adminRole = (
    await pool.query("SELECT id FROM roles WHERE name = 'administrador'")
  ).rows[0];
  for (const [table, column, id, disabled, restored] of [
    ["roles", "name", role.id, AREA_USER_ROLE.toUpperCase(), AREA_USER_ROLE],
    ["users", "role_id", actor.id, adminRole.id, role.id],
    ["roles", "is_active", role.id, false, true],
    ["users", "is_active", actor.id, false, true],
    ["users", "area_id", actor.id, null, area.id],
    ["areas", "is_active", area.id, false, true],
  ]) {
    // Table and column are fixed test identifiers, never HTTP input.
    await pool.query(`UPDATE ${table} SET ${column} = $1 WHERE id = $2`, [
      disabled,
      id,
    ]);
    await call("GET", "", undefined, 403);
    await pool.query(`UPDATE ${table} SET ${column} = $1 WHERE id = $2`, [
      restored,
      id,
    ]);
  }
  await pool.query("UPDATE users SET area_id = $1 WHERE id = $2", [
    foreignArea.id,
    actor.id,
  ]);
  await call("GET", "", undefined, 403);
  assert.equal(
    (await call("GET", "", undefined, 200, foreignArea.id)).total,
    1,
  );
  await pool.query("UPDATE users SET area_id = $1 WHERE id = $2", [
    area.id,
    actor.id,
  ]);
  await pool.query("UPDATE user_sessions SET is_active = false WHERE id = $1", [
    sid,
  ]);
  await call("GET", "", undefined, 401);
  await pool.query("UPDATE user_sessions SET is_active = true WHERE id = $1", [
    sid,
  ]);
  for (const [name, path, expected] of [
    ["resources", "/resources", 403],
    ["resources", "/admin/resources", 403],
    ["resources", `/area-admin/areas/${area.id}/resources`, 403],
    ["users", `/area-admin/areas/${area.id}/users`, 403],
    ["audit", `/area-admin/areas/${area.id}/audit`, 403],
    ["users", `/area-user/areas/${area.id}/users`, 404],
    ["audit", `/area-user/areas/${area.id}/audit`, 404],
  ]) {
    await delay(550);
    const response = await fetch(services[name].base + path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, expected, path);
    checks++;
  }
  const restrictedStore = new AreaCrudStore(pool, "user");
  for (const entity of ["users", "audit"]) {
    for (const operation of [
      () => restrictedStore.list(entity, actor.id, area.id, {}),
      () => restrictedStore.get(entity, actor.id, area.id, actor.id),
      () => restrictedStore.create(entity, actor.id, area.id, {}),
      () => restrictedStore.update(entity, actor.id, area.id, actor.id, {}),
      () => restrictedStore.remove(entity, actor.id, area.id, actor.id),
    ])
      await assert.rejects(operation, (error) => error.status === 403);
  }
  await call("DELETE", "/" + created.id, undefined, 204);
  await call("GET", "/" + created.id, undefined, 404);
  assert.equal((await call("GET", "", undefined, 200)).total, 0);
  console.log(
    `OK: ${checks} HTTP checks for normal users and area resources, plus 10 data-layer restriction checks.`,
  );
  return checks;
};
