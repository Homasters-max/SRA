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
  process.stderr.write(`build: local typescript not found, using npx typescript@${range}\n`);
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  result = spawnSync(npx, ["--yes", "-p", `typescript@${range}`, "tsc", "-p", project, ...extra], {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
}
process.exit(result.status ?? 1);
