/**
 * Code-search benchmark (ADR-0027, docs/process/graft.md §6): score one answered question, aggregate all.
 *
 *   node scripts/dev/bench-score.js run --q <id> [--agent <jsonl>]
 *   node scripts/dev/bench-score.js report
 *
 * Questions and truth — `scripts/dev/bench/code-search.json`. `run` finds the transcripts of the subagents whose
 * Agent description is exactly `bench <id> [A]` and `bench <id> [B]` (or one `--agent`), takes the answer from the
 * last JSON array of the agent's last message, scores it against the truth and writes
 * `<git-common-dir>/graft-lab/bench/<id>-<arm>.json` (transcript copied next to it). `report` — paired verdict.
 * Exit: 0 ok; 1 — report: verdict reject or insufficient; 2 usage / not found.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BENCH_RESULT_FORMAT, buildBenchReport, extractAnswer, findTranscripts, modeOf, parseTranscript, scoreAnswer } from "./graft-metrics-lib.js";

const BENCH = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "bench", "code-search.json"), "utf8"));

function fail(msg, code = 2) {
  process.stderr.write(`bench-score: ${msg}\n`);
  process.exit(code);
}

function labDir() {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
  if (r.status !== 0) fail("not inside a git repository");
  return path.join(r.stdout.trim(), "graft-lab", "bench");
}

function score(question, jsonl, meta) {
  const arm = modeOf(meta.description) === "on" ? "A" : modeOf(meta.description) === "off" ? "B" : null;
  if (!arm) fail(`${jsonl}: description "${meta.description}" has no [A] / [B] label`);
  const dir = labDir();
  mkdirSync(dir, { recursive: true });
  const copy = path.join(dir, `${question.id}-${arm}.jsonl`);
  if (path.resolve(jsonl) !== path.resolve(copy)) copyFileSync(jsonl, copy);
  const text = readFileSync(copy, "utf8");
  const answer = extractAnswer(text);
  const metrics = parseTranscript(text);
  const result = {
    format: BENCH_RESULT_FORMAT,
    question: question.id,
    base: question.base,
    arm,
    agent: { id: path.basename(jsonl, ".jsonl"), description: meta.description, model: meta.model ?? null, source: jsonl, transcript: copy },
    answer,
    score: scoreAnswer(question, answer),
    ...metrics,
  };
  writeFileSync(path.join(dir, `${question.id}-${arm}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function run(o) {
  const question = BENCH.questions.find((q) => q.id === o.q);
  if (!question) fail(`unknown question ${o.q ?? "(none)"}; known: ${BENCH.questions.map((q) => q.id).join(", ")}`);
  const hits = o.agent
    ? [{ jsonl: o.agent, meta: JSON.parse(readFileSync(o.agent.replace(/\.jsonl$/, ".meta.json"), "utf8")) }]
    : ["A", "B"].flatMap((arm) => {
        const h = findTranscripts(`bench ${question.id} [${arm}]`, { exact: true });
        if (h.length > 1) fail(`several transcripts for "bench ${question.id} [${arm}]" — pass --agent:\n${h.map((x) => `  ${x.jsonl}`).join("\n")}`);
        return h;
      });
  if (hits.length === 0) fail(`no transcript for question ${question.id}`);
  const out = hits.map((h) => score(question, h.jsonl, h.meta));
  process.stdout.write(
    `${JSON.stringify(
      out.map((r) => ({ question: r.question, arm: r.arm, recall: r.score.recall, precision: r.score.precision, explore_bytes: r.ingest.explore_bytes, tokens: r.tokens.total, tool_calls: r.tool_calls.total, cs: r.tool_calls.graft, missed: r.score.missed, extra: r.score.extra })),
      null,
      2,
    )}\n`,
  );
}

function report() {
  const dir = labDir();
  const results = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")))
    : [];
  const rep = buildBenchReport(results, BENCH.questions.map((q) => q.id));
  process.stdout.write(`${JSON.stringify(rep, null, 2)}\n`);
  process.exit(rep.verdict === "accept" ? 0 : 1);
}

const argv = process.argv.slice(2);
const o = { _: [] };
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) o[argv[i].slice(2)] = argv[++i];
  else o._.push(argv[i]);
}
if (o._[0] === "run") run(o);
else if (o._[0] === "report") report();
else fail("usage: bench-score.js run --q <id> [--agent <jsonl>] | report");
