/**
 * `npm run test:linux` (ADR-0033 п. 6, R6) — `npm test` of the committed HEAD in Docker `node:22` with OpenSpec 1.13.1,
 * as the CI job on ubuntu; for a failure seen only on Linux (skill `git-land`, ci.md). Needs a running Docker engine;
 * without it — exit 2 and the WSL alternative. Plan — test-linux-lib.js; the bundle goes to a temp directory, removed
 * afterwards. Exit — that of `npm test` in the container.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { linuxTestPlan } from "./test-linux-lib.js";

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: "inherit", windowsHide: true, ...opts });

const sha = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).stdout.trim();
const engine = spawnSync("docker", ["info", "--format", "{{.OSType}}"], { encoding: "utf8", windowsHide: true });
if (engine.status !== 0 || !String(engine.stdout).includes("linux")) {
  // a clone in the WSL home, not the mounted work tree: a Linux `npm ci` would overwrite the Windows node_modules
  console.error("test:linux: Docker engine is not running (start Docker Desktop), or use WSL:");
  console.error(`  wsl -- bash -lc "rm -rf ~/warrant-linux && git clone -q /mnt/d/project/SRA ~/warrant-linux && cd ~/warrant-linux && git checkout -q ${sha} && npm ci && npm test"`);
  process.exit(2);
}
const dir = mkdtempSync(path.join(os.tmpdir(), "warrant-linux-"));
try {
  const plan = linuxTestPlan({ sha, bundleDir: dir.replace(/\\/g, "/") });
  const bundled = run("git", plan.bundle, { stdio: ["ignore", "ignore", "inherit"] });
  if (bundled.status !== 0) process.exit(2);
  console.log(`test:linux: npm test of ${sha.slice(0, 7)} in ${plan.docker[4]}`);
  process.exitCode = run("docker", plan.docker).status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
