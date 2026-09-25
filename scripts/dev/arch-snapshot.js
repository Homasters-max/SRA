/**
 * Снимок архитектуры для навыка `architecture-audit` (`.claude/skills/architecture-audit/SKILL.md`): модули с
 * Ca / Ce / нестабильностью и сцепленностью, циклы, одноимённые определения, вертикальные срезы входов с вызовами
 * через порты — из ответов `cs` (`--json`), без собственного разбора кода. Вызовы имени, определённого ещё и в другом
 * файле индекса (тест, скрипт), граф теряет (аудит 2026-09-25 §3.3) — срез досчитывается через `cs grep` и срез
 * определения (`completeCallers`), досчитанные имена — в `recovered` среза. Сравнение со снимком прошлого аудита — тренд.
 *
 *   node scripts/dev/arch-snapshot.js [--dir packages/cli/src] [--level 2] [--entries runA,runB] [--ports git,openspec,checks,clock]
 *                                     [--out <файл.json>] [--against <файл.json>] [--json]
 *
 * `--entries` — входы срезов; по умолчанию все `export (async) function run<X>` в `<dir>/commands`. `--out` — записать
 * снимок (`docs/process/audits/<дата>.json`); `--against` — напечатать разницу с прежним снимком; `--json` — снимок
 * (и разницу) JSON-ом в stdout.
 * Выход: 0 — ок; 2 — использование; 3 — `cs` вернул код 2 или 3 (окружение).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_PORTS, bareCallPattern, bareCallsBySymbol, blindNames, buildSlice, buildSnapshot, completeCallers, diffSnapshots, formatDiff, formatSnapshot, portCallsBySymbol, portPattern } from "./arch-snapshot-lib.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CS = path.join(HERE, "cs.js");

function fail(msg, code = 2) {
  process.stderr.write(`arch-snapshot: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const o = { dir: "packages/cli/src", level: 2, entries: undefined, ports: DEFAULT_PORTS, out: undefined, against: undefined, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) fail(`${a} needs a value`);
      return v;
    };
    if (a === "--dir") o.dir = value().replace(/\\/g, "/").replace(/\/$/, "");
    else if (a === "--level") o.level = Number(value());
    else if (a === "--entries") o.entries = value().split(",").filter(Boolean);
    else if (a === "--ports") o.ports = value().split(",").filter(Boolean);
    else if (a === "--out") o.out = value();
    else if (a === "--against") o.against = value();
    else if (a === "--json") o.json = true;
    else fail(`unknown argument ${a}`);
  }
  if (!Number.isInteger(o.level) || o.level < 1) fail("--level must be a positive integer");
  return o;
}

/** One `cs` call with `--json`; code 1 (graft "not found") → null. */
function cs(args) {
  const r = spawnSync(process.execPath, [CS, ...args, "--json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 << 20 });
  if (r.status === 1) return null;
  if (r.status !== 0) fail(`cs ${args.join(" ")} exited ${r.status}: ${(r.stderr || r.stdout).trim()}`, 3);
  return JSON.parse(r.stdout);
}

function defaultEntries(dir) {
  const grep = cs(["grep", "export (async )?function run[A-Z]", "--in", `${dir}/commands`]);
  if (grep === null) fail(`no run<X> entry points in ${dir}/commands; pass --entries`);
  return [...new Set(grep.groups.map((g) => g.symbol?.name).filter(Boolean))].sort();
}

const o = parseArgs(process.argv.slice(2));
if (!existsSync(path.join(ROOT, o.dir))) fail(`--dir ${o.dir} does not exist`);
const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();

const deps = cs(["deps", o.dir, "--level", String(o.level)]);
const cycles = cs(["deps", o.dir, "--level", String(o.level), "--cycles"]);
const runtimeCycles = cs(["deps", o.dir, "--level", String(o.level), "--cycles", "--runtime"]);
const dups = cs(["dups", "--in", o.dir, "--min", "3"]) ?? { dups: [] };
const portGrep = cs(["grep", portPattern(o.ports), "--in", o.dir]) ?? { groups: [] };
const portCalls = portCallsBySymbol(portGrep, o.ports);
// `--in`: the entry resolves to its definition in `dir`, not to a same-named test helper
const outSlice = (name, dir) => cs(["callers", name, "--direction", "out", "-d", "all", "--in", dir]);
const blind = blindNames(cs(["dups", "--min", "2"]) ?? { dups: [] }, o.dir);
const blindCalls = blind.size === 0 ? new Map() : bareCallsBySymbol(cs(["grep", bareCallPattern([...blind.keys()]), "--in", o.dir]) ?? { groups: [] }, [...blind.keys()]);
const memo = (fn) => {
  const cache = new Map();
  return (key) => {
    if (!cache.has(key)) cache.set(key, fn(key));
    return cache.get(key);
  };
};
const completion = {
  defOf: blind,
  importsOf: memo((file) => new Set((cs(["deps", file])?.imports ?? []).map((i) => i.path))),
  sliceOf: memo((name) => outSlice(name, blind.get(name))),
};
const slices = (o.entries ?? defaultEntries(o.dir)).map((entry) => {
  const answer = outSlice(entry, o.dir);
  if (answer === null) return { entry, found: false };
  const { callers, recovered } = completeCallers(answer, blindCalls, completion);
  return buildSlice(callers, { dir: o.dir, level: o.level, portCalls, recovered });
});

const snapshot = buildSnapshot({ commit: head, dir: o.dir, level: o.level, deps, cycles, runtimeCycles, dups, slices });
if (o.out !== undefined) writeFileSync(path.resolve(o.out), `${JSON.stringify(snapshot, null, 2)}\n`);

let diff;
if (o.against !== undefined) {
  const before = JSON.parse(readFileSync(path.resolve(o.against), "utf8"));
  diff = diffSnapshots(before, snapshot);
  if (!o.json) process.stdout.write(`${formatDiff(diff, { from: before.commit, to: snapshot.commit })}\n\n`);
}
process.stdout.write(o.json ? `${JSON.stringify(diff === undefined ? snapshot : { snapshot, diff }, null, 2)}\n` : `${formatSnapshot(snapshot)}\n`);
