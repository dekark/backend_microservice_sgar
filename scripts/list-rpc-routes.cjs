// Read compiled controller metadata, including inherited methods. Never starts Nest.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
require("../auth-service/node_modules/reflect-metadata");
const {
  RequestMethod,
} = require("../auth-service/node_modules/@nestjs/common");
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? files(file)
      : file.endsWith(".controller.js")
        ? [file]
        : [];
  });
}
const catalog = [];
for (const service of [
  "auth",
  "roles",
  "permissions",
  "resources",
  "areas",
  "users",
  "audit",
]) {
  const routes = [];
  for (const file of files(path.join(root, `${service}-service/dist`))) {
    for (const type of Object.values(require(file))) {
      if (typeof type !== "function" || !Reflect.hasMetadata("path", type))
        continue;
      const prefixes = [Reflect.getMetadata("path", type)].flat();
      const seen = new Set();
      for (
        let prototype = type.prototype;
        prototype && prototype !== Object.prototype;
        prototype = Object.getPrototypeOf(prototype)
      ) {
        for (const name of Object.getOwnPropertyNames(prototype)) {
          if (seen.has(name)) continue;
          seen.add(name);
          const method = Object.getOwnPropertyDescriptor(
            prototype,
            name,
          )?.value;
          if (
            typeof method !== "function" ||
            !Reflect.hasMetadata("method", method)
          )
            continue;
          for (const prefix of prefixes) {
            for (const suffix of [
              Reflect.getMetadata("path", method) ?? "/",
            ].flat()) {
              const route =
                ("/" + prefix + "/" + suffix)
                  .replace(/\/+/g, "/")
                  .replace(/\/$/, "") || "/";
              routes.push({
                method: RequestMethod[Reflect.getMetadata("method", method)],
                path: route,
                controller: type.name,
                handler: name,
              });
            }
          }
        }
      }
    }
  }
  catalog.push({
    service,
    rabbitQueue: `${service}_rpc`,
    pattern: `${service}.rpc.v1`,
    routes: routes.sort(
      (a, b) =>
        a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
    ),
  });
}
fs.writeFileSync(
  path.join(root, "RPC-ROUTES.json"),
  JSON.stringify(catalog, null, 2) + "\n",
);
console.log(
  `RPC-ROUTES.json: ${catalog.reduce((sum, service) => sum + service.routes.length, 0)} rutas de ${catalog.length} servicios.`,
);
