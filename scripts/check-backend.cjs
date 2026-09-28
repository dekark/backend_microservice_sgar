const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const services = [
  "auth",
  "roles",
  "permissions",
  "resources",
  "areas",
  "users",
  "audit",
].map((name) => name + "-service");
const mode = process.argv[2] || "check";
if (!["build", "test", "check"].includes(mode)) {
  console.error("Usage: node scripts/check-backend.cjs [build|test|check]");
  process.exit(1);
}

function run(project, entry, args) {
  console.log("\n[" + project + "] " + entry + " " + args.join(" "));
  const result = spawnSync(
    process.execPath,
    [resolve(root, project, entry), ...args],
    {
      cwd: resolve(root, project),
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, NODE_ENV: "test" },
    },
  );
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}

// All services consume the compiled local database package.
run("database", "node_modules/typescript/bin/tsc", [
  "-p",
  "tsconfig.build.json",
]);
for (const service of services) {
  // The offline audit suite also imports compiled audit-service providers.
  if (mode !== "test" || service === "audit-service") {
    run(service, "node_modules/@nestjs/cli/bin/nest.js", ["build"]);
  }
  if (mode !== "build") {
    run(service, "node_modules/jest/bin/jest.js", ["--runInBand"]);
    run(service, "node_modules/jest/bin/jest.js", [
      "--config",
      "test/jest-e2e.json",
      "--runInBand",
    ]);
  }
}
if (mode !== "build") {
  run(".", "scripts/application-audit.test.cjs", []);
}
console.log("\nBackend " + mode + " completed successfully.");
