/**
 * Test-suite measurement for test-levels §10 (I-118): time and child processes
 * per test file.
 *
 *   node scripts/dev/test-measure.js [vitest args…]      e.g. --project e2e
 *
 * Runs `vitest run` over the built CLI (run `npm run build` first) with the
 * preload `spawn-count.cjs` in NODE_OPTIONS and WARRANT_SPAWN_LOG set, so every
 * process started inside a test file — including `openspec` and `git` started by
 * `warrant` — is counted for that file. Prints totals, per-level sums and a
 * Markdown table sorted by time. Nothing is written into the repository.
 * Exit: the exit code of vitest.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "warrant-measure-"));
const report = path.join(tmp, "report.json");
const log = path.join(tmp, "spawn.log");
const preload = path.join(ROOT, "scripts", "dev", "spawn-count.cjs").split(path.sep).join("/");

const started = Date.now();
const run = spawnSync(
  process.execPath,
  [
    path.join(ROOT, "node_modules", "vitest", "vitest.mjs"),
    "run",
    "--config",
    "packages/cli/vitest.config.ts",
    "--reporter=json",
    `--outputFile=${report}`,
    ...process.argv.slice(2)
  ],
  {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, WARRANT_SPAWN_LOG: log, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${preload}`.trim() }
  }
);
const wall = (Date.now() - started) / 1000;

const spawns = new Map();
if (existsSync(log)) {
  for (const line of readFileSync(log, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const key = JSON.parse(line).tag ?? "(runner)";
    spawns.set(key, (spawns.get(key) ?? 0) + 1);
  }
}

const json = JSON.parse(readFileSync(report, "utf8"));
const rows = json.testResults
  .map((file) => {
    const rel = file.name.split(path.sep).join("/").replace(/.*packages\/cli\//, "");
    return {
      file: rel,
      level: rel.split("/")[1],
      tests: file.assertionResults.length,
      failed: file.assertionResults.filter((a) => a.status === "failed").length,
      sec: (file.endTime - file.startTime) / 1000,
      spawns: spawns.get(rel) ?? 0
    };
  })
  .sort((a, b) => b.sec - a.sec);

const levels = {};
for (const r of rows) {
  const l = (levels[r.level] ??= { files: 0, tests: 0, sec: 0, spawns: 0 });
  l.files += 1;
  l.tests += r.tests;
  l.sec = Math.round((l.sec + r.sec) * 10) / 10;
  l.spawns += r.spawns;
}
console.log(
  JSON.stringify(
    {
      exit: run.status,
      wall_s: wall,
      tests: json.numTotalTests,
      failed: json.numFailedTests,
      spawns: rows.reduce((s, r) => s + r.spawns, 0),
      levels
    },
    null,
    2
  )
);
console.log("\n| File | Tests | s | Processes |\n|---|---|---|---|");
for (const r of rows) console.log(`| ${r.file.replace(/^test\//, "")} | ${r.tests} | ${r.sec.toFixed(1)} | ${r.spawns} |`);

rmSync(tmp, { recursive: true, force: true });
process.exit(run.status ?? 1);
