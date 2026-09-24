/**
 * Decision logic of the code-search hook `scripts/dev/cs-hook.js` (D-3): what to tell a subagent when it starts, and
 * what to warn about after one of its tool calls. Pure — the IO (repo root, file line counts, `cs map`) is injected, so
 * unit tests need no process. The detector is `deviationsOf` of graft-metrics-lib.js — the same one the metrics use.
 * Warn only: the hook never blocks a call.
 */
import { deviationsOf } from "./graft-metrics-lib.js";

/** Agent types that never touch the repo's code. */
export const SKIP_AGENT_TYPES = new Set(["claude-code-guide", "statusline-setup"]);
/** Tools the post-tool check looks at. */
export const CHECKED_TOOLS = new Set(["Read", "Grep", "Glob", "Bash", "PowerShell"]);
/** Upper bound of the post-tool warning. */
export const MAX_WARNING_CHARS = 600;

export const START_TEXT = [
  "Code of this repo (packages/**, scripts/** .ts/.js) is searched only via the code-search skill (.claude/skills/code-search/SKILL.md): read it before touching code.",
  "Before changing a signature/export: `node scripts/dev/cs.js impact <symbol>`.",
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
 * Hook response for `event` (`subagent-start` | `post-tool`) and the hook input JSON, or null (print nothing).
 * `io`: `env` — process env (CLAUDE_PROJECT_DIR); `findRoot(dir)` — work-tree root containing `dir` or null;
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

  if (event === "post-tool") {
    if (!input.agent_id || !CHECKED_TOOLS.has(input.tool_name)) return null;
    const cwd = posix(input.cwd || root);
    const response = input.tool_response;
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
    const block = { type: "tool_use", name: input.tool_name, input: input.tool_input ?? {} };
    const found = deviationsOf(block, { result: responseText(input.tool_name, response), cwd, root, fileLines });
    if (found.length === 0) return null;
    let text = [...new Set(found.map(adviceFor))].join("\n");
    if (text.length > MAX_WARNING_CHARS) text = `${text.slice(0, MAX_WARNING_CHARS - 1)}…`;
    return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } };
  }
  return null;
}
