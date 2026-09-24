/**
 * Graft experiment (ADR-0026, ADR-0027, docs/process/graft.md): record one task group, aggregate all records.
 *
 *   node scripts/dev/graft-metrics.js run --change <c> --group <n> [--part <k>] [--find <text>] [--agent <jsonl>]
 *        [--mode on|baseline] [--red-runs <n>] [--helped yes|partly|no] [--misled none|<text>] [--notes <text>]
 *   node scripts/dev/graft-metrics.js rescore
 *   node scripts/dev/graft-metrics.js report
 *
 * `run` finds the subagent transcript by `--agent`, or by `--find` (substring of the Agent description; default
 * `<change> group <n>`) under every `~/.claude/projects/D--project-SRA*` directory; the arm comes from the blind label
 * at the end of the description (`[A]` — graft, `[B]` — control), `--mode on` for an unlabelled run after adoption (ADR-0028: every group searches with cs), `--mode baseline` for an unlabelled historical
 * run. One group = one agent; a group that had to be split is recorded per subagent with `--part k` and summed by
 * `report`. The transcript is copied to `<git-common-dir>/graft-lab/transcripts/`, the record goes to
 * `<git-common-dir>/graft-lab/runs/<change>-g<n>[-p<k>].json` — shared by every worktree, never tracked.
 * `rescore` recomputes every record from its transcript copy with the current metrics (card kept). Whether a read
 * range covered a whole file (D-8) is judged by the read's own result, else against the file in git (`fileLinesAt`).
 * `report` prints the aggregate JSON and lists groups closed in tasks.md without a record (`missing`).
 * Exit: 0 ok; 1 — run: violations, report: verdict reject or missing groups; 2 usage / not found.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildReport, buildRun, closedGroups, findTranscripts, modeOf, parseTranscript } from "./graft-metrics-lib.js";

function fail(msg, code = 2) {
  process.stderr.write(`graft-metrics: ${msg}\n`);
  process.exit(code);
}

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) fail(`${a} needs a value`);
      out[a.slice(2)] = next;
      i++;
    } else out._.push(a);
  }
  return out;
}

function git(...a) {
  const r = spawnSync("git", a, { encoding: "utf8" });
  if (r.status !== 0) fail("not inside a git repository");
  return r.stdout.trim();
}

/**
 * D-8: line count of a file as the agent saw it — from git at the last commit before `at` (transcript start), or, for
 * a file the agent created, before `until` (its end; the group commit); the transcript's absolute path is mapped to
 * the repo by its longest suffix tracked there (the worktree may be gone); else from disk. null when unknown.
 */
function fileLinesAt(at, until) {
  const count = (text) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));
  const cache = new Map();
  let revs;
  return (p) => {
    const abs = String(p).replace(/\\/g, "/");
    if (cache.has(abs)) return cache.get(abs);
    if (revs === undefined) {
      revs = [at, until]
        .map((t) => (t ? spawnSync("git", ["rev-list", "-1", `--before=${t}`, "HEAD"], { encoding: "utf8" }).stdout?.trim() || null : null))
        .filter((r, i, all) => r && all.indexOf(r) === i)
        .map((rev) => ({ rev, tree: new Set(spawnSync("git", ["ls-tree", "-r", "--name-only", rev], { encoding: "utf8", maxBuffer: 64 << 20 }).stdout.split("\n")) }));
    }
    let n = null;
    const segs = abs.split("/");
    for (const { rev, tree } of revs) {
      const rel = segs.map((_, i) => segs.slice(i).join("/")).find((r) => tree.has(r));
      if (rel === undefined) continue;
      const r = spawnSync("git", ["show", `${rev}:${rel}`], { encoding: "utf8", maxBuffer: 64 << 20 });
      if (r.status === 0) n = count(r.stdout);
      break;
    }
    const native = abs.replace(/^\/([a-zA-Z])(?=\/)/, "$1:");
    if (n === null && existsSync(native)) n = count(readFileSync(native, "utf8"));
    cache.set(abs, n);
    return n;
  };
}

/** Transcript metrics; a read range is judged against the file as the agent saw it (D-8, `fileLinesAt`). */
function metricsOf(text) {
  const { start, end } = parseTranscript(text).window;
  return parseTranscript(text, { fileLines: fileLinesAt(start, end) });
}

const labDir = () => path.join(git("rev-parse", "--path-format=absolute", "--git-common-dir"), "graft-lab");

/** tasks.md of a change — active or archived (`archive/<date>-<change>`). */
function tasksOf(change) {
  const changes = path.join(git("rev-parse", "--show-toplevel"), "openspec", "changes");
  const active = path.join(changes, change, "tasks.md");
  if (existsSync(active)) return readFileSync(active, "utf8");
  const archive = path.join(changes, "archive");
  const hit = existsSync(archive) ? readdirSync(archive).find((d) => d.endsWith(`-${change}`)) : undefined;
  return hit && existsSync(path.join(archive, hit, "tasks.md")) ? readFileSync(path.join(archive, hit, "tasks.md"), "utf8") : null;
}

function readRecords() {
  const dir = path.join(labDir(), "runs");
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({ file: path.join(dir, f), record: JSON.parse(readFileSync(path.join(dir, f), "utf8")) }))
    : [];
}

function run(o) {
  if (!o.change || !o.group) fail("run needs --change and --group");
  const group = Number(o.group);
  if (!Number.isInteger(group) || group < 1) fail("--group must be a positive integer");
  const part = o.part === undefined ? null : Number(o.part);
  if (part !== null && (!Number.isInteger(part) || part < 1)) fail("--part must be a positive integer");
  let jsonl = o.agent;
  let meta = {};
  if (!jsonl) {
    const needle = o.find ?? `${o.change} group ${group}`;
    const hits = findTranscripts(needle);
    if (hits.length === 0) fail(`no subagent transcript matches "${needle}"`);
    if (hits.length > 1) fail(`several transcripts match — pass --agent (or --part per subagent):\n${hits.map((h) => `  ${h.jsonl}  (${h.meta.description})`).join("\n")}`);
    ({ jsonl, meta } = hits[0]);
  } else if (existsSync(jsonl.replace(/\.jsonl$/, ".meta.json"))) {
    meta = JSON.parse(readFileSync(jsonl.replace(/\.jsonl$/, ".meta.json"), "utf8"));
  }
  if (!existsSync(jsonl)) fail(`transcript not found: ${jsonl}`);

  const tagged = modeOf(meta.description);
  if (tagged && o.mode) fail(`--mode is only for unlabelled runs; the description is labelled (${tagged})`);
  const mode = tagged ?? (o.mode === "baseline" || o.mode === "on" ? o.mode : null);
  if (!mode) fail("arm unknown: the Agent description must end with [A] or [B], or pass --mode on (after ADR-0028) or --mode baseline (historical run)");

  const name = `${o.change}-g${group}${part === null ? "" : `-p${part}`}`;
  const copies = path.join(labDir(), "transcripts");
  mkdirSync(copies, { recursive: true });
  const copy = path.join(copies, `${name}.jsonl`);
  if (path.resolve(jsonl) !== path.resolve(copy)) copyFileSync(jsonl, copy);

  const record = buildRun({
    change: o.change,
    group,
    part,
    mode,
    agent: { id: path.basename(jsonl, ".jsonl"), description: meta.description ?? null, model: meta.model ?? null, source: jsonl, transcript: copy },
    metrics: metricsOf(readFileSync(copy, "utf8")),
    card: {
      red_runs: o["red-runs"] === undefined ? undefined : Number(o["red-runs"]),
      helped: o.helped,
      misled: o.misled,
      notes: o.notes,
    },
  });
  const dir = path.join(labDir(), "runs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ file, ...record }, null, 2)}\n`);
  process.exit(record.violations.length > 0 ? 1 : 0);
}

function rescore() {
  const copies = path.join(labDir(), "transcripts");
  mkdirSync(copies, { recursive: true });
  const out = [];
  for (const { file, record } of readRecords()) {
    const name = path.basename(file, ".json");
    const copy = path.join(copies, `${name}.jsonl`);
    const source = [record.agent.transcript, record.agent.source].find((p) => p && existsSync(p));
    if (!existsSync(copy)) {
      if (!source) {
        out.push({ record: name, error: "transcript lost" });
        continue;
      }
      copyFileSync(source, copy);
    }
    const next = buildRun({
      change: record.change,
      group: record.group,
      part: record.part ?? null,
      mode: record.mode,
      agent: { ...record.agent, source: record.agent.source ?? record.agent.transcript, transcript: copy },
      metrics: metricsOf(readFileSync(copy, "utf8")),
      card: record.card,
    });
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
    out.push({ record: name, mode: next.mode, deviations: next.deviations.length, compliant: next.compliant, explore_bytes: next.ingest.explore_bytes, whole_reads: next.whole_reads });
  }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

function report() {
  const runs = readRecords().map((r) => r.record);
  const missing = [];
  for (const change of new Set(runs.filter((r) => r.mode !== "baseline").map((r) => r.change))) {
    const tasks = tasksOf(change);
    if (tasks === null) continue;
    const recorded = new Set(runs.filter((r) => r.change === change).map((r) => r.group));
    for (const g of closedGroups(tasks)) if (!recorded.has(g)) missing.push(`${change}#${g}`);
  }
  const rep = buildReport(runs, { missing });
  process.stdout.write(`${JSON.stringify(rep, null, 2)}\n`);
  process.exit(rep.verdict === "reject" || missing.length > 0 ? 1 : 0);
}

const o = args(process.argv.slice(2));
if (o._[0] === "run") run(o);
else if (o._[0] === "rescore") rescore();
else if (o._[0] === "report") report();
else fail("usage: graft-metrics.js run --change <c> --group <n> [...] | rescore | report");
