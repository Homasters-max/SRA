/**
 * Аудит графа кода (решение D-2; ADR-0028 п. 4 — обновление Graft не ухудшает эти метрики): граф Graft
 * (`graft/.graph/wiring.json`) против истины из TypeScript checker — узлы, рёбра вызовов и импорта, полнота
 * `cs callers -d 1`, классы мест вызова (диспетчеризация через порт, одноимённые функции в разных файлах, вызов через
 * нетипизированный или цепочечный приёмник), ложные рёбра, строка сниппета — не вызов.
 *
 *   node scripts/dev/graph-audit.js [--json] [--baseline <файл>] [--write-baseline [<файл>]] [--root <каталог>]
 *   node scripts/dev/graph-audit.js callers <файл>#<Имя.метод> [--refs] [--root <каталог>]
 *
 * Без подкоманды: обновляет индекс (`node scripts/dev/cs.js map`), строит истину по файлам `packages/`, `scripts/`,
 * которые видит git, включая неотслеживаемые (их индексирует и Graft), с опциями `packages/cli/tsconfig.json` +
 * JavaScript, сравнивает и печатает таблицу метрик; `--json` — всё JSON-ом.
 * `--baseline` — сравнить с базой: метрика хуже базы больше допуска (`tolerance` в файле базы: доля −0.5 п. п.,
 * счётчик +2) — выход 1. `--write-baseline` — записать базу (по умолчанию `scripts/dev/bench/graph-baseline.json`)
 * с версией Graft и коммитом. База снята на своём коммите: на другом коммите метрики сдвигает и сам код.
 * `callers` — истинные вызывающие символа (или члена интерфейса порта `<файл>#<Интерфейс>.<метод>`) для ответов
 * бенчмарка `scripts/dev/bench/code-search.json`: объемлющая именованная функция или `(file)`; граф не нужен.
 * `--root` — другое дерево (временный worktree на коммите базы или вопроса; в нём нужен node_modules — npm ci или
 * junction); `typescript` и `cs.js` — из этого репозитория. Проверка обновления Graft: `git worktree add --detach
 * <каталог> <commit из базы>`, node_modules, `node scripts/dev/graph-audit.js --root <каталог> --baseline
 * scripts/dev/bench/graph-baseline.json` — тот же код, другая версия Graft.
 * Выход: 0 — ок; 1 — хуже базы; 2 — использование; 3 — окружение (индекс не построен, нет typescript).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AUDIT_FORMAT, auditCompilerOptions, auditFiles, buildGroundTruth, checkBaseline, compareWithGraph, formatReport, makeBaseline, truthCallers } from "./graph-audit-lib.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = path.resolve(HERE, "..", "..");
const DEFAULT_BASELINE = path.join(TOOL_ROOT, "scripts", "dev", "bench", "graph-baseline.json");

function fail(msg, code = 2) {
  process.stderr.write(`graph-audit: ${msg}\n`);
  process.exit(code);
}

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) fail(`git ${args.join(" ")}: ${r.stderr.trim()}`, 3);
  return r.stdout.trim();
}

function loadTypescript() {
  try {
    return createRequire(path.join(TOOL_ROOT, "package.json"))("typescript");
  } catch {
    return fail("typescript не найден — npm ci", 3);
  }
}

function groundTruth(root) {
  // without node_modules in the tree the types of vitest & co. do not resolve, and calls through them are lost
  if (!existsSync(path.join(root, "node_modules"))) fail(`в ${root} нет node_modules — npm ci (или junction на node_modules этого репозитория)`, 3);
  const ts = loadTypescript();
  const files = auditFiles(git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "packages", "scripts"]).split(/\r?\n/));
  return buildGroundTruth(ts, { root, files, options: auditCompilerOptions(ts, root) });
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json" || a === "--refs") o[a.slice(2)] = true;
    else if (a === "--baseline" || a === "--root") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) fail(`${a} требует значение`);
      o[a.slice(2)] = argv[++i];
    } else if (a === "--write-baseline") o.writeBaseline = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : DEFAULT_BASELINE;
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a.startsWith("--")) fail(`неизвестный флаг ${a}`);
    else o._.push(a);
  }
  return o;
}

function callers(o) {
  const target = o._[1];
  if (!target || !target.includes("#")) fail("callers <файл>#<Имя> — например packages/cli/src/core/evidence/store.ts#readRecords");
  const root = path.resolve(o.root ?? git(process.cwd(), ["rev-parse", "--show-toplevel"]));
  const gt = groundTruth(root);
  const known = gt.nodes.some((n) => n.id === target) || gt.calls.some((c) => c.targets.some((t) => t.member === target));
  if (!known) fail(`${target}: нет такого узла или члена интерфейса с вызовами`);
  const rows = truthCallers(gt, target, { refs: !!o.refs });
  process.stdout.write(`${JSON.stringify({ root, commit: git(root, ["rev-parse", "--short", "HEAD"]), target, callers: rows }, null, 2)}\n`);
}

function audit(o) {
  const root = path.resolve(o.root ?? git(process.cwd(), ["rev-parse", "--show-toplevel"]));
  const map = spawnSync(process.execPath, [path.join(TOOL_ROOT, "scripts", "dev", "cs.js"), "map"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (map.status !== 0) fail(`cs map: код ${map.status}: ${(map.stderr || map.stdout).trim()}`, 3);
  const wiringPath = path.join(root, "graft", ".graph", "wiring.json");
  if (!existsSync(wiringPath)) fail(`${wiringPath} нет после cs map`, 3);
  const wiring = JSON.parse(readFileSync(wiringPath, "utf8"));
  const version = spawnSync(process.execPath, [path.join(TOOL_ROOT, "scripts", "dev", "cs.js"), "version"], { cwd: root, encoding: "utf8" });
  const graft = /graft (\S+)/.exec(version.stdout ?? "")?.[1] ?? null;
  const commit = git(root, ["rev-parse", "--short", "HEAD"]);
  const dirty = git(root, ["status", "--porcelain", "--", "packages", "scripts"]) !== "";

  const gt = groundTruth(root);
  const cache = new Map();
  const readLines = (p) => {
    if (!cache.has(p)) cache.set(p, readFileSync(path.join(root, p), "utf8").split(/\r?\n/));
    return cache.get(p);
  };
  const result = compareWithGraph(wiring, gt, { readLines });

  const baseline = o.baseline ? JSON.parse(readFileSync(path.resolve(o.baseline), "utf8")) : null;
  const regressions = baseline ? checkBaseline(result.metrics, baseline) : [];
  if (o.json) {
    process.stdout.write(`${JSON.stringify({ format: AUDIT_FORMAT, graft, commit, dirty, ...result, baseline: baseline ? { commit: baseline.commit, graft: baseline.graft, regressions } : null }, null, 2)}\n`);
  } else {
    process.stdout.write(`graph audit: graft ${graft ?? "?"}, commit ${commit}${dirty ? " (+ правки в packages/ scripts/)" : ""}, files ${gt.files.length}, truth call sites ${gt.calls.length}\n`);
    if (baseline) {
      process.stdout.write(`baseline: graft ${baseline.graft}, commit ${baseline.commit}${baseline.commit !== commit || dirty ? " — код не тот же (коммит или правки): метрики сдвигает и он, сравнивать на коммите базы (--root)" : ""}\n`);
    }
    process.stdout.write(`\n${formatReport(result, { baseline, regressions })}\n`);
    process.stdout.write(`\nfalse call edges:\n${result.examples.falseEdges.map((x) => `  ${x}`).join("\n") || "  —"}\n`);
    if (baseline) process.stdout.write(regressions.length ? `\nХУЖЕ БАЗЫ: ${regressions.map((r) => r.metric).join(", ")}\n` : "\nне хуже базы\n");
  }
  if (o.writeBaseline) {
    const file = path.resolve(o.writeBaseline);
    writeFileSync(file, `${JSON.stringify(makeBaseline(result.metrics, { graft, commit }), null, 2)}\n`);
    process.stderr.write(`graph-audit: база записана в ${file}\n`);
  }
  process.exit(regressions.length ? 1 : 0);
}

const o = parseArgs(process.argv.slice(2));
if (o.help) {
  process.stdout.write("usage: graph-audit.js [--json] [--baseline <file>] [--write-baseline [<file>]] [--root <dir>] | callers <file>#<Name> [--refs] [--root <dir>]\n");
} else if (o._[0] === "callers") callers(o);
else if (o._.length === 0) audit(o);
else fail(`неизвестная подкоманда ${o._[0]}`);
