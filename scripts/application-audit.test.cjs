// Fully offline: PostgreSQL WASM in memory; no sockets, Docker, .env or Neon.
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { PGlite } = require("../database/node_modules/@electric-sql/pglite");
const { drizzle } = require("../database/node_modules/drizzle-orm/pglite");
const {
  ApplicationOutbox,
  BrokerRpcExecutor,
  parseApplicationEvent,
} = require("../database/dist");
const {
  AuditRepository,
} = require("../audit-service/dist/audit/audit.repository");
const { AuditedPool, auditContext } = require("../database/dist/audit-context");
const { Pool } = require("../database/node_modules/pg");
let db;
let repository;
const user = "11111111-1111-4111-8111-111111111111";
const area = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const resource = "44444444-4444-4444-8444-444444444444";

before(async () => {
  db = new PGlite();
  for (const migration of [
    "0000_silky_mandroid",
    "0001_auth_sessions_outbox",
    "0002_resource_images",
    "0003_application_audit",
    "0004_broker_commands",
  ]) {
    await db.exec(
      readFileSync(
        join(__dirname, "../database/drizzle", `${migration}.sql`),
        "utf8",
      ),
    );
  }
  repository = Object.create(AuditRepository.prototype);
  repository.db = drizzle(db);
});
after(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(`TRUNCATE roles, permissions, areas, users, resources, audit_logs, user_sessions,
    refresh_tokens, auth_outbox, application_outbox, audit_event_receipts, broker_commands RESTART IDENTITY CASCADE;
    SELECT set_config('app.audit_context', '{}', false), set_config('app.audit_ingest', 'false', false);
    INSERT INTO roles (name) VALUES ('usuario normal');
    INSERT INTO areas (id, name) VALUES ('${area}', 'Area');
    INSERT INTO users (id, google_sub, email, name, role_id, area_id) VALUES ('${user}', 'private-google-sub', 'private@example.test', 'User', 1, '${area}');
    INSERT INTO resources (id, area_id, name, type, created_by_id) VALUES ('${resource}', '${area}', 'Resource', 'FILE', '${user}');
    TRUNCATE application_outbox;`);
  await db.query(`SELECT set_config('app.audit_context', $1, false)`, [
    JSON.stringify({
      source: "resources-service",
      requestId,
      userId: user,
      areaId: area,
    }),
  ]);
});

test("migration covers every domain table and emits canonical events without values", async () => {
  await db.exec(`
    INSERT INTO permissions (key, name, module) VALUES ('resources.edit', 'private-permission', 'Area');
    INSERT INTO role_permissions (role_id, permission_id) VALUES (1, 1);
    UPDATE roles SET is_active = false WHERE id = 1;
    UPDATE areas SET name = 'private-area' WHERE id = '${area}';
    UPDATE users SET avatar_s3_key = 'private-object-key' WHERE id = '${user}';
    UPDATE resources SET status = 'INACTIVE', s3_key = 'private-file-key', url = 'https://private.test/?token=private' WHERE id = '${resource}';
    INSERT INTO user_sessions (id, user_id) VALUES ('55555555-5555-4555-8555-555555555555', '${user}');
    INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ('${user}', 'private-token-hash', now() + interval '1 day');
    INSERT INTO audit_logs (action, entity, metadata) VALUES ('manual', 'resources', '{"secret":"private"}');
  `);
  const { rows } = await db.query(
    "SELECT payload, destination FROM application_outbox",
  );
  assert.equal(rows.length, 18);
  assert.equal(new Set(rows.map((row) => row.payload.entity)).size, 9);
  for (const row of rows) {
    const event = parseApplicationEvent(row.payload);
    assert.equal(event.userId, user);
    assert.equal(event.requestId, requestId);
    assert.equal(event.areaId, area);
  }
  assert.ok(!JSON.stringify(rows).includes("private"));
});

test("rollback removes both the write and its two broker events", async () => {
  await db.exec("BEGIN");
  await db.exec(
    `UPDATE resources SET status = 'ARCHIVED' WHERE id = '${resource}'`,
  );
  await db.exec("ROLLBACK");
  assert.equal(
    (await db.query("SELECT * FROM application_outbox")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("SELECT status FROM resources")).rows[0].status,
    "ACTIVE",
  );
});

test("full-row delete and cascading changes stay within the public event contract", async () => {
  await db.exec(`
    INSERT INTO permissions (key, name, module) VALUES ('read', 'Read', 'Area');
    INSERT INTO role_permissions (role_id, permission_id) VALUES (1, 1);
    INSERT INTO user_sessions (id, user_id) VALUES ('55555555-5555-4555-8555-555555555555', '${user}');
    INSERT INTO refresh_tokens (user_id, session_id, token_hash, expires_at)
      VALUES ('${user}', '55555555-5555-4555-8555-555555555555', 'private', now());
    DELETE FROM resources;
    DELETE FROM users;
    DELETE FROM areas;
    DELETE FROM roles;
    DELETE FROM permissions;
  `);
  const events = (
    await db.query("SELECT payload FROM application_outbox")
  ).rows.map((row) => parseApplicationEvent(row.payload));
  const deleted = new Set(
    events
      .filter((event) => event.action === "data.deleted")
      .map((event) => event.entity),
  );
  for (const entity of [
    "resources",
    "users",
    "areas",
    "roles",
    "permissions",
    "role_permissions",
    "user_sessions",
    "refresh_tokens",
  ])
    assert.ok(deleted.has(entity), entity);
  assert.ok(!JSON.stringify(events).includes("private"));
});

test("authentication consumer remains idempotent without creating recursive change events", async () => {
  const event = {
    eventId: "66666666-6666-4666-8666-666666666666",
    version: 1,
    source: "auth-service",
    action: "auth.login.succeeded",
    occurredAt: new Date().toISOString(),
    userId: user,
    sessionId: null,
    ipAddress: null,
    userAgent: null,
  };
  await repository.persist(event);
  await repository.persist(event);
  assert.equal((await db.query("SELECT * FROM audit_logs")).rows.length, 1);
  assert.equal(
    (await db.query("SELECT * FROM application_outbox")).rows.length,
    0,
  );
});

test("audit persistence failure prevents a domain write from committing", async () => {
  await db.exec(
    "BEGIN; ALTER TABLE application_outbox RENAME TO offline_outbox;",
  );
  await assert.rejects(
    db.exec(
      `UPDATE resources SET status = 'ARCHIVED' WHERE id = '${resource}'`,
    ),
  );
  await db.exec("ROLLBACK");
  assert.equal(
    (await db.query("SELECT status FROM resources")).rows[0].status,
    "ACTIVE",
  );
});

test("outbox retries only the failed broker, with leases and bounded backoff", async () => {
  await db.exec(`DELETE FROM resources WHERE id = '${resource}'`);
  const outbox = new ApplicationOutbox(db, "resources-service", () => {});
  const delivered = [];
  await outbox.deliver(async (destination, event) => {
    assert.equal(event.entityId, resource);
    if (destination === "kafka") throw new Error("offline");
    delivered.push(destination);
  });
  assert.deepEqual(delivered, ["rabbit"]);
  const { rows } = await db.query(
    "SELECT destination, attempts, published_at, locked_until, available_at > now() AS backed_off FROM application_outbox ORDER BY destination",
  );
  assert.equal(rows[0].attempts, 1);
  assert.equal(rows[0].published_at, null);
  assert.equal(rows[0].locked_until, null);
  assert.equal(rows[0].backed_off, true);
  assert.ok(rows[1].published_at);
  await db.exec("UPDATE application_outbox SET available_at = now()");
  await outbox.deliver(async (destination) => delivered.push(destination));
  assert.deepEqual(delivered, ["rabbit", "kafka"]);
});

test("active delivery leases cannot be stolen, expired leases are recovered", async () => {
  await db.exec(`DELETE FROM resources WHERE id = '${resource}';
    UPDATE application_outbox SET locked_until = now() + interval '1 minute', claimed_by = gen_random_uuid();`);
  const outbox = new ApplicationOutbox(db, "resources-service", () => {});
  let count = 0;
  await outbox.deliver(async () => {
    count++;
  });
  assert.equal(count, 0);
  await db.exec(
    `UPDATE application_outbox SET locked_until = now() - interval '1 minute'`,
  );
  await outbox.deliver(async () => {
    count++;
  });
  assert.equal(count, 2);
});

async function resourceEvent() {
  await db.exec(
    `UPDATE resources SET status = 'ARCHIVED' WHERE id = '${resource}'`,
  );
  return parseApplicationEvent(
    (await db.query("SELECT payload FROM application_outbox LIMIT 1")).rows[0]
      .payload,
  );
}

test("consumer commits an area-scoped log exactly once and avoids audit recursion", async () => {
  const event = await resourceEvent();
  await repository.persistApplication(event);
  await repository.persistApplication(event);
  const { rows } = await db.query("SELECT * FROM audit_logs");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].area_id, area);
  assert.equal(rows[0].user_id, user);
  assert.equal(rows[0].metadata.requestId, requestId);
  assert.equal(
    (await db.query("SELECT * FROM application_outbox")).rows.length,
    2,
  );
});

test("conflicting event IDs cannot overwrite a persisted record", async () => {
  const event = await resourceEvent();
  await repository.persistApplication(event);
  await assert.rejects(
    repository.persistApplication({ ...event, action: "data.deleted" }),
    /different content/,
  );
  assert.equal(
    (await db.query("SELECT action FROM audit_logs")).rows[0].action,
    "data.updated",
  );
});

test("user deletion of audit records is recorded; redelivery does not recreate them", async () => {
  const event = await resourceEvent();
  await repository.persistApplication(event);
  await db.query("DELETE FROM audit_logs WHERE id = $1", [event.eventId]);
  await repository.persistApplication(event);
  assert.equal((await db.query("SELECT * FROM audit_logs")).rows.length, 0);
  const changes = (
    await db.query(
      `SELECT payload FROM application_outbox WHERE payload->>'entity' = 'audit_logs'`,
    )
  ).rows;
  assert.equal(changes.length, 2);
  assert.equal(changes[0].payload.action, "data.deleted");
});

test("delayed audit survives deletion of its actor and area", async () => {
  const event = await resourceEvent();
  await db.exec(`DELETE FROM resources; DELETE FROM users; DELETE FROM areas;`);
  await repository.persistApplication(event);
  const stored = (await db.query("SELECT * FROM audit_logs")).rows[0];
  assert.equal(stored.user_id, null);
  assert.equal(stored.area_id, null);
  assert.equal(stored.metadata.originalUserId, user);
  assert.equal(stored.metadata.originalAreaId, area);
});

test("consumer storage failure rolls back its deduplication receipt too", async () => {
  const event = await resourceEvent();
  await db.exec(
    `ALTER TABLE audit_logs ADD CONSTRAINT test_reject CHECK (action <> 'data.updated')`,
  );
  try {
    await assert.rejects(repository.persistApplication(event));
    assert.equal(
      (await db.query("SELECT * FROM audit_event_receipts")).rows.length,
      0,
    );
  } finally {
    await db.exec("ALTER TABLE audit_logs DROP CONSTRAINT test_reject");
  }
  await repository.persistApplication(event);
  assert.equal(
    (await db.query("SELECT * FROM audit_event_receipts")).rows.length,
    1,
  );
});

test("pooled connections replace earlier actor context for promise and callback callers", async () => {
  const original = Pool.prototype.connect;
  const contexts = [];
  const client = {
    query: async (_, values) => contexts.push(JSON.parse(values[0])),
    release() {},
  };
  Pool.prototype.connect = async () => client;
  const pool = new AuditedPool();
  try {
    await auditContext.run(
      {
        source: "users-service",
        requestId,
        actor: () => ({ userId: user, areaId: area }),
      },
      () => pool.connect(),
    );
    await new Promise((resolve, reject) =>
      pool.connect((error) => (error ? reject(error) : resolve())),
    );
    assert.equal(contexts[0].userId, user);
    assert.deepEqual(contexts[1], {});
  } finally {
    Pool.prototype.connect = original;
    await pool.end();
  }
});

test("concurrent broker redelivery reserves a mutation only once across transports", async () => {
  let executions = 0;
  const dispatcher = new BrokerRpcExecutor(
    db,
    "users",
    "http://127.0.0.1:3005",
    1000,
    async () => {
      executions++;
      return new Response(JSON.stringify({ id: user }), {
        status: 201,
        headers: {
          "content-type": "application/json",
          "x-request-id": requestId,
        },
      });
    },
  );
  const command = {
    version: 1,
    requestId,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    method: "POST",
    path: "/users",
    accessToken: "private-token",
    body: { name: "private-name" },
  };
  const replies = await Promise.all([
    dispatcher.execute(command),
    dispatcher.execute(command),
  ]);
  assert.deepEqual(replies.map((r) => r.statusCode).sort(), [201, 409]);
  assert.equal(executions, 1);
  const rows = (await db.query("SELECT * FROM broker_commands")).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "completed");
  assert.equal(rows[0].audit_request_id, requestId);
  assert.ok(!JSON.stringify(rows).includes("private"));
});

test("uncertain broker commands remain fenced when the client retries", async () => {
  const dispatcher = new BrokerRpcExecutor(
    db,
    "users",
    "http://127.0.0.1:3005",
    1000,
    async () => {
      throw new Error("timeout");
    },
  );
  const command = {
    version: 1,
    requestId,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    method: "DELETE",
    path: "/users/" + user,
    accessToken: "private",
  };
  assert.equal((await dispatcher.execute(command)).statusCode, 504);
  assert.equal((await dispatcher.execute(command)).statusCode, 409);
  assert.equal(
    (await db.query("SELECT state FROM broker_commands")).rows[0].state,
    "uncertain",
  );
});
