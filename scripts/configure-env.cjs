const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (file) =>
  fs.existsSync(file) ? parseEnv(fs.readFileSync(file, "utf8")) : {};
const setup = spawnSync(
  process.execPath,
  [path.join(__dirname, "auth-local.cjs"), "configure"],
  {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  },
);
if (setup.status !== 0) process.exit(setup.status || 1);

const local = read(path.join(root, ".env.auth-local"));
const loopback = (hostname) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
function localRabbit(value) {
  if (!value) return true;
  try {
    return loopback(new URL(value).hostname);
  } catch {
    return false;
  }
}
function localKafka(value) {
  return (
    !value ||
    value.split(",").every((broker) => {
      try {
        return loopback(new URL("http://" + broker.trim()).hostname);
      } catch {
        return false;
      }
    })
  );
}
for (const name of [
  "auth",
  "audit",
  "roles",
  "permissions",
  "resources",
  "areas",
  "users",
]) {
  const file = path.join(root, name + "-service/.env");
  const existing = read(file);
  const values = { ...read(file + ".example"), ...existing };
  // DATABASE_URL stays exclusively in database/.env.
  delete values.DATABASE_URL;
  if (name === "auth") {
    values.JWT_SECRET = existing.JWT_SECRET || local.LOCAL_JWT_SECRET;
    const client = existing.GOOGLE_CLIENT_ID || local.GOOGLE_CLIENT_ID;
    if (client) values.GOOGLE_CLIENT_ID = client;
    else delete values.GOOGLE_CLIENT_ID;
    values.AUTH_GOOGLE_ENABLED = client ? "true" : "false";
    const role = existing.AUTH_DEFAULT_ROLE_ID || local.AUTH_DEFAULT_ROLE_ID;
    if (role) values.AUTH_DEFAULT_ROLE_ID = role;
  }
  if (name !== "auth") {
    values.AUTH_SERVICE_URL =
      existing.AUTH_SERVICE_URL || "http://localhost:" + local.AUTH_HTTP_PORT;
  }
  // Use the existing local broker credentials without copying them into examples.
  const rabbit = new URL("amqp://localhost");
  rabbit.username = "auth_local";
  rabbit.password = local.LOCAL_RABBIT_PASSWORD;
  rabbit.port = local.RABBIT_AMQP_PORT;
  // All host-run services share the same local brokers; preserve cloud endpoints.
  values.RABBITMQ_URL = localRabbit(existing.RABBITMQ_URL)
    ? rabbit.toString()
    : existing.RABBITMQ_URL;
  const brokers = existing.KAFKA_BROKERS || existing.KAFKA_BROKER;
  if (localKafka(brokers)) {
    values.KAFKA_BROKER = "localhost:" + local.KAFKA_HOST_PORT;
    delete values.KAFKA_BROKERS;
  } else {
    values.KAFKA_BROKER = existing.KAFKA_BROKER || brokers;
  }

  for (const [key, value] of Object.entries(values)) {
    if (!value.trim()) delete values[key];
    else if (/[\r\n']/.test(value)) {
      console.error(
        name +
        ": valor incompatible con el formato .env; revisa el archivo (valores ocultos).",
      );
      process.exit(1);
    }
  }
  const contents =
    "# Private local configuration. DATABASE_URL is loaded from ../database/.env.\n" +
    Object.entries(values)
      .map(([key, value]) => `${key}='${value}'`)
      .join("\n") +
    "\n";
  fs.writeFileSync(file, contents, { mode: 0o600 });
  console.log(name + "-service/.env: configurado; credenciales ocultas.");
}
if (!read(path.join(root, "auth-service/.env")).GOOGLE_CLIENT_ID) {
  console.log(
    "Pendiente: GOOGLE_CLIENT_ID real. Google login permanece deshabilitado.",
  );
}
