/**
 * Graft experiment metrics (ADR-0026, ADR-0027, docs/process/graft.md): what one subagent spent on one task group or
 * one benchmark question, read from its Claude Code transcript, whether it followed the code-search procedure, and
 * how the arms compare.
 *
 * Transcript — `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl` with `agent-<id>.meta.json` next
 * to it (`description` = the Agent call's description). One API response may span several JSONL lines with the same
 * `message.id` — usage is counted once per id, tool calls once per `tool_use` id.
 *
 * Arms are blind labels at the end of the description: `[A]` — code search via `scripts/dev/cs.js`
 * (docs/process/code-search.md, pasted into the prompt), `[B]` — control, usual tools. Graft's own "tokens saved"
 * lines are not used (and `cs.js` strips them).
 *
 * Primary metric (ADR-0027): bytes of tool results the agent pulled into its context while exploring
 * (`ingest.explore_bytes`), and the same before its first edit (`ingest.explore_before_edit_bytes`).
 *
 * Shared by `scripts/dev/graft-metrics.js`, `scripts/dev/bench-score.js` and
 * `packages/cli/test/unit/dev/graft-metrics.test.ts`. Plain Node ESM. Dev tooling only — not in `files` of
 * package.json.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const RUN_FORMAT = "graft-run/2";
export const REPORT_FORMAT = "graft-report/2";
export const BENCH_RESULT_FORMAT = "code-search-bench-result/1";
export const BENCH_REPORT_FORMAT = "code-search-bench-report/1";

/** Blind arm label at the end of the Agent description. */
const ARM_TAG = /\[(A|B)\]\s*$/;
const ARM_MODE = { A: "on", B: "off" };

/** ON runs with more deviations from the procedure than this are not counted in the verdict. */
export const MAX_DEVIATIONS = 3;

const CS_CALL = /(?:^|[\s;&|("'/\\])cs\.js["']?\s+([a-z-]+)/g;
const RAW_GRAFT = /(?:^|[\s;&|(])(?:npx\s+(?:-y\s+)?(?:@nanonets\/)?)?graft\s+([a-z-]+)/g;
const SHELL_SEARCH = /^\s*(?:grep|rg|git\s+grep|find|cat|head|tail|sed\s+-n|ls|wc|Get-Content|Select-String)\b/;
const SHELL_CONTENT_SEARCH = /^\s*(?:grep|rg|git\s+grep|Select-String)\b/;
const SHELL_WHOLE_READ = /^\s*(?:cat|Get-Content)\b/;
const SHELL_WRITE = /^\s*(?:cat\s*>|tee\b|sed\s+-i|Set-Content|Out-File)|>\s*[^&|]/;
const CODE_FILE = /\.(?:[cm]?[jt]s)$/;
const CODE_DIR = /^(?:\.\/)?(?:packages|scripts|src|test)(?:\/|$)/;
const NOT_CODE = /node_modules|\.(?:json|jsonc|ya?ml|md|lock|txt|toml)$/;

/** Heredoc bodies (`<<'EOF' … EOF`) are file content being written, not commands. */
export function stripHeredocs(command) {
  return command.replace(/<<-?\s*['"]?(\w+)['"]?([^\n]*)\n[\s\S]*?\n\s*\1\s*(?=\n|$)/g, "<<$1$2");
}

const segments = (command) => stripHeredocs(command).split(/&&|\|\||;|\||\n/);

/** First command of every pipeline — what the shell runs on files; later `| grep`, `| tail` only filter output. */
const pipelineHeads = (command) =>
  stripHeredocs(command)
    .split(/&&|\|\||;|\n/)
    .map((p) => p.split("|")[0]);

/** Non-flag arguments of one shell segment; quoted strings (patterns) collapse to `Q`. */
function targets(seg) {
  return seg
    .replace(/"[^"]*"|'[^']*'/g, "Q")
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((t) => t.replace(/\\/g, "/"))
    .filter((t) => t && !t.startsWith("-"));
}

/** The segment writes a file (`cat > f`, `tee`, `sed -i`, redirect); `2>&1` and `> /dev/null` do not count. */
const writesFile = (seg) => SHELL_WRITE.test(seg.replace(/\d?>&\d|\d?>\s*\/dev\/null|\d?>\s*\$null/g, ""));

const isCodeTarget = (t) => !NOT_CODE.test(t) && (CODE_FILE.test(t) || CODE_DIR.test(t) || /\/(?:packages|scripts)\//.test(t));

/** A shell command explores files when any segment of its chain reads or searches (`cd x && cat y`). */
export function isShellSearch(command) {
  return pipelineHeads(command).some((seg) => SHELL_SEARCH.test(seg) && !writesFile(seg));
}

/** A shell command writes files (heredoc to a file, `sed -i`, redirect). */
export function isShellWrite(command) {
  return segments(command).some(writesFile);
}

/** Subcommands of every `cs.js <sub>` call in a shell command. */
export function csCalls(command) {
  return [...command.matchAll(CS_CALL)].map((m) => m[1]);
}

/** Subcommands of every direct `graft <sub>` call (outside `cs.js`). */
export function rawGraftCalls(command) {
  return [...command.replace(CS_CALL, " ").matchAll(RAW_GRAFT)].map((m) => m[1]);
}

/**
 * Deviations from docs/process/code-search.md in one tool call: search over code content instead of `cs grep` /
 * `cs ask`, a whole code file read instead of `cs skeleton` + a range, graft called around `cs.js`. Not deviations:
 * writes (heredoc, `sed -i`), JSON / configs / locks / docs, `node_modules` and other packages, file listing
 * (`find`, `ls`, Glob), filtering piped output.
 */
export function deviationsOf(block) {
  const input = block.input ?? {};
  const out = [];
  if (block.name === "Grep") {
    const where = [input.path, input.glob].filter(Boolean).map((t) => String(t).replace(/\\/g, "/"));
    const code = /\b(?:ts|js)\b/.test(input.type ?? "") || where.some((t) => isCodeTarget(t) || /\*\.[cm]?[jt]s\b/.test(t));
    if (code && !where.some((t) => NOT_CODE.test(t))) out.push("Grep over code");
  } else if (block.name === "Read") {
    const file = String(input.file_path ?? "").replace(/\\/g, "/");
    if (CODE_FILE.test(file) && !NOT_CODE.test(file) && input.offset === undefined && input.limit === undefined) {
      out.push(`whole read ${file.split("/").slice(-2).join("/")}`);
    }
  } else if (block.name === "Bash" || block.name === "PowerShell") {
    const command = String(input.command ?? "");
    for (const sub of rawGraftCalls(command)) out.push(`raw graft ${sub}`);
    if (/\bcd\s+\S*node_modules/.test(command)) return out;
    const parts = stripHeredocs(command).split(/(\|)/);
    let piped = false;
    for (const part of parts) {
      if (part === "|") {
        piped = true;
        continue;
      }
      for (const seg of part.split(/&&|\|\||;|\n/)) {
        if (csCalls(seg).length > 0 || writesFile(seg)) continue;
        const args = targets(seg.replace(/^\s*git\s+grep\b/, "grep"));
        if (SHELL_CONTENT_SEARCH.test(seg)) {
          const paths = /\s(?:-e|-f|--regexp)\b/.test(seg) ? args : args.slice(1);
          const recursiveHere = /\s-[a-zA-Z]*[rR]/.test(seg) && paths.length === 0;
          const code = paths.some(isCodeTarget) || /--include=\S*\.[cm]?[jt]s/.test(seg) || recursiveHere;
          if (code && !(piped && paths.length === 0)) out.push("shell search over code");
        } else if (SHELL_WHOLE_READ.test(seg) && !/\s-(?:TotalCount|Head|Tail)\b/i.test(seg) && args.some((t) => CODE_FILE.test(t) && !NOT_CODE.test(t))) {
          out.push("shell whole read of code");
        }
      }
      piped = false;
    }
  }
  return out;
}

const resultText = (content) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (typeof c?.text === "string" ? c.text : "")).join("") : "";

/** Metrics of one transcript (JSONL text). */
export function parseTranscript(text) {
  const seenMsg = new Set();
  const seenTool = new Set();
  const kindOf = new Map();
  const tokens = { input: 0, cache_creation: 0, cache_read: 0, output: 0, total: 0, context_peak: 0 };
  const ingest = { explore_bytes: 0, cs_bytes: 0, explore_before_edit_bytes: 0, results_bytes: 0 };
  const byName = {};
  const searchCommands = [];
  const deviations = [];
  let shellSearch = 0;
  let rawGraft = 0;
  let edited = false;
  let start = null;
  let end = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof rec.timestamp === "string") {
      if (start === null || rec.timestamp < start) start = rec.timestamp;
      if (end === null || rec.timestamp > end) end = rec.timestamp;
    }
    const content = Array.isArray(rec.message?.content) ? rec.message.content : [];
    if (rec.type === "user") {
      for (const block of content) {
        if (block.type !== "tool_result" || !kindOf.has(block.tool_use_id)) continue;
        const { kind, beforeEdit } = kindOf.get(block.tool_use_id);
        kindOf.delete(block.tool_use_id);
        const bytes = Buffer.byteLength(resultText(block.content));
        ingest.results_bytes += bytes;
        if (kind === "explore" || kind === "cs") {
          ingest.explore_bytes += bytes;
          if (beforeEdit) ingest.explore_before_edit_bytes += bytes;
        }
        if (kind === "cs") ingest.cs_bytes += bytes;
      }
      continue;
    }
    if (rec.type !== "assistant" || !rec.message) continue;
    const msg = rec.message;
    const msgKey = msg.id ?? rec.requestId ?? rec.uuid;
    if (msg.usage && !seenMsg.has(msgKey)) {
      seenMsg.add(msgKey);
      const u = msg.usage;
      const inp = u.input_tokens ?? 0;
      const cc = u.cache_creation_input_tokens ?? 0;
      const cr = u.cache_read_input_tokens ?? 0;
      tokens.input += inp;
      tokens.cache_creation += cc;
      tokens.cache_read += cr;
      tokens.output += u.output_tokens ?? 0;
      tokens.context_peak = Math.max(tokens.context_peak, inp + cc + cr);
    }
    for (const block of content) {
      if (block.type !== "tool_use" || seenTool.has(block.id)) continue;
      seenTool.add(block.id);
      byName[block.name] = (byName[block.name] ?? 0) + 1;
      deviations.push(...deviationsOf(block));
      let kind = "other";
      if (block.name === "Read" || block.name === "Grep" || block.name === "Glob") kind = "explore";
      else if (block.name === "Edit" || block.name === "Write" || block.name === "NotebookEdit") kind = "edit";
      else if (block.name === "Bash" || block.name === "PowerShell") {
        const command = String(block.input?.command ?? "");
        const cs = csCalls(command);
        const raw = rawGraftCalls(command);
        rawGraft += raw.length;
        if (cs.length + raw.length > 0) {
          kind = "cs";
          searchCommands.push(command.length > 160 ? `${command.slice(0, 157)}...` : command);
        } else if (isShellWrite(command)) kind = "edit";
        else if (isShellSearch(command)) {
          kind = "explore";
          shellSearch++;
        }
      }
      if (kind === "edit") edited = true;
      kindOf.set(block.id, { kind, beforeEdit: !edited });
    }
  }
  tokens.total = tokens.input + tokens.cache_creation + tokens.cache_read + tokens.output;
  const readLike = (byName.Read ?? 0) + (byName.Grep ?? 0) + (byName.Glob ?? 0);
  const total = Object.values(byName).reduce((a, b) => a + b, 0);
  const durationS = start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 1000) : 0;
  return {
    window: { start, end, duration_s: durationS },
    requests: seenMsg.size,
    tokens,
    ingest,
    tool_calls: { total, by_name: byName, read_like: readLike, shell_search: shellSearch, graft: searchCommands.length, raw_graft: rawGraft },
    graft_commands: searchCommands,
    deviations,
  };
}

/** Mode from the blind arm label (`[A]` → on, `[B]` → off); `null` when unlabelled. */
export function modeOf(description) {
  const m = ARM_TAG.exec(String(description ?? "").trim());
  return m ? ARM_MODE[m[1]] : null;
}

/**
 * Run record: transcript metrics + who/what + the coordinator's card. `part` — the k-th subagent of a group that had
 * to be split (one group = one agent; parts are summed by `report`).
 * Violations: any graft use in an OFF run. In an ON run deviations are kept; more than `MAX_DEVIATIONS` make the run
 * non-compliant (reported, not counted in the verdict).
 */
export function buildRun({ change, group, part = null, mode, agent, metrics, card }) {
  const violations = [];
  if (mode === "off" && metrics.tool_calls.graft > 0) violations.push("graft used in an OFF run");
  const { deviations, ...rest } = metrics;
  return {
    format: RUN_FORMAT,
    change,
    group,
    part,
    mode,
    agent,
    ...rest,
    deviations: mode === "on" ? deviations : [],
    compliant: mode !== "on" || deviations.length <= MAX_DEVIATIONS,
    violations,
    card: {
      red_runs: card?.red_runs ?? null,
      helped: card?.helped ?? null,
      misled: card?.misled ?? null,
      notes: card?.notes ?? null,
    },
  };
}

const sumObj = (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, (a[k] ?? 0) + (b[k] ?? 0)]));

/** Parts of one group (`part` set) → one run: sums, peak = max, deviations concatenated, cards merged. */
export function mergeParts(runs) {
  const byGroup = new Map();
  for (const r of runs) {
    const key = `${r.change}#${r.group}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), r]);
  }
  return [...byGroup.values()].map((parts) => {
    if (parts.length === 1) return parts[0];
    parts.sort((x, y) => (x.part ?? 0) - (y.part ?? 0));
    const merged = parts.reduce((acc, r) => ({
      ...acc,
      tokens: { ...sumObj(acc.tokens, r.tokens), context_peak: Math.max(acc.tokens.context_peak, r.tokens.context_peak) },
      ingest: sumObj(acc.ingest ?? {}, r.ingest ?? {}),
      tool_calls: { ...sumObj({ ...acc.tool_calls, by_name: 0 }, { ...r.tool_calls, by_name: 0 }), by_name: sumObj(acc.tool_calls.by_name, r.tool_calls.by_name) },
      window: { start: acc.window.start, end: r.window.end, duration_s: acc.window.duration_s + r.window.duration_s },
      requests: acc.requests + r.requests,
      graft_commands: [...acc.graft_commands, ...r.graft_commands],
      deviations: [...acc.deviations, ...r.deviations],
      violations: [...acc.violations, ...r.violations],
      card: {
        red_runs: (acc.card.red_runs ?? 0) + (r.card.red_runs ?? 0),
        helped: r.card.helped ?? acc.card.helped,
        misled: [acc.card.misled, r.card.misled].filter((m) => m && m !== "none").join("; ") || acc.card.misled || r.card.misled,
        notes: [acc.card.notes, r.card.notes].filter(Boolean).join("; ") || null,
      },
    }));
    return { ...merged, part: null, parts: parts.length, compliant: merged.mode !== "on" || merged.deviations.length <= MAX_DEVIATIONS };
  });
}

export function median(values) {
  const v = values.filter((x) => typeof x === "number");
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function summarize(runs) {
  return {
    n: runs.length,
    groups: runs.map((r) => `${r.change}#${r.group}`),
    median_explore_bytes: median(runs.map((r) => r.ingest?.explore_bytes)),
    median_explore_before_edit_bytes: median(runs.map((r) => r.ingest?.explore_before_edit_bytes)),
    median_tokens_total: median(runs.map((r) => r.tokens.total)),
    median_tokens_output: median(runs.map((r) => r.tokens.output)),
    median_context_peak: median(runs.map((r) => r.tokens.context_peak)),
    median_tool_calls: median(runs.map((r) => r.tool_calls.total)),
    median_duration_s: median(runs.map((r) => r.window.duration_s)),
    red_runs: runs.reduce((a, r) => a + (r.card.red_runs ?? 0), 0),
    misled: runs.filter((r) => r.card.misled && r.card.misled !== "none").length,
    violations: runs.reduce((a, r) => a + r.violations.length, 0),
    deviations: runs.reduce((a, r) => a + (r.deviations?.length ?? 0), 0),
  };
}

const delta = (on, off) => (on === null || off === null || off === 0 ? null : Math.round(((on - off) / off) * 1000) / 10);

/**
 * Field report (task groups). Informative since ADR-0027 — the verdict comes from the benchmark; the field verdict
 * stays as a cross-check: ≥ 2 counted runs per arm (ON — compliant only), ON median of explore bytes ≥ 20 % lower,
 * no more red runs, no misled run, no violation. A `[B]` run is counted only with no cs / graft call (violation
 * otherwise). `missing` — groups closed in tasks.md without a record (see `closedGroups`).
 */
export function buildReport(records, { minPerMode = 2, threshold = -20, missing = [] } = {}) {
  const runs = mergeParts(records);
  const nonCompliant = runs.filter((r) => r.mode === "on" && r.compliant === false);
  const on = summarize(runs.filter((r) => r.mode === "on" && r.compliant !== false));
  const off = summarize(runs.filter((r) => r.mode === "off" && r.violations.length === 0));
  const baseline = summarize(runs.filter((r) => r.mode === "baseline"));
  const d = {
    explore_bytes_pct: delta(on.median_explore_bytes, off.median_explore_bytes),
    explore_before_edit_pct: delta(on.median_explore_before_edit_bytes, off.median_explore_before_edit_bytes),
    tokens_total_pct: delta(on.median_tokens_total, off.median_tokens_total),
    tool_calls_pct: delta(on.median_tool_calls, off.median_tool_calls),
    duration_pct: delta(on.median_duration_s, off.median_duration_s),
  };
  const reasons = [];
  let verdict;
  if (on.n < minPerMode || off.n < minPerMode) {
    verdict = "insufficient";
    reasons.push(`need ≥ ${minPerMode} counted runs per arm (on=${on.n}, off=${off.n})`);
  } else {
    if (!(d.explore_bytes_pct !== null && d.explore_bytes_pct <= threshold)) reasons.push(`explore bytes ${d.explore_bytes_pct}% is not ≤ ${threshold}%`);
    if (on.red_runs > off.red_runs) reasons.push(`more red runs with graft (${on.red_runs} > ${off.red_runs})`);
    if (on.misled > 0) reasons.push(`graft misled ${on.misled} run(s)`);
    const violations = runs.reduce((a, r) => a + r.violations.length, 0);
    if (violations > 0) reasons.push(`${violations} rule violation(s)`);
    verdict = reasons.length === 0 ? "accept" : "reject";
  }
  return {
    format: REPORT_FORMAT,
    verdict,
    reasons,
    delta: d,
    on,
    off,
    baseline,
    non_compliant: nonCompliant.map((r) => ({ group: `${r.change}#${r.group}`, deviations: r.deviations })),
    blind_leak: runs.filter((r) => /blind-leak/.test(r.card.notes ?? "")).map((r) => `${r.change}#${r.group}`),
    missing,
  };
}

/** Numbers of task groups in tasks.md whose every box is ticked (`## N.` headings, `- [x] N.k` lines). */
export function closedGroups(tasksMd) {
  const groups = new Map();
  let current = null;
  for (const line of tasksMd.split(/\r?\n/)) {
    const h = /^##\s+(\d+)\./.exec(line);
    if (h) {
      current = Number(h[1]);
      groups.set(current, { open: 0, done: 0 });
      continue;
    }
    const box = /^\s*-\s+\[( |x)\]/i.exec(line);
    if (box && current !== null) groups.get(current)[box[1] === " " ? "open" : "done"]++;
  }
  return [...groups].filter(([, c]) => c.done > 0 && c.open === 0).map(([n]) => n);
}

/** Subagent transcripts of this project whose Agent description contains `text` (case-insensitive). */
export function findTranscripts(text, { exact = false } = {}) {
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
        const desc = String(meta.description ?? "").toLowerCase().trim();
        if (exact ? desc !== needle : !desc.includes(needle)) continue;
        hits.push({ jsonl: path.join(dir, f.replace(/\.meta\.json$/, ".jsonl")), meta });
      }
    }
  }
  return hits;
}

// ---- code-search benchmark (ADR-0027) ----

/**
 * The agent's answer: the last ```json fenced block (or last bare JSON array) of its last message with one — a text
 * block or the `message` of its hand-back tool call (`SubagentHandback`), whichever comes last.
 */
export function extractAnswer(text) {
  let last = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.type !== "assistant" || !Array.isArray(rec.message?.content)) continue;
    for (const b of rec.message.content) {
      const body = b.type === "text" ? b.text : b.type === "tool_use" && typeof b.input?.message === "string" ? b.input.message : "";
      if (body.includes("[")) last = body;
    }
  }
  if (last === null) return null;
  const fenced = [...last.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const cand of [...fenced.reverse(), last.slice(last.indexOf("["), last.lastIndexOf("]") + 1)]) {
    try {
      const v = JSON.parse(cand);
      if (Array.isArray(v)) return v;
    } catch {
      // next candidate
    }
  }
  return null;
}

const normFile = (f) => {
  const s = String(f ?? "").replace(/\\/g, "/");
  const i = s.indexOf("packages/");
  return i >= 0 ? s.slice(i) : s.replace(/^\.\//, "");
};
const normSymbol = (s) => {
  const v = String(s ?? "").replace(/\(\)$/, "").trim();
  if (v === "(file)" || v === "") return "(file)";
  return v.split(/[.#]/).pop();
};

/** Recall / precision of an answer against the truth: symbol questions by file + symbol, file questions by file. */
export function scoreAnswer(question, answer) {
  const fileLevel = question.level === "file";
  const key = (it) => (fileLevel ? normFile(it.file) : `${normFile(it.file)}::${normSymbol(it.symbol)}`);
  const truth = new Set(question.truth.map(key));
  const given = new Set((Array.isArray(answer) ? answer : []).filter((it) => it && typeof it === "object").map(key));
  const hit = [...given].filter((k) => truth.has(k));
  const truthFiles = new Set(question.truth.map((it) => normFile(it.file)));
  const givenFiles = new Set((Array.isArray(answer) ? answer : []).map((it) => normFile(it?.file)));
  return {
    answered: Array.isArray(answer),
    recall: truth.size ? Math.round((hit.length / truth.size) * 1000) / 1000 : null,
    precision: given.size ? Math.round((hit.length / given.size) * 1000) / 1000 : 0,
    file_recall: Math.round(([...truthFiles].filter((f) => givenFiles.has(f)).length / truthFiles.size) * 1000) / 1000,
    missed: [...truth].filter((k) => !given.has(k)),
    extra: [...given].filter((k) => !truth.has(k)),
  };
}

/**
 * Benchmark verdict (ADR-0027): paired by question. Accept when every question has both arms, the median of
 * per-question ratios explore_bytes[A] / explore_bytes[B] is ≤ 0.8, and mean recall of A is not below B.
 */
export function buildBenchReport(results, questionIds) {
  const pairs = questionIds.map((id) => {
    const a = results.find((r) => r.question === id && r.arm === "A");
    const b = results.find((r) => r.question === id && r.arm === "B");
    return {
      question: id,
      a: a ? { explore_bytes: a.ingest.explore_bytes, tokens: a.tokens.total, tool_calls: a.tool_calls.total, recall: a.score.recall, precision: a.score.precision, cs: a.tool_calls.graft, deviations: a.deviations.length } : null,
      b: b ? { explore_bytes: b.ingest.explore_bytes, tokens: b.tokens.total, tool_calls: b.tool_calls.total, recall: b.score.recall, precision: b.score.precision, cs: b.tool_calls.graft } : null,
      ratio_explore: a && b && b.ingest.explore_bytes > 0 ? Math.round((a.ingest.explore_bytes / b.ingest.explore_bytes) * 1000) / 1000 : null,
      ratio_tokens: a && b && b.tokens.total > 0 ? Math.round((a.tokens.total / b.tokens.total) * 1000) / 1000 : null,
    };
  });
  const complete = pairs.filter((p) => p.a && p.b);
  const mean = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + (x ?? 0), 0) / xs.length) * 1000) / 1000 : null);
  const summary = {
    pairs: complete.length,
    median_ratio_explore: median(complete.map((p) => p.ratio_explore)),
    median_ratio_tokens: median(complete.map((p) => p.ratio_tokens)),
    mean_recall_a: mean(complete.map((p) => p.a.recall)),
    mean_recall_b: mean(complete.map((p) => p.b.recall)),
    mean_precision_a: mean(complete.map((p) => p.a.precision)),
    mean_precision_b: mean(complete.map((p) => p.b.precision)),
    b_with_cs: complete.filter((p) => p.b.cs > 0).map((p) => p.question),
  };
  const reasons = [];
  let verdict;
  if (complete.length < questionIds.length) {
    verdict = "insufficient";
    reasons.push(`${questionIds.length - complete.length} question(s) without both arms`);
  } else {
    if (!(summary.median_ratio_explore !== null && summary.median_ratio_explore <= 0.8)) reasons.push(`median explore ratio ${summary.median_ratio_explore} is not ≤ 0.8`);
    if (summary.mean_recall_a < summary.mean_recall_b) reasons.push(`recall A ${summary.mean_recall_a} < B ${summary.mean_recall_b}`);
    if (summary.b_with_cs.length > 0) reasons.push(`cs used in [B]: ${summary.b_with_cs.join(", ")}`);
    verdict = reasons.length === 0 ? "accept" : "reject";
  }
  return { format: BENCH_REPORT_FORMAT, verdict, reasons, summary, pairs };
}
