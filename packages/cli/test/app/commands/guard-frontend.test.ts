/**
 * `warrant guard --frontend claude` in the test process (REQ-ENF-005, ADR-0034
 * п. 2, design phase-4a §7, §9, task 8.1): the adapter translates, guard
 * decides — the Run of native events names no frontend and holds the same
 * events as the normalised ones (SCN-ENF-020); a native input that does not
 * read is exit 2 with the reason on stderr and stdout empty (SCN-ENF-021). The
 * input is synthetic, in the form of the Claude Code documentation; the
 * contract on recorded input is task 8.3.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";

import { claudeFrontend } from "../../../src/adapters/frontend/claude.js";
import { runGuard, runGuardFrontend } from "../../../src/commands/guard.js";
import type { GuardEvent, GuardResult } from "../../../src/core/ports/frontend.js";
import { CORE_SDD_RANGE } from "../../helpers/cli.js";
import { invoke } from "../helpers/invoke.js";
import { started } from "../helpers/run.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";

const project = useProjectBuilder();

/** No `WARRANT_STATE_DIR`: `<state>` is `.warrant` of the project. */
const ENV: NodeJS.ProcessEnv = {};
const NOT_CANONICAL_AREAS = '{"$schema":"warrant://areas/1","KRN":{"capability":"kernel"},"SRC":{"capability":"search"}}\n';

/** `add-search` in `IMPLEMENTING` with `paths.src: src`, an exclusive check `tests`, a rule on `.warrant/**\/*.json`. */
async function repo(configure: (p: ProjectBuilder) => void = () => undefined): Promise<ProjectBuilder> {
  const p = project()
    .write(".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { "core-sdd": { version: CORE_SDD_RANGE } },
      paths: { src: "src", tests: "tests" },
      roles: { maintainer: ["kat"] }
    })
    .write(".warrant/local/checks/tests.json", {
      $schema: "warrant://check/1",
      id: "tests",
      version: "1.0.0",
      level: "L1",
      run: { command: ["pytest", "-q"] },
      execution: { exclusive: true },
      produces: ["test-report"],
      parser: "junit"
    })
    .write(".warrant/local/rules/json-canonical.json", {
      $schema: "warrant://rule/1",
      id: "json-canonical",
      paths: [".warrant/**/*.json"],
      text: "Write JSON only through warrant fmt."
    })
    .withRecord("add-search", "IMPLEMENTING")
    .withChange("add-search", { tasks: "## 1. Search\n\n- [ ] 1.1 Index\n" });
  configure(p);
  return p.synced();
}

/** A hook input in the form of the documentation. */
function hookInput(p: ProjectBuilder, event: "PreToolUse" | "PostToolUse", tool: string, toolInput: Record<string, unknown>): string {
  return JSON.stringify({
    session_id: "abc123",
    transcript_path: path.join(p.root, "transcript.jsonl"),
    cwd: p.root,
    permission_mode: "default",
    hook_event_name: event,
    tool_name: tool,
    tool_input: toolInput,
    ...(event === "PostToolUse" ? { tool_response: { success: true } } : {}),
    tool_use_id: "toolu_01ABC"
  });
}

function runText(p: ProjectBuilder, id: string): string {
  return p.read(`.warrant/runs/${id}.json`);
}

/** `text` with the Run id `id` as `RUN`: reasons name the Run. */
function sameRun(text: string, id: string): string {
  return text.split(id).join("RUN");
}

/** `guard_events[]` of a Run without `at`, the id as `RUN`: what two Runs of the same events share. */
function eventsOf(p: ProjectBuilder, id: string): unknown[] {
  const run = JSON.parse(sameRun(runText(p, id), id)) as { guard_events: Array<Record<string, unknown>> };
  return run.guard_events.map(({ at: _at, ...rest }) => rest);
}

describe("warrant guard --frontend claude: translation only", () => {
  it("the Run names no frontend; the same events in the normalised form give the same decisions (SCN-ENF-020)", async () => {
    const native = await repo();
    const normal = await repo();
    const nativeRun = await started(native);
    const normalRun = await started(normal);
    native.write(".warrant/local/areas.json", NOT_CANONICAL_AREAS);
    normal.write(".warrant/local/areas.json", NOT_CANONICAL_AREAS);

    const steps: Array<{ hook: "PreToolUse" | "PostToolUse"; tool: string; input: (root: string) => Record<string, unknown>; event: Omit<GuardEvent, "cwd"> }> = [
      { hook: "PreToolUse", tool: "Edit", input: (root) => ({ file_path: path.join(root, "docs", "readme.md"), old_string: "a", new_string: "b" }), event: { phase: "pre", action: "edit", paths: ["docs/readme.md"] } },
      { hook: "PreToolUse", tool: "Write", input: (root) => ({ file_path: path.join(root, "src", "app.py"), content: "x = 1\n" }), event: { phase: "pre", action: "edit", paths: ["src/app.py"] } },
      { hook: "PostToolUse", tool: "Write", input: (root) => ({ file_path: path.join(root, ".warrant", "local", "areas.json"), content: NOT_CANONICAL_AREAS }), event: { phase: "post", action: "edit", paths: [".warrant/local/areas.json"] } },
      { hook: "PostToolUse", tool: "NotebookEdit", input: () => ({ notebook_path: "src/nb.ipynb", new_source: "print(1)" }), event: { phase: "post", action: "edit", paths: ["src/nb.ipynb"] } },
      { hook: "PreToolUse", tool: "Bash", input: () => ({ command: 'bash -c "cd src && pytest tests/"' }), event: { phase: "pre", action: "shell", paths: [], argv: ["bash", "-c", "cd src && pytest tests/"] } },
      { hook: "PreToolUse", tool: "Read", input: (root) => ({ file_path: path.join(root, "src", "app.py") }), event: { phase: "pre", action: "other", paths: [] } }
    ];

    const decisions: string[] = [];
    for (const step of steps) {
      const answer = await runGuardFrontend(native.ctx, claudeFrontend, hookInput(native, step.hook, step.tool, step.input(native.root)), ENV);
      const event: GuardEvent = { ...step.event, cwd: normal.root };
      const result = await invoke(() => runGuard(normal.ctx, JSON.stringify(event), ENV));
      // The native answer is the adapter's answer to the decision on the normalised event.
      const expected = claudeFrontend.respond(result.data as unknown as GuardResult, event);
      expect({ ...answer, stdout: sameRun(answer.stdout, nativeRun) }, `${step.hook} ${step.tool}`).toEqual({
        ...expected,
        stdout: sameRun(expected.stdout, normalRun)
      });
      decisions.push(result.data["decision"] as string);
    }
    expect(decisions).toEqual(["deny", "allow", "allow", "allow", "deny", "allow"]);

    expect(runText(native, nativeRun)).not.toMatch(/claude/i);
    expect(eventsOf(native, nativeRun)).toEqual(eventsOf(normal, normalRun));
    expect(eventsOf(native, nativeRun)).toHaveLength(steps.length);
    expect(native.warnings).toEqual([]);
  });

  it("deny is permissionDecision deny naming the path; allow of a path inside write_scope names no permissionDecision", async () => {
    const p = await repo();
    await started(p);
    const denied = await runGuardFrontend(p.ctx, claudeFrontend, hookInput(p, "PreToolUse", "Edit", { file_path: "docs/readme.md", old_string: "a", new_string: "b" }), ENV);
    expect(denied.exit).toBe(0);
    const output = (JSON.parse(denied.stdout) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput;
    expect(output["hookEventName"]).toBe("PreToolUse");
    expect(output["permissionDecision"]).toBe("deny");
    expect(output["permissionDecisionReason"]).toContain("docs/readme.md");

    const allowed = await runGuardFrontend(p.ctx, claudeFrontend, hookInput(p, "PreToolUse", "Write", { file_path: "src/app.py", content: "" }), ENV);
    expect(allowed).toEqual({ stdout: "", exit: 0 });
  });
});

describe("warrant guard --frontend claude: input that does not read", () => {
  it("not JSON: exit 2, the reason on stderr, stdout empty (SCN-ENF-021)", async () => {
    const p = await repo();
    const id = await started(p);
    expect(await runGuardFrontend(p.ctx, claudeFrontend, "not json", ENV)).toEqual({ stdout: "", exit: 2 });
    expect(p.warnings).toEqual([expect.stringMatching(/^warrant guard --frontend claude: stdin is not JSON: /)]);
    expect(eventsOf(p, id)).toEqual([]);
  });

  it("JSON that is not a hook input the adapter reads: exit 2, stderr names what it expects", async () => {
    const p = await repo();
    const input = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { old_string: "a" }, cwd: p.root });
    expect(await runGuardFrontend(p.ctx, claudeFrontend, input, ENV)).toEqual({ stdout: "", exit: 2 });
    expect(p.warnings).toEqual([expect.stringContaining("stdin is not a Claude Code hook input: hook_event_name PreToolUse | PostToolUse")]);
  });

  it("outside a project under WARRANT nothing is read: allow, stdout empty, exit 0 (SCN-ENF-016)", async () => {
    const p = project().remove(".warrant/warrant.json");
    expect(await runGuardFrontend(p.ctx, claudeFrontend, "not json", ENV)).toEqual({ stdout: "", exit: 0 });
    expect(p.warnings).toEqual([]);
  });
});
