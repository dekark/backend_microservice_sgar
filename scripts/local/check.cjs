// Readiness checks only: no migrations, seeding or synthetic authentication events.
async function main() {
  const response = await fetch("http://localhost:3000/health/ready", {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      "Auth no esta listo; revisa la conexion compartida, las migraciones y los brokers.",
    );
  const status = await response.json();
  if (
    !status.components?.database ||
    !status.components?.kafka ||
    !status.components?.rabbitmq
  ) {
    throw new Error("Hay dependencias de auth-service no disponibles.");
  }
  console.log(
    "OK: auth-service, base compartida, Kafka y RabbitMQ disponibles.",
  );

  const services = [
    { name: "roles-service", url: "http://roles:3001/" },
    { name: "permissions-service", url: "http://permissions:3002/" },
    { name: "resources-service", url: "http://resources:3003/" },
    { name: "areas-service", url: "http://areas:3004/" },
    { name: "users-service", url: "http://users:3005/" },
    { name: "audit-service", url: "http://audit:3006/" },
  ];

  for (const s of services) {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        console.log(`OK: ${s.name} disponible.`);
      } else {
        console.warn(`WARN: ${s.name} respondió con status ${res.status}.`);
      }
    } catch (e) {
      console.warn(`WARN: no se pudo verificar ${s.name} (${e.message}).`);
    }
  }
}
main().catch(() => {
  console.error(
    "No se pudo verificar auth-service. Revisa /health/ready y los logs.",
  );
  process.exitCode = 1;
});
