/**
 * Scenario coverage of a Change (ADR-0033 п. 6, R4) — a step of the skill `review-impl`:
 *
 *   node scripts/dev/scn-coverage.js <change>   delta specs of openspec/changes/<change>/specs (or its archive folder)
 *   node scripts/dev/scn-coverage.js --main     main specs openspec/specs
 *
 * Tests — every `*.ts` under packages/cli/test. Prints `SCN coverage: covered/total` and the missing ids; exit 0 — all
 * covered (a Change without delta specs — 0/0), 1 — some missing, 2 — no such Change. Logic — scn-coverage-lib.js.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { coverage } from "./scn-coverage-lib.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function files(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(p, ext);
    return e.name.endsWith(ext) ? [p] : [];
  });
}

/** Specs directory of the argument, or null when there is no such Change. */
function specsDir(arg) {
  if (arg === "--main") return path.join(ROOT, "openspec", "specs");
  const active = path.join(ROOT, "openspec", "changes", arg);
  if (existsSync(active)) return path.join(active, "specs");
  const archive = path.join(ROOT, "openspec", "changes", "archive");
  const done = existsSync(archive) ? readdirSync(archive).find((d) => d.replace(/^\d{4}-\d{2}-\d{2}-/, "") === arg) : undefined;
  return done ? path.join(archive, done, "specs") : null;
}

const arg = process.argv[2];
const dir = arg ? specsDir(arg) : null;
if (!dir) {
  console.error(`usage: node scripts/dev/scn-coverage.js <change> | --main  (no Change ${arg ?? "—"})`);
  process.exit(2);
}
const read = (f) => readFileSync(f, "utf8");
const result = coverage(files(dir, ".md").map(read), files(path.join(ROOT, "packages", "cli", "test"), ".ts").map(read));
console.log(`SCN coverage (${arg}): ${result.covered}/${result.total}`);
for (const id of result.missing) console.log(`  missing: ${id}`);
process.exit(result.missing.length === 0 ? 0 : 1);
