// Runs only against a disposable, explicitly named local PostgreSQL database.
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const { randomUUID, randomBytes } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const root = path.resolve(__dirname, "..");
const databaseRequire = createRequire(path.join(root, "database/package.json"));
const { createTransactionalDatabase, CrudStore } = databaseRequire("./dist");
const { migrate } = databaseRequire("drizzle-orm/node-postgres/migrator");

async function main() {
  const url = new URL(process.env.CRUD_TEST_DATABASE_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/crud_test");
  const { db, pool } = createTransactionalDatabase(url.toString());
  const apps = [];
  let checks = 0;
  let imageStorage;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await pool.query("SELECT 1");
        ready = true;
        break;
      } catch {
        await delay(500);
      }
    }
    assert.ok(ready, "Disposable PostgreSQL did not start");
    await migrate(db, {
      migrationsFolder: path.join(root, "database/drizzle"),
    });
    const store = new CrudStore(pool);
    const fixtureRole = await store.create(
      "roles",
      { name: "superadministrador" },
      randomUUID(),
    );
    const fixtureUser = await store.create(
      "users",
      {
        googleSub: "test-fixture-subject",
        email: "fixture@example.com",
        name: "Authenticated fixture",
        roleId: fixtureRole.id,
      },
      randomUUID(),
    );
    const sessionId = randomUUID();
    await pool.query(
      "INSERT INTO user_sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [sessionId, fixtureUser.id],
    );

    process.env.DATABASE_URL = url.toString();
    process.env.JWT_SECRET = randomBytes(32).toString("hex");
    process.env.JWT_ISSUER = "crud-integration";
    process.env.JWT_AUDIENCE = "crud-integration";
    process.env.AUTH_GOOGLE_ENABLED = "false";
    process.env.AUTH_BACKGROUND_JOBS_ENABLED = "false";
    process.env.APPLICATION_EVENTS_ENABLED = "false";
    process.env.FRONTEND_ORIGIN = "http://localhost:4200";
    imageStorage = await require("./test-images.cjs").startStorage();
    process.env.S3_ENDPOINT = imageStorage.endpoint;
    process.env.S3_MEDIA_BUCKET = "media-test";
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ACCESS_KEY_ID = "local-image-test";
    process.env.AWS_SECRET_ACCESS_KEY = "local-image-test-only";
    delete process.env.AWS_SESSION_TOKEN;
    delete process.env.PORT;

    const rpcExecutors = new Map();
    async function start(name) {
      const requireService = createRequire(
        path.join(root, name + "-service/package.json"),
      );
      const { NestFactory } = requireService("@nestjs/core");
      const { AppModule } = requireService("./dist/app.module");
      const app = await NestFactory.create(AppModule, {
        logger: false,
        abortOnError: false,
      });
      apps.push(app);
      await app.listen(0, "127.0.0.1");
      // Offline transport adapter: exercise the same authenticated HTTP pipeline
      // without connecting these database integration tests to live brokers.
      const { BrokerRpcExecutor } = databaseRequire("./dist");
      const { BrokerGateway } = requireService(
        "./dist/messaging/broker-client.module",
      );
      rpcExecutors.set(
        name,
        new BrokerRpcExecutor(pool, name, await app.getUrl()),
      );
      app.get(BrokerGateway).send = (target, command) =>
        rpcExecutors.get(target).execute(command);
      return { base: await app.getUrl(), requireService };
    }
    const auth = await start("auth");
    process.env.AUTH_SERVICE_URL = auth.base;
    const { JwtService } = auth.requireService("@nestjs/jwt");
    const token = new JwtService({ secret: process.env.JWT_SECRET }).sign(
      { sub: fixtureUser.id, sid: sessionId, token_use: "access" },
      {
        algorithm: "HS256",
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
        expiresIn: 900,
      },
    );
    const services = {};
    for (const name of [
      "roles",
      "permissions",
      "areas",
      "users",
      "resources",
      "audit",
    ])
      services[name] = await start(name);
    if (process.env.CRUD_TEST_ONLY_IMAGES === "true") {
      await store.create("roles", { name: "usuario normal" }, fixtureUser.id);
      await store.create("roles", { name: "administrador" }, fixtureUser.id);
      await require("./test-images.cjs").testImages({
        store,
        pool,
        services,
        auth,
        superToken: token,
        storage: imageStorage,
      });
      return;
    }
    if (process.env.CRUD_TEST_ONLY_SEARCH === "true") {
      await require("./test-search.cjs")({
        store,
        pool,
        services,
        auth,
        superToken: token,
      });
      return;
    }
    async function call(
      name,
      method,
      suffix,
      body,
      status,
      bearer = token,
      prefix = "/admin/",
    ) {
      // Respect auth-service's 120 requests/minute during session introspection.
      if (bearer) await delay(550);
      const response = await fetch(
        services[name].base + prefix + name + suffix,
        {
          method,
          headers: {
            ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(10000),
        },
      );
      const result =
        response.status === 204 ? undefined : await response.json();
      assert.equal(
        response.status,
        status,
        name + " " + method + " " + suffix + ": " + JSON.stringify(result),
      );
      checks++;
      return result;
    }
    for (const name of Object.keys(services)) {
      for (const [method, suffix, body] of [
        ["GET", "", undefined],
        ["GET", "/1", undefined],
        ["POST", "", {}],
        ["PATCH", "/1", {}],
        ["DELETE", "/1", undefined],
      ]) {
        await call(name, method, suffix, body, 401, null);
      }
      await call(name, "GET", "", undefined, 401, "invalid-token");
      await call(name, "GET", "", undefined, 401, null, "/");
      if (["roles", "permissions", "areas", "users"].includes(name)) {
        for (const action of ["activate", "deactivate"]) {
          await call(name, "PATCH", "/1/" + action, undefined, 401, null);
        }
      }
    }
    // The same valid JWT must lose access as soon as the database role changes.
    await store.update("roles", String(fixtureRole.id), {
      name: "ordinary-user",
    });
    for (const name of Object.keys(services)) {
      for (const [method, suffix, body] of [
        ["GET", "", undefined],
        ["GET", "/1", undefined],
        ["POST", "", { role: "superadministrador" }],
        ["PATCH", "/1", { role: "superadministrador" }],
        ["DELETE", "/1", undefined],
      ]) {
        await call(name, method, suffix, body, 403);
      }
      await call(name, "GET", "?role=superadministrador", undefined, 403);
      await call(name, "GET", "", undefined, 403, token, "/");
      if (["roles", "permissions", "areas", "users"].includes(name)) {
        for (const action of ["activate", "deactivate"]) {
          await call(name, "PATCH", "/1/" + action, undefined, 403);
        }
      }
    }
    await call("users", "GET", "/me", undefined, 403);
    await call("roles", "GET", "/1/permissions", undefined, 403);
    await call("roles", "PUT", "/1/permissions", { permissionIds: [] }, 403);
    // Session introspection must remain available so every service can authenticate.
    const ordinaryProfile = await fetch(auth.base + "/auth/me", {
      headers: { Authorization: "Bearer " + token },
    });
    assert.equal(ordinaryProfile.status, 200);
    await store.update("roles", String(fixtureRole.id), {
      name: "superadministrador",
    });
    for (const name of Object.keys(services)) {
      await call(name, "GET", "", undefined, 200, token, "/");
    }
    const role = await call("roles", "POST", "", { name: "crud-role" }, 201);
    const permission = await call(
      "permissions",
      "POST",
      "",
      { key: "users.read", name: "Read users", module: "users" },
      201,
    );
    const area = await call("areas", "POST", "", { name: "Engineering" }, 201);
    const user = await call(
      "users",
      "POST",
      "",
      {
        googleSub: "crud-user-subject",
        email: "User@Example.com",
        name: "CRUD user",
        roleId: role.id,
        areaId: area.id,
      },
      201,
    );
    assert.equal(user.email, "user@example.com");
    assert.equal(user.googleSub, undefined);
    const resource = await call(
      "resources",
      "POST",
      "",
      { areaId: area.id, name: "Document", type: "DOCUMENT", fileSize: 0 },
      201,
    );
    assert.equal(resource.createdById, fixtureUser.id);
    assert.equal(resource.fileSize, 0);
    const audit = await call(
      "audit",
      "POST",
      "",
      {
        action: "manual.note",
        entity: "resources",
        entityId: resource.id,
        metadata: { note: "created manually" },
      },
      201,
    );
    assert.equal(audit.userId, fixtureUser.id);
    const records = {
      roles: role,
      permissions: permission,
      areas: area,
      users: user,
      resources: resource,
      audit,
    };
    for (const [name, record] of Object.entries(records)) {
      assert.equal(
        (await call(name, "GET", "/" + record.id, undefined, 200)).id,
        record.id,
      );
      const list = await call(name, "GET", "?page=1&limit=1", undefined, 200);
      assert.equal(list.limit, 1);
      assert.ok(list.total >= 1);
      assert.equal(list.data.length, 1);
      const field = name === "audit" ? "action" : "name";
      assert.equal(
        (
          await call(
            name,
            "PATCH",
            "/" + record.id,
            { [field]: "updated-" + name },
            200,
          )
        )[field],
        "updated-" + name,
      );
      await call(name, "PATCH", "/" + record.id, { id: randomUUID() }, 400);
      await call(name, "PATCH", "/" + record.id, {}, 400);
      await call(name, "GET", "/invalid", undefined, 400);
      await call(
        name,
        "GET",
        "/" +
          (["roles", "permissions"].includes(name)
            ? "2147483647"
            : randomUUID()),
        undefined,
        404,
      );
    }
    const profile = await call("users", "GET", "/me", undefined, 200);
    for (const name of ["roles", "permissions", "areas", "users"]) {
      const id = records[name].id;
      const disabled = await call(
        name,
        "PATCH",
        "/" + id + "/deactivate",
        undefined,
        200,
      );
      assert.equal(disabled.isActive, false);
      assert.equal(
        (await call(name, "GET", "/" + id, undefined, 200)).isActive,
        false,
      );
      // Original routes inherit the same actions and guards as /admin routes.
      const enabled = await call(
        name,
        "PATCH",
        "/" + id + "/activate",
        undefined,
        200,
        token,
        "/",
      );
      assert.equal(enabled.isActive, true);
      assert.equal(
        (await call(name, "PATCH", "/" + id + "/activate", undefined, 200))
          .isActive,
        true,
      );
      await call(name, "PATCH", "/invalid/deactivate", undefined, 400);
      const missing = ["roles", "permissions"].includes(name)
        ? "2147483647"
        : randomUUID();
      await call(name, "PATCH", "/" + missing + "/activate", undefined, 404);
    }
    for (const name of ["resources", "audit"]) {
      for (const action of ["activate", "deactivate"]) {
        await call(
          name,
          "PATCH",
          "/" + records[name].id + "/" + action,
          undefined,
          404,
        );
      }
      await call(
        name,
        "PATCH",
        "/" + records[name].id,
        { isActive: false },
        400,
      );
    }
    assert.equal(profile.role, "superadministrador");
    assert.deepEqual(profile.permissions, []);
    await call("roles", "POST", "", { name: "updated-roles" }, 409);
    await call(
      "users",
      "POST",
      "",
      {
        googleSub: "other-subject",
        email: "user@example.com",
        name: "Duplicate",
        roleId: role.id,
      },
      409,
    );
    await call(
      "roles",
      "POST",
      "",
      { name: "Robert'); DROP TABLE roles;--" },
      201,
    );
    await call("roles", "GET", "?limit=101", undefined, 400);
    await call("roles", "GET", "?page=0", undefined, 400);
    await call(
      "roles",
      "POST",
      "",
      { name: "Bad boolean", isActive: "true" },
      400,
    );
    await call(
      "resources",
      "POST",
      "",
      { areaId: area.id, name: "Bad type", type: "UNKNOWN" },
      400,
    );
    await call(
      "resources",
      "PATCH",
      "/" + resource.id,
      { createdById: user.id },
      400,
    );
    await call(
      "users",
      "PATCH",
      "/" + user.id,
      { googleSub: "replaced-identity" },
      400,
    );
    await call("users", "PATCH", "/" + user.id, { roleId: 2147483647 }, 409);
    await call("roles", "DELETE", "/" + role.id, undefined, 409);
    await call("areas", "DELETE", "/" + area.id, undefined, 409);

    assert.equal(
      (
        await call(
          "roles",
          "PUT",
          "/" + role.id + "/permissions",
          { permissionIds: [permission.id, permission.id] },
          200,
        )
      ).length,
      1,
    );
    await call(
      "roles",
      "PUT",
      "/" + role.id + "/permissions",
      { permissionIds: [2147483647] },
      409,
    );
    assert.equal(
      (
        await call(
          "roles",
          "GET",
          "/" + role.id + "/permissions",
          undefined,
          200,
        )
      )[0].id,
      permission.id,
    );
    await call(
      "roles",
      "PUT",
      "/" + role.id + "/permissions",
      { permissionIds: [] },
      200,
    );
    assert.deepEqual(
      await call(
        "roles",
        "GET",
        "/" + role.id + "/permissions",
        undefined,
        200,
      ),
      [],
    );

    await pool.query(
      "UPDATE audit_logs SET metadata = metadata || $1::jsonb WHERE id = $2",
      [
        JSON.stringify({ eventHash: "original-delivery-fingerprint" }),
        audit.id,
      ],
    );
    await call(
      "audit",
      "PATCH",
      "/" + audit.id,
      { metadata: { eventHash: "forged" } },
      400,
    );
    const changedAudit = await call(
      "audit",
      "PATCH",
      "/" + audit.id,
      { metadata: { note: "updated manually" } },
      200,
    );
    assert.equal(
      changedAudit.metadata.eventHash,
      "original-delivery-fingerprint",
    );
    assert.equal(changedAudit.metadata.note, "updated manually");

    checks += await require("./test-area-access.cjs")({
      store,
      pool,
      services,
      auth,
      superToken: token,
    });

    checks += await require("./test-area-user.cjs")({
      store,
      pool,
      services,
      auth,
      superToken: token,
    });

    checks += await require("./test-images.cjs").testImages({
      store,
      pool,
      services,
      auth,
      superToken: token,
      storage: imageStorage,
    });

    checks += await require("./test-search.cjs")({
      store,
      pool,
      services,
      auth,
      superToken: token,
    });

    await pool.query(
      "UPDATE user_sessions SET is_active = false WHERE id = $1",
      [sessionId],
    );
    await call("roles", "GET", "", undefined, 401);
    await pool.query(
      "UPDATE user_sessions SET is_active = true WHERE id = $1",
      [sessionId],
    );
    await pool.query("UPDATE users SET is_active = false WHERE id = $1", [
      fixtureUser.id,
    ]);
    await call("roles", "GET", "", undefined, 403);
    await pool.query("UPDATE users SET is_active = true WHERE id = $1", [
      fixtureUser.id,
    ]);
    for (const name of [
      "audit",
      "resources",
      "users",
      "areas",
      "permissions",
      "roles",
    ]) {
      await call(name, "DELETE", "/" + records[name].id, undefined, 204);
      await call(name, "GET", "/" + records[name].id, undefined, 404);
    }
    console.log(
      "OK: " +
        checks +
        " HTTP checks with real PostgreSQL, JWT validation, sessions and six CRUD services.",
    );
  } finally {
    for (const app of apps.reverse()) await app.close();
    await pool.end();
    await imageStorage?.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
