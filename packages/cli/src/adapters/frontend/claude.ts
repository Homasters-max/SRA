/**
 * Adapter `claude` of the port of guard (REQ-ENF-005, ADR-0034 п. 1, 2, design
 * phase-4a §7): the stdin of a Claude Code hook `PreToolUse` / `PostToolUse`
 * as the normalised event, and guard's decision as the hook's JSON answer.
 * Translation only — the decision is `core/guard`'s.
 *
 * Input: `hook_event_name`, `tool_name`, `tool_input`, `cwd` (other keys —
 * `session_id`, `transcript_path`, `tool_response`… — are ignored). `Edit` and
 * `Write` edit `tool_input.file_path`, `NotebookEdit` — `tool_input.notebook_path`;
 * `Bash` runs `tool_input.command`, its words by the tokenizer of guard (§6);
 * any other tool is `other`.
 *
 * Answer: `deny` — `hookSpecificOutput.permissionDecision: "deny"` with
 * `permissionDecisionReason` of the reason and the hints; `allow` — never
 * `permissionDecision` (an `allow` would bypass the permission system of
 * Claude Code, SCN-ENF-019); the hints of `PostToolUse` in `additionalContext`,
 * stdout empty without hints. `PreToolUse` on `allow` answers nothing: its
 * `additionalContext` reaches the model only with the result of the tool
 * (probe of 2.1.263, I-165) — guard gives the hint of `pre` again in `post`.
 */
import { isPlainObject } from "../../core/json.js";
import type { FrontendAdapter, FrontendResponse, GuardEvent, GuardPhase, GuardResult } from "../../core/ports/frontend.js";
import { shellWords } from "../../core/shell.js";

/** `hook_event_name` of the hooks `warrant sync` registers (F19), and back. */
const PHASE_OF: Readonly<Record<string, GuardPhase>> = { PreToolUse: "pre", PostToolUse: "post" };
const HOOK_OF: Readonly<Record<GuardPhase, string>> = { pre: "PreToolUse", post: "PostToolUse" };

/** Tools that edit a file, and the key of `tool_input` that names it. */
const EDIT_PATH_KEY: Readonly<Record<string, string>> = { Edit: "file_path", Write: "file_path", NotebookEdit: "notebook_path" };

/** A non-empty string of `record[key]`, or `undefined`. */
function text(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function toEvent(native: unknown): GuardEvent | undefined {
  if (!isPlainObject(native)) return undefined;
  const hook = text(native, "hook_event_name");
  const phase = hook !== undefined && Object.hasOwn(PHASE_OF, hook) ? PHASE_OF[hook] : undefined;
  const tool = text(native, "tool_name");
  const input = native["tool_input"];
  const cwd = text(native, "cwd");
  if (phase === undefined || tool === undefined || !isPlainObject(input) || cwd === undefined) return undefined;

  if (Object.hasOwn(EDIT_PATH_KEY, tool)) {
    const file = text(input, EDIT_PATH_KEY[tool] as string);
    return file === undefined ? undefined : { phase, action: "edit", paths: [file], cwd };
  }
  if (tool === "Bash") {
    const command = input["command"];
    return typeof command === "string" ? { phase, action: "shell", paths: [], argv: shellWords(command), cwd } : undefined;
  }
  return { phase, action: "other", paths: [], cwd };
}

function respond(result: GuardResult, event: GuardEvent): FrontendResponse {
  const hookEventName = HOOK_OF[event.phase];
  let output: Record<string, string> | undefined;
  if (result.decision === "deny" && event.phase === "pre") {
    const reason = [result.reason ?? "denied by warrant guard", ...result.hints].join("\n");
    output = { hookEventName, permissionDecision: "deny", permissionDecisionReason: reason };
  } else if (event.phase === "post") {
    const context = [...(result.reason === undefined ? [] : [result.reason]), ...result.hints];
    if (context.length > 0) output = { hookEventName, additionalContext: context.join("\n") };
  }
  return { stdout: output === undefined ? "" : `${JSON.stringify({ hookSpecificOutput: output })}\n`, exit: 0 };
}

export const claudeFrontend: FrontendAdapter = {
  name: "claude",
  input: "a Claude Code hook input: hook_event_name PreToolUse | PostToolUse, tool_name, tool_input (file_path, notebook_path or command), cwd",
  toEvent,
  respond
};
