/**
 * Decision logic of the code-search hook `scripts/dev/cs-hook.js` (D-3): what to tell a subagent when it starts, which
 * of its tool calls to deny before they run, and what to warn about after one ran. Pure — the IO (work-tree roots, file
 * line counts, `cs map`) is injected, so unit tests need no process. The detector is `deviationsOf` of
 * graft-metrics-lib.js — the same one the metrics use.
 *
 * ADR-0031: a subagent's call that the detector flags from its input alone is denied (`PreToolUse`,
 * `permissionDecision: "deny"`, the reason — what to do instead); what shows only in a call's output stays a
 * `PostToolUse` warning. The main session (no `agent_id`) is never checked.
 */
import { deviationsOf } from "./graft-metrics-lib.js";

/** Agent types that never touch the repo's code. */
export const SKIP_AGENT_TYPES = new Set(["claude-code-guide", "statusline-setup"]);
/** Tools the pre- and post-tool checks look at. */
export const CHECKED_TOOLS = new Set(["Read", "Grep", "Glob", "Bash", "PowerShell"]);
/** Upper bound of a warning or a deny reason. */
export const MAX_WARNING_CHARS = 600;

export const START_TEXT = [
  "Code of this repo (packages/**, scripts/** .ts/.js) is searched only via the code-search skill (.claude/skills/code-search/SKILL.md): read it before touching code.",
  "Before changing a signature/export: `node scripts/dev/cs.js impact <symbol>`.",
  "A call that breaks the skill (Grep/grep over code, a whole code file read, cs output cut) is denied by a hook: do what the denial says instead.",
].join("\n");

/** Deviation (graft-metrics-lib wording) → rule, what happened, what to do instead. */
const ADVICE = [
  [/^raw graft (.+)$/, 1, (m) => `graft called directly (${m[1]})`, "`node scripts/dev/cs.js <command>`"],
  [/^Grep over code$/, 1, () => "Grep tool over code", '`node scripts/dev/cs.js grep "<name>"` (place unknown: `cs ask "<where X>" --source`)'],
  [/^shell search over code$/, 1, () => "grep/rg/Select-String over code", '`node scripts/dev/cs.js grep "<name>"` (place unknown: `cs ask "<where X>" --source`)'],
  [/^whole read (.+?)(?: via range)?$/, 2, (m) => `whole code file read (${m[1]})`, "`cs skeleton <file>` then Read offset/limit of the lines you need"],
  [/^shell whole read of code$/, 2, () => "whole code file printed by the shell", "`cs skeleton <file>` then `sed -n a,bp` / Read offset/limit of the lines you need"],
  [/^cs output truncated$/, 5, () => "cs output cut with head/tail", "don't truncate cs output — it is already bounded and says what it dropped"],
];

/** One warning line: `code-search: rule N — <what> → <what to do instead>`. */
export function adviceFor(deviation) {
  for (const [re, rule, what, instead] of ADVICE) {
    const m = re.exec(deviation);
    if (m) return `code-search: rule ${rule} — ${what(m)} → ${instead}`;
  }
  return `code-search: ${deviation} → see .claude/skills/code-search/SKILL.md`;
}

const posix = (p) => String(p ?? "").replace(/\\/g, "/");

/** Text of a tool response for the detector: a command's output; none for Read (its content has no line numbers). */
function responseText(toolName, response) {
  if (toolName !== "Bash" && toolName !== "PowerShell") return undefined;
  if (typeof response === "string") return response;
  if (response && typeof response === "object") {
    const out = response.stdout ?? response.output;
    return typeof out === "string" ? out : undefined;
  }
  return undefined;
}

/**
 * Hook response for `event` (`subagent-start` | `pre-tool` | `post-tool`) and the hook input JSON, or null (print
 * nothing). `pre-tool` — deny with the advice as the reason; `post-tool` — the advice as a warning, for what only the
 * output shows (a read that stopped short of its range). Both only for a subagent (`agent_id`).
 * `io`: `env` — process env (CLAUDE_PROJECT_DIR); `findRoot(path)` — work-tree root containing `path` or null;
 * `exists(path)`; `csMap(root)` — output of `cs map` or null; `fileLines(absPath)` — line count or null.
 * Inert (null) when no root with scripts/dev/cs.js is found — other repos and worktrees without cs.
 */
export function hookResponse(event, input, io) {
  if (!input || typeof input !== "object") return null;
  const starts = [input.cwd, io.env?.CLAUDE_PROJECT_DIR].filter((d) => typeof d === "string" && d !== "");
  let root = null;
  for (const dir of starts) {
    const r = io.findRoot(dir);
    if (r && io.exists(`${posix(r)}/scripts/dev/cs.js`)) {
      root = posix(r);
      break;
    }
  }
  if (!root) return null;

  if (event === "subagent-start") {
    if (SKIP_AGENT_TYPES.has(input.agent_type)) return null;
    let map = null;
    try {
      map = io.csMap(root);
    } catch {
      map = null;
    }
    const text = typeof map === "string" && map.trim() ? `${START_TEXT}\n\n${map.trim()}` : START_TEXT;
    return { hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: text } };
  }

  if (event !== "pre-tool" && event !== "post-tool") return null;
  if (!input.agent_id || !CHECKED_TOOLS.has(input.tool_name)) return null;
  const pre = event === "pre-tool";
  const cwd = posix(input.cwd || root);
  const response = pre ? undefined : input.tool_response;
  const total = input.tool_name === "Read" && typeof response?.file?.totalLines === "number" ? response.file.totalLines : null;
  const readFile = input.tool_name === "Read" ? posix(input.tool_input?.file_path) : null;
  const fileLines = (p) => {
    if (total !== null && posix(p).toLowerCase() === readFile?.toLowerCase()) return total;
    try {
      return io.fileLines(p);
    } catch {
      return null;
    }
  };
  // H-1: a path is code only inside a WARRANT work tree — the nearest `.git` above it, with scripts/dev/cs.js
  const rootOf = (p) => {
    try {
      const r = io.findRoot(p);
      return r && io.exists(`${posix(r)}/scripts/dev/cs.js`) ? posix(r) : null;
    } catch {
      return null;
    }
  };
  const block = { type: "tool_use", name: input.tool_name, input: input.tool_input ?? {} };
  const found = deviationsOf(block, { result: pre ? undefined : responseText(input.tool_name, response), cwd, root, rootOf, fileLines });
  if (found.length === 0) return null;
  let text = [...new Set(found.map(adviceFor))].join("\n");
  if (text.length > MAX_WARNING_CHARS) text = `${text.slice(0, MAX_WARNING_CHARS - 1)}…`;
  if (pre) return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: text } };
  return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } };
}
