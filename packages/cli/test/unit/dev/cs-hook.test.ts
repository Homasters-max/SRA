/**
 * Code-search hook (D-3): `scripts/dev/cs-hook-lib.js` decides what a subagent is told at start (the rule + `cs map`)
 * and what it is warned about after a tool call — with the same detector as the metrics, IO injected, never blocking,
 * inert outside a repo with scripts/dev/cs.js and for the main session.
 */
import { describe, expect, it } from "vitest";

import { adviceFor, hookResponse, MAX_WARNING_CHARS, START_TEXT } from "../../../../../scripts/dev/cs-hook-lib.js";

const ROOT = "D:/project/SRA";
const WIN_ROOT = String.raw`D:\project\SRA`;

type Io = Parameters<typeof hookResponse>[2];

function io(over: Partial<Record<string, unknown>> = {}): Io {
  return {
    env: { CLAUDE_PROJECT_DIR: ROOT },
    findRoot: (dir: string) => (dir.replace(/\\/g, "/").toLowerCase().startsWith(ROOT.toLowerCase()) ? WIN_ROOT : null),
    exists: (p: string) => p === `${ROOT}/scripts/dev/cs.js`,
    csMap: () => "repo map — 3 files\n## packages/cli/\n",
    fileLines: () => null,
    ...over,
  } as Io;
}

const post = (tool_name: string, tool_input: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  session_id: "s",
  agent_id: "a1",
  cwd: WIN_ROOT,
  hook_event_name: "PostToolUse",
  tool_name,
  tool_input,
  tool_response: {},
  ...extra,
});

const context = (res: unknown) => (res as { hookSpecificOutput: { additionalContext: string } } | null)?.hookSpecificOutput.additionalContext;

describe("cs-hook: subagent-start", () => {
  it("gives the rule and the cs map to a subagent", () => {
    const res = hookResponse("subagent-start", { agent_id: "a2", agent_type: "general-purpose", cwd: WIN_ROOT }, io());
    expect(res).toEqual({
      hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: `${START_TEXT}\n\nrepo map — 3 files\n## packages/cli/` },
    });
    expect(START_TEXT.split("\n").length).toBeLessThanOrEqual(4);
    expect(START_TEXT).toContain(".claude/skills/code-search/SKILL.md");
    expect(START_TEXT).toContain("node scripts/dev/cs.js impact <symbol>");
  });

  it("omits the map when cs map fails, never fails itself", () => {
    const failing = io({
      csMap: () => {
        throw new Error("timeout");
      },
    });
    expect(context(hookResponse("subagent-start", { agent_type: "Explore", cwd: WIN_ROOT }, failing))).toBe(START_TEXT);
    expect(context(hookResponse("subagent-start", { agent_type: "Explore", cwd: WIN_ROOT }, io({ csMap: () => null })))).toBe(START_TEXT);
  });

  it("skips agents that never touch code and repos without scripts/dev/cs.js", () => {
    expect(hookResponse("subagent-start", { agent_type: "claude-code-guide", cwd: WIN_ROOT }, io())).toBeNull();
    expect(hookResponse("subagent-start", { agent_type: "statusline-setup", cwd: WIN_ROOT }, io())).toBeNull();
    expect(hookResponse("subagent-start", { agent_type: "general-purpose", cwd: "D:/other" }, io({ env: {} }))).toBeNull();
    expect(hookResponse("subagent-start", { agent_type: "general-purpose", cwd: WIN_ROOT }, io({ exists: () => false }))).toBeNull();
  });

  it("falls back to CLAUDE_PROJECT_DIR when the input cwd is outside the repo", () => {
    expect(context(hookResponse("subagent-start", { agent_type: "general-purpose", cwd: "C:/tmp" }, io()))).toContain(START_TEXT);
  });
});

describe("cs-hook: post-tool", () => {
  it("says nothing for the main session (no agent_id), unknown tools or events, and bad input", () => {
    const { agent_id: _, ...main } = post("Grep", { pattern: "x" });
    expect(hookResponse("post-tool", main, io())).toBeNull();
    expect(hookResponse("post-tool", post("Edit", { file_path: `${ROOT}/packages/cli/src/a.ts` }), io())).toBeNull();
    expect(hookResponse("other-event", post("Grep", { pattern: "x" }), io())).toBeNull();
    expect(hookResponse("post-tool", null, io())).toBeNull();
    expect(hookResponse("post-tool", post("Grep", { pattern: "x" }), io({ exists: () => false }))).toBeNull();
  });

  it("warns about a Grep over the repo root with rule and remedy (Windows cwd)", () => {
    const res = hookResponse("post-tool", post("Grep", { pattern: "deviationsOf" }), io());
    expect(res).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: 'code-search: rule 1 — Grep tool over code → `node scripts/dev/cs.js grep "<name>"` (place unknown: `cs ask "<where X>" --source`)',
      },
    });
  });

  it("D-8: a Read range covering the file on disk is a whole read; a short file or a real range is not", () => {
    const file = String.raw`D:\project\SRA\packages\cli\src\core\lock.ts`;
    const lines = (n: number) => io({ fileLines: () => n });
    expect(context(hookResponse("post-tool", post("Read", { file_path: file, offset: 1, limit: 120 }), lines(110)))).toBe(
      "code-search: rule 2 — whole code file read (core/lock.ts) → `cs skeleton <file>` then Read offset/limit of the lines you need",
    );
    expect(hookResponse("post-tool", post("Read", { file_path: file, offset: 1, limit: 50 }), lines(110))).toBeNull();
    expect(hookResponse("post-tool", post("Read", { file_path: file }), lines(30))).toBeNull();
    // Read's own response carries the file length
    const withTotal = post("Read", { file_path: file, offset: 1, limit: 300 }, { tool_response: { type: "text", file: { filePath: file, totalLines: 250 } } });
    expect(context(hookResponse("post-tool", withTotal, io()))).toContain("rule 2");
  });

  it("joins Git Bash paths with the call's cwd before counting lines", () => {
    const seen: string[] = [];
    const res = hookResponse(
      "post-tool",
      post("Bash", { command: "cd /d/project/SRA/packages/cli && head -300 src/a.ts" }, { tool_response: { stdout: "x\n".repeat(280), stderr: "" } }),
      io({ fileLines: (p: string) => (seen.push(p), 280) }),
    );
    expect(seen).toEqual(["/d/project/SRA/packages/cli/src/a.ts"]);
    expect(context(res)).toContain("code-search: rule 2 — whole code file printed by the shell");
  });

  it("warns about cs output cut with head and several deviations at once, within the size cap", () => {
    const res = hookResponse("post-tool", post("Bash", { command: "node scripts/dev/cs.js grep foo | head -5; grep -rn foo packages; git grep bar" }), io());
    const text = context(res) ?? "";
    expect(text.split("\n")).toEqual([
      "code-search: rule 5 — cs output cut with head/tail → don't truncate cs output — it is already bounded and says what it dropped",
      'code-search: rule 1 — grep/rg/Select-String over code → `node scripts/dev/cs.js grep "<name>"` (place unknown: `cs ask "<where X>" --source`)',
    ]);
    expect(text.length).toBeLessThanOrEqual(MAX_WARNING_CHARS);
    const many = hookResponse("post-tool", post("Bash", { command: "graft ask a; graft grep b; graft callers c; graft skeleton d; graft map e" }), io());
    expect((context(many) ?? "").length).toBeLessThanOrEqual(MAX_WARNING_CHARS);
  });

  it("handles PowerShell and stays quiet on clean calls", () => {
    expect(context(hookResponse("post-tool", post("PowerShell", { command: String.raw`Select-String -Path packages\cli\src\*.ts -Pattern foo` }), io()))).toContain("rule 1");
    for (const [tool, input] of [
      ["Bash", { command: "node scripts/dev/cs.js skeleton packages/cli/src/a.ts" }],
      ["Bash", { command: 'git commit -m "graft ask | head"' }],
      ["Glob", { pattern: "packages/**/*.ts" }],
      ["Grep", { pattern: "x", path: "docs" }],
      ["Read", { file_path: `${ROOT}/docs/adr/README.md` }],
    ] as const) {
      expect(hookResponse("post-tool", post(tool, input), io()), JSON.stringify(input)).toBeNull();
    }
  });

  it("maps every deviation kind to a rule and a remedy", () => {
    expect(adviceFor("raw graft ask")).toBe("code-search: rule 1 — graft called directly (ask) → `node scripts/dev/cs.js <command>`");
    expect(adviceFor("whole read check/lock.ts")).toContain("rule 2 — whole code file read (check/lock.ts)");
    expect(adviceFor("shell whole read of code")).toContain("rule 2");
    expect(adviceFor("something new")).toBe("code-search: something new → see .claude/skills/code-search/SKILL.md");
  });
});
