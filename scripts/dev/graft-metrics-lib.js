/**
 * Graft experiment metrics (ADR-0026): what one subagent spent on one task
 * group, read from its Claude Code transcript, and how the ON / OFF / baseline
 * runs compare.
 *
 * Transcript — `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`
 * with `agent-<id>.meta.json` next to it (`description` = the Agent call's
 * description). One API response may span several JSONL lines with the same
 * `message.id` — usage is counted once per id, tool calls once per `tool_use` id.
 *
 * Graft's own "tokens saved" lines are not used: they compare against reading
 * whole files and overstate the effect.
 *
 * Shared by `scripts/dev/graft-metrics.js` and
 * `packages/cli/test/unit/dev/graft-metrics.test.ts`. Plain Node ESM, no deps.
 * Dev tooling only — not in `files` of package.json.
 */

export const RUN_FORMAT = "graft-run/1";
export const REPORT_FORMAT = "graft-report/1";

/** Graft subcommands allowed in an ON run (docs/process/graft.md §3). */
export const ALLOWED_GRAFT = ["ask", "callers", "skeleton", "map", "grep", "build", "version"];

/** `description` tag the coordinator puts on every experiment subagent. */
export const MODE_TAG = /\[graft:(on|off)\]/i;

const GRAFT_CALL = /(?:^|[\s;&|(])(?:npx\s+(?:-y\s+)?(?:@nanonets\/)?)?graft\s+([a-z-]+)/g;
const FORBIDDEN_FLAGS = /--deep\b|--lsp\b/;
const SHELL_SEARCH = /^\s*(?:grep|rg|find|cat|head|tail|sed\s+-n|ls|wc|Get-Content|Select-String)\b/;

/** A shell command explores code when any segment of its chain reads or searches files (`cd x && cat y`). */
export function isShellSearch(command) {
  return command.split(/&&|\|\||;|\||\n/).some((seg) => SHELL_SEARCH.test(seg));
}

/** Every `graft <sub>` invocation in a shell command. */
export function graftCalls(command) {
  const out = [];
  for (const m of command.matchAll(GRAFT_CALL)) out.push(m[1]);
  return out;
}

/**
 * Metrics of one transcript (JSONL text).
 * @returns {{window:{start:string|null,end:string|null,duration_s:number},
 *   requests:number, tokens:{input:number,cache_creation:number,cache_read:number,output:number,total:number,context_peak:number},
 *   tool_calls:{total:number,by_name:Record<string,number>,read_like:number,shell_search:number,graft:number},
 *   graft_commands:string[], violations:string[]}}
 */
export function parseTranscript(text) {
  const seenMsg = new Set();
  const seenTool = new Set();
  const tokens = { input: 0, cache_creation: 0, cache_read: 0, output: 0, total: 0, context_peak: 0 };
  const byName = {};
  const graftCommands = [];
  const violations = [];
  let shellSearch = 0;
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
    if (rec.type !== "assistant" || !rec.message) continue;
    const msg = rec.message;
    const msgKey = msg.id ?? rec.requestId ?? rec.uuid;
    if (msg.usage && !seenMsg.has(msgKey)) {
      seenMsg.add(msgKey);
      const u = msg.usage;
      const inp = u.input_tokens ?? 0;
      const cc = u.cache_creation_input_tokens ?? 0;
      const cr = u.cache_read_input_tokens ?? 0;
      const outp = u.output_tokens ?? 0;
      tokens.input += inp;
      tokens.cache_creation += cc;
      tokens.cache_read += cr;
      tokens.output += outp;
      tokens.context_peak = Math.max(tokens.context_peak, inp + cc + cr);
    }
    for (const block of Array.isArray(msg.content) ? msg.content : []) {
      if (block.type !== "tool_use" || seenTool.has(block.id)) continue;
      seenTool.add(block.id);
      byName[block.name] = (byName[block.name] ?? 0) + 1;
      if (block.name !== "Bash" && block.name !== "PowerShell") continue;
      const command = String(block.input?.command ?? "");
      const subs = graftCalls(command);
      if (subs.length === 0) {
        if (isShellSearch(command)) shellSearch++;
        continue;
      }
      graftCommands.push(command.length > 160 ? `${command.slice(0, 157)}...` : command);
      for (const sub of subs) {
        if (!ALLOWED_GRAFT.includes(sub)) violations.push(`graft ${sub}`);
      }
      if (FORBIDDEN_FLAGS.test(command)) violations.push(`forbidden flag: ${command.match(FORBIDDEN_FLAGS)[0]}`);
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
    tool_calls: { total, by_name: byName, read_like: readLike, shell_search: shellSearch, graft: graftCommands.length },
    graft_commands: graftCommands,
    violations,
  };
}

/** Mode from the subagent description tag; `null` when untagged. */
export function modeOf(description) {
  const m = MODE_TAG.exec(description ?? "");
  return m ? m[1].toLowerCase() : null;
}

/**
 * Run record: transcript metrics + who/what + the coordinator's card.
 * In an OFF run any graft call is a violation (the prompt forbids it).
 */
export function buildRun({ change, group, mode, agent, metrics, card }) {
  const violations = [...metrics.violations];
  if (mode === "off" && metrics.tool_calls.graft > 0) violations.push("graft used in an OFF run");
  return {
    format: RUN_FORMAT,
    change,
    group,
    mode,
    agent,
    ...metrics,
    violations,
    card: {
      red_runs: card?.red_runs ?? null,
      helped: card?.helped ?? null,
      misled: card?.misled ?? null,
      notes: card?.notes ?? null,
    },
  };
}

export function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function summarize(runs) {
  return {
    n: runs.length,
    groups: runs.map((r) => `${r.change}#${r.group}`),
    median_tokens_total: median(runs.map((r) => r.tokens.total)),
    median_tokens_output: median(runs.map((r) => r.tokens.output)),
    median_context_peak: median(runs.map((r) => r.tokens.context_peak)),
    median_tool_calls: median(runs.map((r) => r.tool_calls.total)),
    median_read_like: median(runs.map((r) => r.tool_calls.read_like + r.tool_calls.shell_search)),
    median_duration_s: median(runs.map((r) => r.window.duration_s)),
    red_runs: runs.reduce((a, r) => a + (r.card.red_runs ?? 0), 0),
    misled: runs.filter((r) => r.card.misled && r.card.misled !== "none").length,
    violations: runs.reduce((a, r) => a + r.violations.length, 0),
  };
}

const delta = (on, off) => (on === null || off === null || off === 0 ? null : Math.round(((on - off) / off) * 1000) / 10);

/**
 * Verdict by ADR-0026 §4: accept when both modes have ≥ 2 runs, the ON median of
 * total tokens or tool calls is ≥ 20 % lower than OFF, ON has no more red runs,
 * no ON run was misled into an error and no run broke the rules.
 */
export function buildReport(runs, { minPerMode = 2, threshold = -20 } = {}) {
  const on = summarize(runs.filter((r) => r.mode === "on"));
  const off = summarize(runs.filter((r) => r.mode === "off"));
  const baseline = summarize(runs.filter((r) => r.mode === "baseline"));
  const d = {
    tokens_total_pct: delta(on.median_tokens_total, off.median_tokens_total),
    tool_calls_pct: delta(on.median_tool_calls, off.median_tool_calls),
    read_like_pct: delta(on.median_read_like, off.median_read_like),
    duration_pct: delta(on.median_duration_s, off.median_duration_s),
  };
  const reasons = [];
  let verdict;
  if (on.n < minPerMode || off.n < minPerMode) {
    verdict = "insufficient";
    reasons.push(`need ≥ ${minPerMode} runs per mode (on=${on.n}, off=${off.n})`);
  } else {
    const cheaper = (d.tokens_total_pct !== null && d.tokens_total_pct <= threshold) || (d.tool_calls_pct !== null && d.tool_calls_pct <= threshold);
    if (!cheaper) reasons.push(`neither tokens (${d.tokens_total_pct}%) nor tool calls (${d.tool_calls_pct}%) are ≤ ${threshold}%`);
    if (on.red_runs > off.red_runs) reasons.push(`more red runs with graft (${on.red_runs} > ${off.red_runs})`);
    if (on.misled > 0) reasons.push(`graft misled ${on.misled} run(s)`);
    if (on.violations + off.violations > 0) reasons.push(`${on.violations + off.violations} rule violation(s)`);
    verdict = reasons.length === 0 ? "accept" : "reject";
  }
  return { format: REPORT_FORMAT, verdict, reasons, delta: d, on, off, baseline };
}
