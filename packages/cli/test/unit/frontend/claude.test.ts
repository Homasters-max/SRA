/**
 * Adapter `claude` (REQ-ENF-005, design phase-4a §7, task 8.1) on synthetic
 * hook input in the form of the Claude Code hooks documentation — the
 * contract on recorded input is task 8.3 (ADR-0034 п. 2). The native input as
 * the normalised event: `Edit` / `Write` → `file_path`, `NotebookEdit` →
 * `notebook_path`, `Bash` → the words of `command`, any other tool `other`;
 * the decision as the native answer: `deny` with the reason and the hints,
 * `allow` never with `permissionDecision`, the hints in `additionalContext`.
 */
import { describe, expect, it } from "vitest";

import { claudeFrontend } from "../../../src/adapters/frontend/claude.js";
import type { GuardEvent } from "../../../src/core/ports/frontend.js";

const CWD = "/home/user/project";

/** A hook input as the documentation shows it: the common keys, then those of the tool. */
function hookInput(event: "PreToolUse" | "PostToolUse", tool: string, toolInput: Record<string, unknown>): Record<string, unknown> {
  return {
    session_id: "abc123",
    transcript_path: "/home/user/.claude/projects/project/abc123.jsonl",
    cwd: CWD,
    permission_mode: "default",
    hook_event_name: event,
    tool_name: tool,
    tool_input: toolInput,
    ...(event === "PostToolUse" ? { tool_response: { success: true } } : {}),
    tool_use_id: "toolu_01ABC"
  };
}

const { toEvent, respond } = claudeFrontend;

describe("adapter claude: native input → event", () => {
  it("Edit and Write edit file_path, NotebookEdit notebook_path", () => {
    expect(toEvent(hookInput("PreToolUse", "Edit", { file_path: `${CWD}/src/app.py`, old_string: "a", new_string: "b" }))).toEqual({
      phase: "pre",
      action: "edit",
      paths: [`${CWD}/src/app.py`],
      cwd: CWD
    });
    expect(toEvent(hookInput("PostToolUse", "Write", { file_path: "src/new.py", content: "x = 1\n" }))).toEqual({
      phase: "post",
      action: "edit",
      paths: ["src/new.py"],
      cwd: CWD
    });
    expect(toEvent(hookInput("PostToolUse", "NotebookEdit", { notebook_path: `${CWD}/nb/a.ipynb`, new_source: "print(1)" }))).toEqual({
      phase: "post",
      action: "edit",
      paths: [`${CWD}/nb/a.ipynb`],
      cwd: CWD
    });
  });

  it("Bash: the words of command by the tokenizer of guard", () => {
    expect(toEvent(hookInput("PreToolUse", "Bash", { command: `cd src && pytest -q "tests/a b"`, description: "run tests" }))).toEqual({
      phase: "pre",
      action: "shell",
      paths: [],
      argv: ["cd", "src", "&&", "pytest", "-q", "tests/a b"],
      cwd: CWD
    });
  });

  it("any other tool is other", () => {
    expect(toEvent(hookInput("PreToolUse", "Read", { file_path: `${CWD}/src/app.py` }))).toEqual({ phase: "pre", action: "other", paths: [], cwd: CWD });
  });

  it("an input it does not read: undefined", () => {
    const edit = hookInput("PreToolUse", "Edit", { file_path: "src/app.py" });
    for (const broken of [
      null,
      [],
      "text",
      { ...edit, hook_event_name: "UserPromptSubmit" },
      { ...edit, hook_event_name: undefined },
      { ...edit, tool_name: 1 },
      { ...edit, tool_input: "src/app.py" },
      { ...edit, cwd: "" },
      hookInput("PreToolUse", "Edit", { old_string: "a" }),
      hookInput("PreToolUse", "NotebookEdit", { file_path: "nb/a.ipynb" }),
      hookInput("PreToolUse", "Bash", { command: ["ls"] }),
      { ...edit, hook_event_name: "toString" }
    ]) {
      expect(toEvent(broken), JSON.stringify(broken)).toBeUndefined();
    }
  });
});

describe("adapter claude: decision → native answer", () => {
  const pre: GuardEvent = { phase: "pre", action: "edit", paths: ["docs/a.md"], cwd: CWD };
  const post: GuardEvent = { ...pre, phase: "post" };

  it("deny: permissionDecision deny, the reason and the hints in permissionDecisionReason, exit 0", () => {
    const answer = respond({ decision: "deny", reason: "docs/a.md is outside write_scope", hints: ["run `warrant run start`"] }, pre);
    expect(answer.exit).toBe(0);
    expect(answer.stdout.endsWith("\n")).toBe(true);
    expect(JSON.parse(answer.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "docs/a.md is outside write_scope\nrun `warrant run start`"
      }
    });
  });

  it("allow never names permissionDecision: the hints in additionalContext, nothing without hints", () => {
    const hinted = respond({ decision: "allow", hints: ["NOT_CANONICAL a.json: x — run `warrant fmt`", "rule r: text"] }, post);
    expect(JSON.parse(hinted.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "NOT_CANONICAL a.json: x — run `warrant fmt`\nrule r: text" }
    });
    expect(JSON.parse(respond({ decision: "allow", hints: ["start a Run first"] }, pre).stdout)).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "start a Run first" }
    });
    expect(respond({ decision: "allow", hints: [] }, pre)).toEqual({ stdout: "", exit: 0 });
    expect(hinted.stdout).not.toContain("permissionDecision");
  });
});
