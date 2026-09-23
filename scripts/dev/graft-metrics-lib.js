/**
 * Graft experiment metrics (ADR-0026, docs/process/graft.md): what one subagent spent on one task group, read from
 * its Claude Code transcript, whether it followed the code-search procedure, and how the arms compare.
 *
 * Transcript — `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl` with `agent-<id>.meta.json` next
 * to it (`description` = the Agent call's description). One API response may span several JSONL lines with the same
 * `message.id` — usage is counted once per id, tool calls once per `tool_use` id.
 *
 * Arms are blind labels in the description: `[A]` — code search via `scripts/dev/cs.js`
 * (`.claude/skills/code-search/SKILL.md`), `[B]` — control, usual tools. Graft's own "tokens saved" lines are not
 * used (and `cs.js` strips them).
 *
 * Shared by `scripts/dev/graft-metrics.js` and `packages/cli/test/unit/dev/graft-metrics.test.ts`.
 * Plain Node ESM, no deps. Dev tooling only — not in `files` of package.json.
 */

export const RUN_FORMAT = "graft-run/1";
export const REPORT_FORMAT = "graft-report/1";

/** Blind arm label at the end of the Agent description. */
const ARM_TAG = /\[(A|B)\]\s*$/;
const ARM_MODE = { A: "on", B: "off" };

/** ON runs with more deviations from the procedure than this are not counted in the verdict. */
export const MAX_DEVIATIONS = 3;

const CS_CALL = /(?:^|[\s;&|("'/\\])cs\.js["']?\s+([a-z-]+)/g;
const RAW_GRAFT = /(?:^|[\s;&|(])(?:npx\s+(?:-y\s+)?(?:@nanonets\/)?)?graft\s+([a-z-]+)/g;
const SHELL_SEARCH = /^\s*(?:grep|rg|find|cat|head|tail|sed\s+-n|ls|wc|Get-Content|Select-String)\b/;
const CODE_PATH = /(?:^|[\s"'/=])(?:packages|scripts)(?:[/\\]|\b)|\.(?:[cm]?[jt]s)\b/;
const CODE_FILE = /\.(?:[cm]?[jt]s)$/;
const SHELL_CODE_SEARCH = /^\s*(?:grep|rg|find|Select-String)\b/;
const SHELL_WHOLE_READ = /^\s*(?:cat|Get-Content)\s+[^|]*\.(?:[cm]?[jt]s)\b/;

const segments = (command) => command.split(/&&|\|\||;|\||\n/);

/** A shell command explores files when any segment of its chain reads or searches (`cd x && cat y`). */
export function isShellSearch(command) {
  return segments(command).some((seg) => SHELL_SEARCH.test(seg));
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
 * Deviations from `.claude/skills/code-search/SKILL.md` in one tool call: raw search over code instead of
 * `cs grep` / `cs ask`, a whole code file read instead of `cs skeleton` + a range, graft called around `cs.js`.
 */
export function deviationsOf(block) {
  const input = block.input ?? {};
  const out = [];
  if (block.name === "Grep" || block.name === "Glob") {
    const where = `${input.path ?? ""} ${input.glob ?? ""} ${input.type ?? ""} ${block.name === "Glob" ? input.pattern ?? "" : ""}`;
    if (CODE_PATH.test(where) || /\b(?:ts|js)\b/.test(input.type ?? "")) out.push(`${block.name} over code`);
  } else if (block.name === "Read") {
    const file = String(input.file_path ?? "");
    if (CODE_FILE.test(file) && input.offset === undefined && input.limit === undefined) out.push(`whole read ${file.split(/[/\\]/).slice(-2).join("/")}`);
  } else if (block.name === "Bash" || block.name === "PowerShell") {
    const command = String(input.command ?? "");
    for (const sub of rawGraftCalls(command)) out.push(`raw graft ${sub}`);
    if (csCalls(command).length > 0) return out;
    for (const seg of segments(command)) {
      if (SHELL_CODE_SEARCH.test(seg) && CODE_PATH.test(seg)) out.push("shell search over code");
      else if (SHELL_WHOLE_READ.test(seg)) out.push("shell whole read of code");
    }
  }
  return out;
}

/** Metrics of one transcript (JSONL text). */
export function parseTranscript(text) {
  const seenMsg = new Set();
  const seenTool = new Set();
  const tokens = { input: 0, cache_creation: 0, cache_read: 0, output: 0, total: 0, context_peak: 0 };
  const byName = {};
  const searchCommands = [];
  const deviations = [];
  let shellSearch = 0;
  let rawGraft = 0;
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
      tokens.input += inp;
      tokens.cache_creation += cc;
      tokens.cache_read += cr;
      tokens.output += u.output_tokens ?? 0;
      tokens.context_peak = Math.max(tokens.context_peak, inp + cc + cr);
    }
    for (const block of Array.isArray(msg.content) ? msg.content : []) {
      if (block.type !== "tool_use" || seenTool.has(block.id)) continue;
      seenTool.add(block.id);
      byName[block.name] = (byName[block.name] ?? 0) + 1;
      deviations.push(...deviationsOf(block));
      if (block.name !== "Bash" && block.name !== "PowerShell") continue;
      const command = String(block.input?.command ?? "");
      const cs = csCalls(command);
      const raw = rawGraftCalls(command);
      rawGraft += raw.length;
      if (cs.length + raw.length > 0) searchCommands.push(command.length > 160 ? `${command.slice(0, 157)}...` : command);
      else if (isShellSearch(command)) shellSearch++;
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
 * Run record: transcript metrics + who/what + the coordinator's card.
 * Violations: any graft use in an OFF run; in an ON run deviations are kept, and more than `MAX_DEVIATIONS` make the
 * run non-compliant (reported, not counted in the verdict).
 */
export function buildRun({ change, group, mode, agent, metrics, card }) {
  const violations = [];
  if (mode === "off" && metrics.tool_calls.graft > 0) violations.push("graft used in an OFF run");
  const { deviations, ...rest } = metrics;
  return {
    format: RUN_FORMAT,
    change,
    group,
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
    deviations: runs.reduce((a, r) => a + (r.deviations?.length ?? 0), 0),
  };
}

const delta = (on, off) => (on === null || off === null || off === 0 ? null : Math.round(((on - off) / off) * 1000) / 10);

/**
 * Verdict by ADR-0026 §4: accept when both arms have ≥ 2 counted runs (ON — compliant only), the ON median of total
 * tokens or tool calls is ≥ 20 % lower than OFF, ON has no more red runs, no ON run was misled into an error and no
 * run broke the rules. `missing` — groups closed in tasks.md without a record (see `closedGroups`).
 */
export function buildReport(runs, { minPerMode = 2, threshold = -20, missing = [] } = {}) {
  const nonCompliant = runs.filter((r) => r.mode === "on" && r.compliant === false);
  const on = summarize(runs.filter((r) => r.mode === "on" && r.compliant !== false));
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
    reasons.push(`need ≥ ${minPerMode} counted runs per arm (on=${on.n}, off=${off.n})`);
  } else {
    const cheaper = (d.tokens_total_pct !== null && d.tokens_total_pct <= threshold) || (d.tool_calls_pct !== null && d.tool_calls_pct <= threshold);
    if (!cheaper) reasons.push(`neither tokens (${d.tokens_total_pct}%) nor tool calls (${d.tool_calls_pct}%) are ≤ ${threshold}%`);
    if (on.red_runs > off.red_runs) reasons.push(`more red runs with graft (${on.red_runs} > ${off.red_runs})`);
    if (on.misled > 0) reasons.push(`graft misled ${on.misled} run(s)`);
    if (on.violations + off.violations > 0) reasons.push(`${on.violations + off.violations} rule violation(s)`);
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
