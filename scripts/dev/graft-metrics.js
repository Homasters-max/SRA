/**
 * Graft experiment (ADR-0026, docs/process/graft.md): record one task group,
 * aggregate all records.
 *
 *   node scripts/dev/graft-metrics.js run --change <c> --group <n> [--find <text>] [--agent <jsonl>]
 *        [--mode on|off|baseline] [--red-runs <n>] [--helped yes|partly|no] [--misled none|<text>] [--notes <text>]
 *   node scripts/dev/graft-metrics.js report
 *
 * `run` finds the subagent transcript by `--agent`, or by `--find` (substring of
 * the Agent description; default `<change> group <n>`) under every
 * `~/.claude/projects/D--project-SRA*` directory; ON / OFF mode comes from the
 * `[graft:on|off]` tag of the description, `--mode` only for `baseline` or a
 * check. Records go to `<git-common-dir>/graft-lab/runs/<change>-g<n>.json` —
 * shared by every worktree, never tracked. `report` prints the aggregate JSON.
 * Exit: 0 ok, 1 violations or verdict reject, 2 usage / not found.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildReport, buildRun, modeOf, parseTranscript } from "./graft-metrics-lib.js";

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

function labDir() {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
  if (r.status !== 0) fail("not inside a git repository");
  return path.join(r.stdout.trim(), "graft-lab");
}

function findTranscripts(text) {
  const root = path.join(os.homedir(), ".claude", "projects");
  const hits = [];
  if (!existsSync(root)) return hits;
  const needle = text.toLowerCase();
  for (const project of readdirSync(root)) {
    if (!project.startsWith("D--project-SRA")) continue;
    for (const session of readdirSync(path.join(root, project))) {
      const dir = path.join(root, project, session, "subagents");
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".meta.json")) continue;
        const meta = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
        if (!String(meta.description ?? "").toLowerCase().includes(needle)) continue;
        hits.push({ jsonl: path.join(dir, f.replace(/\.meta\.json$/, ".jsonl")), meta });
      }
    }
  }
  return hits;
}

function run(o) {
  if (!o.change || !o.group) fail("run needs --change and --group");
  const group = Number(o.group);
  if (!Number.isInteger(group) || group < 1) fail("--group must be a positive integer");
  let jsonl = o.agent;
  let meta = {};
  if (!jsonl) {
    const hits = findTranscripts(o.find ?? `${o.change} group ${group}`);
    if (hits.length === 0) fail(`no subagent transcript matches "${o.find ?? `${o.change} group ${group}`}"`);
    if (hits.length > 1) fail(`several transcripts match — pass --agent:\n${hits.map((h) => `  ${h.jsonl}  (${h.meta.description})`).join("\n")}`);
    ({ jsonl, meta } = hits[0]);
  } else if (existsSync(jsonl.replace(/\.jsonl$/, ".meta.json"))) {
    meta = JSON.parse(readFileSync(jsonl.replace(/\.jsonl$/, ".meta.json"), "utf8"));
  }
  if (!existsSync(jsonl)) fail(`transcript not found: ${jsonl}`);

  const tagged = modeOf(meta.description);
  const mode = o.mode ?? tagged;
  if (!["on", "off", "baseline"].includes(mode ?? "")) fail("mode unknown: tag the Agent description [graft:on|off] or pass --mode baseline");
  if (tagged && o.mode && o.mode !== tagged) fail(`--mode ${o.mode} contradicts description tag [graft:${tagged}]`);

  const metrics = parseTranscript(readFileSync(jsonl, "utf8"));
  const record = buildRun({
    change: o.change,
    group,
    mode,
    agent: { id: path.basename(jsonl, ".jsonl"), description: meta.description ?? null, model: meta.model ?? null, transcript: jsonl },
    metrics,
    card: {
      red_runs: o["red-runs"] === undefined ? undefined : Number(o["red-runs"]),
      helped: o.helped,
      misled: o.misled,
      notes: o.notes,
    },
  });
  const dir = path.join(labDir(), "runs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${o.change}-g${group}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ file, ...record }, null, 2)}\n`);
  process.exit(record.violations.length > 0 ? 1 : 0);
}

function report() {
  const dir = path.join(labDir(), "runs");
  const runs = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")))
    : [];
  const rep = buildReport(runs);
  process.stdout.write(`${JSON.stringify(rep, null, 2)}\n`);
  process.exit(rep.verdict === "reject" ? 1 : 0);
}

const o = args(process.argv.slice(2));
if (o._[0] === "run") run(o);
else if (o._[0] === "report") report();
else fail("usage: graft-metrics.js run --change <c> --group <n> [...] | report");
