const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");

module.exports = async function testSearch({
  store,
  pool,
  services,
  auth,
  superToken,
}) {
  let checks = 0;
  const tag = "Search-" + randomUUID();
  async function role(name) {
    return (
      (await pool.query("SELECT id FROM roles WHERE name = $1", [name]))
        .rows[0] ?? (await store.create("roles", { name }, randomUUID()))
    );
  }
  const normalRole = await role("usuario normal");
  const adminRole = await role("administrador");
  const ownArea = await store.create(
    "areas",
    { name: "Filter scope " + randomUUID() },
    randomUUID(),
  );
  const foreignArea = await store.create(
    "areas",
    { name: "Foreign scope " + randomUUID() },
    randomUUID(),
  );
  async function user(name, areaId, roleId = normalRole.id) {
    return store.create(
      "users",
      {
        name,
        areaId,
        roleId,
        googleSub: randomUUID(),
        email: randomUUID() + "@example.com",
      },
      randomUUID(),
    );
  }
  const actor = await user("Filter actor", ownArea.id);
  const admin = await user("Filter admin", ownArea.id, adminRole.id);
  const outsider = await user("Filter outsider", foreignArea.id);
  const permission = await store.create(
    "permissions",
    { name: "Filter permission", key: randomUUID(), module: ownArea.name },
    actor.id,
  );
  await store.setRolePermissions(String(adminRole.id), {
    permissionIds: [permission.id],
  });
  const { JwtService } = auth.requireService("@nestjs/jwt");
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  async function sign(person) {
    const sid = randomUUID();
    await pool.query(
      "INSERT INTO user_sessions (id, user_id, expires_at) VALUES ($1,$2, now() + interval '1 hour')",
      [sid, person.id],
    );
    return jwt.sign(
      { sub: person.id, sid, token_use: "access" },
      {
        algorithm: "HS256",
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
        expiresIn: 900,
      },
    );
  }
  const normalToken = await sign(actor);
  const adminToken = await sign(admin);
  const outsiderToken = await sign(outsider);
  async function call(entity, path, token = superToken, status = 200) {
    if (token) await delay(550);
    const response = await fetch(services[entity].base + path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    assert.equal(response.status, status, path + ": " + JSON.stringify(result));
    checks++;
    return result;
  }
  const encode = encodeURIComponent;
  const fixtures = {};
  for (const entity of [
    "roles",
    "permissions",
    "areas",
    "users",
    "resources",
    "audit",
  ]) {
    fixtures[entity] = [];
    for (const [index, suffix] of ["Alpha", "Beta"].entries()) {
      const name = tag + "-" + suffix;
      const body =
        entity === "users"
          ? {
              name,
              googleSub: randomUUID(),
              email: randomUUID() + "@example.com",
              roleId: normalRole.id,
              areaId: ownArea.id,
              isActive: index === 0,
            }
          : entity === "resources"
            ? {
                name,
                description: "Search fixture",
                type: index === 0 ? "DOCUMENT" : "FILE",
                status: index === 0 ? "ACTIVE" : "ARCHIVED",
                areaId: ownArea.id,
                originalFileName: suffix + ".pdf",
                mimeType: "application/pdf",
              }
            : entity === "audit"
              ? {
                  action: name,
                  entity: "search-fixture",
                  entityId: suffix,
                  areaId: ownArea.id,
                }
              : entity === "permissions"
                ? {
                    name,
                    key: randomUUID(),
                    module: "search-fixture",
                    isActive: index === 0,
                  }
                : { name, isActive: index === 0 };
      const record = await store.create(entity, body, actor.id);
      fixtures[entity].push(record);
      const table = entity === "audit" ? "audit_logs" : entity; // fixed test entities only
      await pool.query(`UPDATE "${table}" SET created_at = $1 WHERE id = $2`, [
        `2025-04-0${index + 1}T12:00:00Z`,
        record.id,
      ]);
    }
    const key = entity === "audit" ? "action" : "name";
    const base = "/" + entity;
    const params = new URLSearchParams({
      q: tag.toLowerCase(),
      limit: "1",
      sortBy: key,
      order: "asc",
    });
    const first = await call(entity, base + "?" + params);
    assert.equal(first.total, 2);
    assert.equal(first.totalPages, 2);
    assert.equal(first.hasNextPage, true);
    assert.equal(first.hasPreviousPage, false);
    assert.equal(first.data[0].id, fixtures[entity][0].id);
    const second = await call(entity, base + "?" + params + "&page=2");
    assert.equal(second.data[0].id, fixtures[entity][1].id);
    assert.equal(second.hasNextPage, false);
    assert.equal(second.hasPreviousPage, true);
    const emptyPage = await call(entity, base + "?" + params + "&page=3");
    assert.equal(emptyPage.total, 2);
    assert.deepEqual(emptyPage.data, []);
    const exactPath = base + "/by-" + key + "/" + encode(tag + "-alpha");
    assert.equal(
      (await call(entity, exactPath)).data[0].id,
      fixtures[entity][0].id,
    );
    assert.equal((await call(entity, "/admin" + exactPath)).total, 1);
    await call(entity, exactPath, null, 401);
    await call(entity, exactPath, normalToken, 403);
    assert.equal(
      (await call(entity, base + "/" + fixtures[entity][0].id)).id,
      fixtures[entity][0].id,
    );
    const filtered = await call(
      entity,
      base +
        "?" +
        new URLSearchParams({
          q: tag,
          createdFrom: "2025-04-01T00:00:00Z",
          createdTo: "2025-04-01T23:59:59.999Z",
        }),
    );
    assert.equal(filtered.total, 1);
    assert.equal(filtered.data[0].id, fixtures[entity][0].id);
  }
  const extraFilters = {
    roles: { isActive: "false" },
    areas: { isActive: "false" },
    permissions: { module: "search-fixture", key: fixtures.permissions[0].key },
    users: {
      roleId: String(normalRole.id),
      email: fixtures.users[0].email,
      areaId: ownArea.id,
      isActive: "true",
    },
    resources: {
      type: "DOCUMENT",
      status: "ACTIVE",
      areaId: ownArea.id,
      createdById: actor.id,
      mimeType: "application/pdf",
      originalFileName: "Alpha.pdf",
    },
    audit: {
      action: tag + "-Alpha",
      entity: "search-fixture",
      entityId: "Alpha",
      areaId: ownArea.id,
      userId: actor.id,
    },
  };
  for (const [entity, query] of Object.entries(extraFilters)) {
    const filtered = await call(
      entity,
      "/" + entity + "?" + new URLSearchParams({ q: tag, ...query }),
    );
    assert.equal(filtered.total, 1);
    assert.equal(filtered.data.length, 1);
  }
  for (const query of [
    "limit=101",
    "page=0",
    "page=1.5",
    "limit=1&limit=2",
    "q=x&q=y",
    "q=",
    "q[x]=y",
    "unknown=x",
    "sortBy=googleSub",
    "sortBy=id%3BDROP%20TABLE%20roles",
    "order=sideways",
    "isActive=yes",
    "id=abc",
    "createdFrom=2025-02-30T00:00:00Z",
    "createdTo=not-a-date",
    "createdFrom=2025-04-02T00:00:00Z&createdTo=2025-04-01T00:00:00Z",
  ]) {
    await call("roles", "/roles?" + query, superToken, 400);
  }
  await call("resources", "/resources?type=unknown", superToken, 400);
  await call("users", "/users?roleId=0", superToken, 400);
  await call("resources", "/resources?areaId=invalid", superToken, 400);
  const absent = await call("roles", "/roles/by-name/no-such-" + randomUUID());
  assert.equal(absent.total, 0);
  assert.equal(absent.totalPages, 0);
  assert.deepEqual(absent.data, []);
  const literal = await store.create(
    "roles",
    { name: "Literal %_! Robert'); DROP TABLE roles;--" },
    actor.id,
  );
  for (const q of ["%_!", "Literal %_! Robert'); DROP TABLE roles;--"]) {
    const result = await call("roles", "/roles?" + new URLSearchParams({ q }));
    assert.equal(result.total, 1);
    assert.equal(result.data[0].id, literal.id);
  }
  // Duplicate names are returned as a paginated set, never an arbitrary first row.
  const repeated = "Repeated " + randomUUID();
  for (const areaId of [ownArea.id, ownArea.id, foreignArea.id]) {
    await store.create(
      "resources",
      { name: repeated, type: "FILE", areaId },
      actor.id,
    );
  }
  assert.equal(
    (await call("resources", "/resources/by-name/" + encode(repeated))).total,
    3,
  );
  for (const [prefix, token] of [
    ["area-user", normalToken],
    ["area-admin", adminToken],
  ]) {
    const base = `/${prefix}/areas/${ownArea.id}/resources`;
    const result = await call(
      "resources",
      base + "/by-name/" + encode(repeated) + "?limit=1",
      token,
    );
    assert.equal(result.total, 2);
    assert.equal(result.totalPages, 2);
    assert.equal(result.data[0].areaId, ownArea.id);
    assert.equal(
      (
        await call(
          "resources",
          base +
            "?" +
            new URLSearchParams({
              q: repeated,
              type: "FILE",
              areaId: ownArea.id,
            }),
          token,
        )
      ).total,
      2,
    );
    await call("resources", base + "?areaId=" + foreignArea.id, token, 403);
    await call(
      "resources",
      base + "/by-name/" + encode(repeated),
      outsiderToken,
      403,
    );
    const empty = await call(
      "resources",
      base + "?id=" + fixtures.resources[0].id + "&type=VIDEO",
      token,
    );
    assert.equal(empty.total, 0);
  }
  for (const entity of ["users", "audit"]) {
    const key = entity === "audit" ? "action" : "name";
    const value = tag + "-Alpha";
    const base = `/area-admin/areas/${ownArea.id}/${entity}`;
    const foreign =
      entity === "users"
        ? await user(value, foreignArea.id)
        : await store.create(
            "audit",
            { action: value, entity: "search-fixture", areaId: foreignArea.id },
            actor.id,
          );
    const result = await call(
      entity,
      base + "/by-" + key + "/" + encode(value),
      adminToken,
    );
    assert.equal(result.total, 1);
    assert.ok(result.data.every((row) => row.areaId === ownArea.id));
    const filtered = await call(
      entity,
      base + "?" + new URLSearchParams({ q: tag, id: foreign.id }),
      adminToken,
    );
    assert.equal(filtered.total, 0);
  }
  // Static name routes win over dynamic image/file/avatar/permissions routes.
  for (const name of ["image", "file", "url"]) {
    const resource = await store.create(
      "resources",
      { name, type: "FILE", areaId: ownArea.id },
      actor.id,
    );
    for (const prefix of ["/resources", "/admin/resources"])
      assert.ok(
        (await call("resources", prefix + "/by-name/" + name)).data.some(
          (row) => row.id === resource.id,
        ),
      );
    assert.ok(
      (
        await call(
          "resources",
          `/area-user/areas/${ownArea.id}/resources/by-name/` + name,
          normalToken,
        )
      ).data.some((row) => row.id === resource.id),
    );
  }
  const avatarUser = await user("avatar", ownArea.id);
  assert.ok(
    (await call("users", "/users/by-name/avatar")).data.some(
      (row) => row.id === avatarUser.id,
    ),
  );
  assert.ok(
    (await call("users", "/admin/users/by-name/avatar")).data.some(
      (row) => row.id === avatarUser.id,
    ),
  );
  await role("permissions");
  assert.equal((await call("roles", "/roles/by-name/permissions")).total, 1);
  console.log(
    `OK: ${checks} search HTTP checks covering filters, pagination, names, IDs and area isolation.`,
  );
  return checks;
};
