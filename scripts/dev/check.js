/**
 * Fast checks of the repository in one run — `sync --check`, `validate`, `fmt --check`, `versions:check`:
 *
 *   node scripts/dev/check.js             build the CLI, run the checks, print one line per check
 *   node scripts/dev/check.js --no-build  the same over the existing build (packages/cli/dist)
 *
 * Not a substitute for `npm test` (the gate `tests-passed` and CI run the full suite). Logic — check-lib.js. Exit 0 —
 * all passed; 1 — a check failed; 2 — the build failed.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkSteps, formatReport, summarizeStep } from "./check-lib.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const run = (argv) =>
  spawnSync(process.execPath, argv, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });

if (!process.argv.includes("--no-build")) {
  const build = run(["scripts/build.js"]);
  if (build.status !== 0) {
    process.stderr.write(`check: build failed\n${build.stdout}${build.stderr}`);
    process.exit(2);
  }
}

const results = checkSteps("packages/cli/dist/bin/warrant.js").map((step) => {
  const r = run(step.argv);
  return summarizeStep(step.id, r.status ?? 1, r.stdout ?? "", r.stderr ?? r.error?.message ?? "");
});
process.stdout.write(formatReport(results));
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
