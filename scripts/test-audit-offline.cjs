const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");
const root = resolve(__dirname, "..");
// Invoke local Node entry points, never Docker or a .env-configured database.
for (const [cwd, script, args] of [
  [
    "database",
    "node_modules/typescript/bin/tsc",
    ["-p", "tsconfig.build.json"],
  ],
  ["audit-service", "node_modules/@nestjs/cli/bin/nest.js", ["build"]],
]) {
  const result = spawnSync(
    process.execPath,
    [resolve(root, cwd, script), ...args],
    {
      cwd: resolve(root, cwd),
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
const result = spawnSync(
  process.execPath,
  ["--test", resolve(__dirname, "application-audit.test.cjs")],
  {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  },
);
process.exit(result.status || (result.error ? 1 : 0));
