// Manual client. This script connects to brokers only when explicitly executed.
require("../auth-service/node_modules/reflect-metadata");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { parseEnv } = require("node:util");
const {
  ConfigService,
} = require("../auth-service/node_modules/@nestjs/config");
const {
  BrokerGateway,
} = require("../auth-service/dist/messaging/broker-client.module");
const { RPC_SERVICES } = require("../database/dist");
const [transport, service, file] = process.argv.slice(2);
if (
  !["rabbit", "kafka"].includes(transport) ||
  !RPC_SERVICES.includes(service) ||
  !file
) {
  console.error(
    "Uso: npm run rpc:call -- rabbit|kafka auth|roles|permissions|resources|areas|users|audit comando.json",
  );
  process.exit(1);
}
async function main() {
  const envFile = path.join(__dirname, "../auth-service/.env");
  const env = fs.existsSync(envFile)
    ? parseEnv(fs.readFileSync(envFile, "utf8"))
    : {};
  const gateway = new BrokerGateway(
    new ConfigService({ ...env, ...process.env }),
  );
  try {
    const input = JSON.parse(
      fs.readFileSync(path.resolve(file), "utf8").replace(/^\uFEFF/, ""),
    );
    const result = await gateway.send(
      service,
      {
        version: 1,
        requestId: randomUUID(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        ...input,
      },
      transport,
    );
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.ok) process.exitCode = 1;
  } finally {
    await gateway.onModuleDestroy();
  }
}
main().catch(() => {
  console.error(
    "No se pudo completar el comando RPC; revisa el archivo, los brokers y el servicio de destino.",
  );
  process.exitCode = 1;
});
