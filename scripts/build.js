#!/usr/bin/env node
/**
 * Builds packages/cli with the locally installed TypeScript.
 *
 * Why not just `tsc` in package.json: `npm i -g <git-url>` prepares the clone
 * with an inner `npm install` that inherits `npm_config_global` and therefore
 * does not put devDependencies into the clone (npm/cli#4243). When the local
 * compiler is missing we fall back to `npx -p typescript@<range>`, which
 * fetches the pinned major on the fly. Local development always has it.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const project = path.join(root, "packages", "cli", "tsconfig.json");
const extra = process.argv.slice(2); // e.g. --noEmit

let result;
try {
  const tsc = require.resolve("typescript/bin/tsc", { paths: [root] });
  result = spawnSync(process.execPath, [tsc, "-p", project, ...extra], { stdio: "inherit" });
} catch {
  const range = require(path.join(root, "package.json")).devDependencies.typescript;
  process.stderr.write(`build: local typescript not found, installing typescript@${range} into the clone\n`);
  // The inherited npm_config_* (global, prefix, force, ...) is exactly what
  // broke the inner install; a nested npm must not see any of it.
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^npm_config_/i.test(key)) env[key] = value;
  }
  const win = process.platform === "win32";
  // Quoted so that cmd.exe does not eat the caret in "^5.8.3".
  const spec = win ? `"typescript@${range}"` : `typescript@${range}`;
  const install = spawnSync(win ? "npm.cmd" : "npm", ["install", "--no-save", "--no-audit", "--no-fund", spec], {
    cwd: root,
    stdio: "inherit",
    env,
    shell: win
  });
  if (install.status !== 0) process.exit(install.status ?? 1);
  const tsc = require.resolve("typescript/bin/tsc", { paths: [root] });
  result = spawnSync(process.execPath, [tsc, "-p", project, ...extra], { stdio: "inherit" });
}
process.exit(result.status ?? 1);
