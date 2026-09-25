/**
 * Contract of the adapter `claude` on the RECORDED stdin of the Claude Code
 * hooks (REQ-ENF-005, ADR-0034 п. 2, design phase-4a §7, task 8.3): for every
 * version under `test/contract/fixtures/claude/`, the native input the real
 * `PreToolUse` / `PostToolUse` hooks gave reads as the event of its tool, and
 * guard's decision on it comes back as the native answer — SCN-ENF-017…019,
 * 021. A real `claude` does not run in CI (no subscription, no API key): the
 * fixtures are its record, rewritten by `scripts/dev/probe-hooks.js` when
 * Claude Code changes; a changed form of the input fails here. The fixture's
 * `cwd` and the paths of its tool move into the test project
 * (`recordedInputIn`); the fixtures are not edited.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";

import { claudeFrontend } from "../../src/adapters/frontend/claude.js";
import { runGuardFrontend } from "../../src/commands/guard.js";
import { runStart } from "../../src/commands/run.js";
import type { FrontendResponse } from "../../src/core/ports/frontend.js";
import { invoke } from "../app/helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../app/helpers/project-builder.js";
import { recordedHook, recordedInputIn, recordedVersions } from "../helpers/claude-hooks.js";
import { CORE_SDD_RANGE } from "../helpers/cli.js";

const project = useProjectBuilder();

/** No `WARRANT_STATE_DIR`: `<state>` is `.warrant` of the project. */
const ENV: NodeJS.ProcessEnv = {};
const RULE_TEXT = "Clear the outputs of a notebook before the commit.";

/** What the probe scenario edited and ran (`scripts/dev/probe-hooks-lib.js`). */
const NOTES = "notes/a.txt";
const NOTEBOOK = "nb.ipynb";
const BASH = ["echo", "probe-bash"];

/**
 * `demo` in `IMPLEMENTING` with `paths.src: <src>`, a rule on notebooks and an
 * exclusive check whose default prefix is `echo` (the command of the probe).
 */
async function repo(src = "src"): Promise<ProjectBuilder> {
  return project()
    .write(".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { "core-sdd": { version: CORE_SDD_RANGE } },
      paths: { src, tests: "tests" },
      roles: { maintainer: ["kat"] }
    })
    .write(".warrant/local/rules/notebooks.json", { $schema: "warrant://rule/1", id: "notebooks", paths: ["**/*.ipynb"], text: RULE_TEXT })
    .write(".warrant/local/checks/slow.json", {
      $schema: "warrant://check/1",
      id: "slow",
      version: "1.0.0",
      level: "L1",
      run: { command: ["echo", "{out}"] },
      execution: { exclusive: true },
      produces: ["test-report"],
      parser: "junit"
    })
    .withRecord("demo", "IMPLEMENTING")
    .withChange("demo", { tasks: "## 1. Demo\n\n- [ ] 1.1 Demo\n" })
    .synced();
}

async function started(p: ProjectBuilder): Promise<string> {
  const run = await invoke(() => runStart(p.ctx, "demo", { operation: "implement" }, ENV));
  expect(run.errors).toEqual([]);
  return run.data["run"] as string;
}

/** The hook answer of the recorded input `name` of `version`, moved into `p` (the file of the tool at `rel`). */
function answer(p: ProjectBuilder, version: string, name: string, rel?: string): Promise<FrontendResponse> {
  return runGuardFrontend(p.ctx, claudeFrontend, recordedInputIn(recordedHook(version, name), p.root, rel), ENV);
}

function output(response: FrontendResponse): Record<string, string> {
  expect(response.exit).toBe(0);
  return (JSON.parse(response.stdout) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput;
}

const versions = recordedVersions();

it("fixtures are recorded for at least one version of Claude Code", () => {
  expect(versions.length).toBeGreaterThan(0);
});

describe.each(versions)("adapter claude on the recorded input of Claude Code %s", (version) => {
  it("every recorded input reads as the event of its tool: Edit, Write, NotebookEdit edit their file, Bash runs its words", () => {
    const root = path.resolve("/project");
    const expected: Record<string, { action: string; paths: string[]; argv?: string[] }> = {
      edit: { action: "edit", paths: [path.join(root, ...NOTES.split("/"))] },
      write: { action: "edit", paths: [path.join(root, ...NOTES.split("/"))] },
      "notebook-edit": { action: "edit", paths: [path.join(root, NOTEBOOK)] },
      bash: { action: "shell", paths: [], argv: BASH }
    };
    for (const [tool, event] of Object.entries(expected)) {
      for (const phase of ["pre", "post"] as const) {
        const native = JSON.parse(recordedInputIn(recordedHook(version, `${phase}-${tool}`), root)) as unknown;
        expect(claudeFrontend.toEvent(native), `${phase}-${tool}`).toEqual({ phase, ...event, cwd: root });
      }
    }
  });

  it("PreToolUse Edit outside the write_scope of the active Run: permissionDecision deny naming the path, exit 0 (SCN-ENF-017)", async () => {
    const p = await repo();
    await started(p);
    const denied = output(await answer(p, version, "pre-edit"));
    expect(denied["hookEventName"]).toBe("PreToolUse");
    expect(denied["permissionDecision"]).toBe("deny");
    expect(denied["permissionDecisionReason"]).toContain(NOTES);
    expect(denied["permissionDecisionReason"]).toContain("write_scope");
  });

  it("PostToolUse NotebookEdit of a file under a rule not yet shown: the rule text in additionalContext, no permissionDecision (SCN-ENF-018)", async () => {
    const p = await repo();
    await started(p);
    const hinted = output(await answer(p, version, "post-notebook-edit", "src/nb.ipynb"));
    expect(hinted["hookEventName"]).toBe("PostToolUse");
    expect(hinted["additionalContext"]).toContain(`rule notebooks: ${RULE_TEXT}`);
    expect(hinted).not.toHaveProperty("permissionDecision");
    // Shown once per Run.
    expect(await answer(p, version, "post-notebook-edit", "src/nb.ipynb")).toEqual({ stdout: "", exit: 0 });
  });

  it("PreToolUse Write inside write_scope: no permissionDecision allow, the answer is empty (SCN-ENF-019)", async () => {
    const p = await repo("notes");
    await started(p);
    for (const name of ["pre-write", "pre-edit", "pre-notebook-edit"]) {
      const allowed = await answer(p, version, name, name === "pre-notebook-edit" ? "notes/nb.ipynb" : undefined);
      expect(allowed, name).toEqual({ stdout: "", exit: 0 });
    }
  });

  it("without a Run: PreToolUse Write of a path outside code is allowed silently, PostToolUse brings the hint run start (I-165)", async () => {
    const p = await repo();
    expect(await answer(p, version, "pre-write")).toEqual({ stdout: "", exit: 0 });
    expect(output(await answer(p, version, "post-write"))["additionalContext"]).toContain("warrant run start <change> --operation");
    const code = output(await answer(p, version, "pre-write", "src/a.txt"));
    expect(code["permissionDecision"]).toBe("deny");
    expect(code["permissionDecisionReason"]).toContain("warrant run start");
  });

  it("PreToolUse Bash of the prefix of an exclusive check: deny with warrant check; PostToolUse Bash answers nothing", async () => {
    const p = await repo();
    await started(p);
    const denied = output(await answer(p, version, "pre-bash"));
    expect(denied["permissionDecision"]).toBe("deny");
    expect(denied["permissionDecisionReason"]).toContain("warrant check demo slow");
    expect(await answer(p, version, "post-bash")).toEqual({ stdout: "", exit: 0 });
  });

  it("an input that does not read — not JSON, a cut record, a record without tool_input: exit 2, the reason on stderr, stdout empty (SCN-ENF-021)", async () => {
    const p = await repo();
    const text = recordedInputIn(recordedHook(version, "pre-edit"), p.root);
    const { tool_input: _input, ...withoutInput } = JSON.parse(text) as Record<string, unknown>;
    for (const input of ["not json", text.slice(0, text.length / 2), JSON.stringify(withoutInput)]) {
      expect(await runGuardFrontend(p.ctx, claudeFrontend, input, ENV)).toEqual({ stdout: "", exit: 2 });
    }
    expect(p.warnings).toEqual([
      expect.stringMatching(/^warrant guard --frontend claude: stdin is not JSON: /),
      expect.stringMatching(/^warrant guard --frontend claude: stdin is not JSON: /),
      expect.stringMatching(/^warrant guard --frontend claude: stdin is not a Claude Code hook input/)
    ]);
  });
});
