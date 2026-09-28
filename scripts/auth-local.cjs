const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { parseEnv } = require("node:util");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.auth-local");
const command = process.argv[2] || "up";
const validCommands = new Set([
  "up",
  "down",
  "logs",
  "status",
  "check",
  "configure",
  "brokers",
]);
if (!validCommands.has(command)) {
  console.error("Use up, down, logs, status, check, configure or brokers");
  process.exit(1);
}

function readEnv(file) {
  return fs.existsSync(file) ? parseEnv(fs.readFileSync(file, "utf8")) : {};
}
const values = readEnv(envPath);
if (["up", "configure", "brokers"].includes(command)) {
  const original = readEnv(path.join(root, "auth-service/.env"));
  const defaults = {
    ...(original.GOOGLE_CLIENT_ID
      ? { GOOGLE_CLIENT_ID: original.GOOGLE_CLIENT_ID }
      : {}),
    ...(original.AUTH_DEFAULT_ROLE_ID
      ? { AUTH_DEFAULT_ROLE_ID: original.AUTH_DEFAULT_ROLE_ID }
      : {}),
    LOCAL_JWT_SECRET: randomBytes(32).toString("hex"),
    LOCAL_RABBIT_PASSWORD: randomBytes(24).toString("hex"),
    AUTH_HTTP_PORT: "3000",
    ROLES_HTTP_PORT: "3001",
    PERMISSIONS_HTTP_PORT: "3002",
    RESOURCES_HTTP_PORT: "3003",
    AREAS_HTTP_PORT: "3004",
    USERS_HTTP_PORT: "3005",
    AUDIT_HTTP_PORT: "3006",
    RABBIT_HTTP_PORT: "15673",
    RABBIT_AMQP_PORT: "5673",
    KAFKA_HOST_PORT: "19092",
    FRONTEND_ORIGIN: original.FRONTEND_ORIGIN || "http://localhost:4200",
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!values[key]) values[key] = value;
  }
  // Missing optional values stay absent instead of becoming empty assignments.
  for (const [key, value] of Object.entries(values)) {
    if (!value.trim()) delete values[key];
  }
  // Never invent a Google identity or bypass token verification.
  values.AUTH_GOOGLE_ENABLED = values.GOOGLE_CLIENT_ID ? "true" : "false";
  if (Object.values(values).some((value) => /[\r\n']/.test(value))) {
    throw new Error(
      "Local environment values cannot contain single quotes or newlines",
    );
  }
  const contents =
    "# Private local configuration; generated values are preserved on subsequent starts.\n" +
    Object.entries(values)
      .map(([key, value]) => `${key}='${value}'`)
      .join("\n") +
    "\n";
  fs.writeFileSync(envPath, contents, { mode: 0o600 });
  console.log("Local configuration ready: .env.auth-local");
  if (!values.GOOGLE_CLIENT_ID)
    console.log(
      "Google login is disabled until GOOGLE_CLIENT_ID is configured in .env.auth-local.",
    );
}
if (command === "configure") process.exit(0);
if (!fs.existsSync(envPath)) {
  console.error("Run npm run auth:local first.");
  process.exit(1);
}

const compose = [
  "compose",
  "--project-name",
  "backend-auth-local",
  "--project-directory",
  root,
  "--env-file",
  envPath,
  "-f",
  path.join(root, "docker-compose.yml"),
];
if (command !== "brokers") compose.push("--profile", "auth");
// Isolate this stack from unrelated variables in the caller's terminal.
const childEnv = { ...process.env };
for (const key of Object.keys(values)) delete childEnv[key];
function docker(args) {
  const result = spawnSync("docker", args, {
    cwd: root,
    env: childEnv,
    stdio: "inherit",
  });
  if (result.error) {
    console.error("Docker is unavailable. Install/start Docker Desktop.");
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}
if (command === "brokers") {
  docker([
    ...compose,
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "240",
    "kafka",
    "rabbitmq",
  ]);
  console.log(
    "Shared local brokers ready; Nest services use database/.env for PostgreSQL.",
  );
} else if (command === "up") {
  try {
    const database = readEnv(path.join(root, "database/.env"));
    if (
      !database.DATABASE_URL ||
      !["postgres:", "postgresql:"].includes(
        new URL(database.DATABASE_URL).protocol,
      )
    ) {
      throw new Error("Invalid shared connection");
    }
  } catch {
    console.error(
      "Configura DATABASE_URL con una URL PostgreSQL valida en database/.env.",
    );
    process.exit(1);
  }
  const daemon = spawnSync("docker", ["info"], { cwd: root, stdio: "ignore" });
  if (daemon.status !== 0) docker(["desktop", "start"]);
  docker([
    ...compose,
    "up",
    "--detach",
    "--build",
    "--remove-orphans",
    "--wait",
    "--wait-timeout",
    "240",
  ]);
  docker([
    ...compose,
    "exec",
    "-T",
    "auth",
    "node",
    "../scripts/local/check.cjs",
  ]);
  console.log(
    `Auth ready: http://localhost:${values.AUTH_HTTP_PORT}/health/ready`,
  );
  console.log(`Roles ready: http://localhost:${values.ROLES_HTTP_PORT || "3001"}`);
  console.log(`Permissions ready: http://localhost:${values.PERMISSIONS_HTTP_PORT || "3002"}`);
  console.log(`Resources ready: http://localhost:${values.RESOURCES_HTTP_PORT || "3003"}`);
  console.log(`Areas ready: http://localhost:${values.AREAS_HTTP_PORT || "3004"}`);
  console.log(`Users ready: http://localhost:${values.USERS_HTTP_PORT || "3005"}`);
  console.log(`Audit ready: http://localhost:${values.AUDIT_HTTP_PORT || "3006"}`);
  console.log(
    `RabbitMQ UI: http://localhost:${values.RABBIT_HTTP_PORT} (user auth_local; password in .env.auth-local)`,
  );
} else if (command === "check") {
  docker([
    ...compose,
    "exec",
    "-T",
    "auth",
    "node",
    "../scripts/local/check.cjs",
  ]);
} else if (command === "down") {
  docker([...compose, "down"]); // Persistent volumes are intentionally retained.
} else if (command === "logs") {
  docker([...compose, "logs", "--follow", "--tail", "100"]);
} else {
  docker([...compose, "ps"]);
}
