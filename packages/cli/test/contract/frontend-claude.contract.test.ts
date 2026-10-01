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
 *
 * The subagent `warrant-reviewer` (design phase-4b §6, task 6.3): versions whose
 * fixtures hold the Bash of a subagent (`agent-*.json`, probe of 2.1.283,
 * I-168) — its input reads as the main session's, and under a review Run guard
 * allows only `warrant run submit` with the envelope in a heredoc.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { claudeFrontend } from "../../src/adapters/frontend/claude.js";
import { runGuardFrontend } from "../../src/commands/guard.js";
import type { FrontendResponse } from "../../src/core/ports/frontend.js";
import { useProjectBuilder, type ProjectBuilder } from "../app/helpers/project-builder.js";
import { started } from "../app/helpers/run.js";
import { CLAUDE_FIXTURES, recordedHook, recordedInputIn, recordedVersions } from "../helpers/claude-hooks.js";
import { CLI_VERSION } from "../../src/version.js";
import { CORE_SDD_RANGE, CORE_SDD_VERSION } from "../helpers/cli.js";

const project = useProjectBuilder();

/** No `WARRANT_STATE_DIR`: `<state>` is `.warrant` of the project. */
const ENV: NodeJS.ProcessEnv = {};
const RULE_TEXT = "Clear the outputs of a notebook before the commit.";

/** What the probe scenario edited and ran (`scripts/dev/probe-hooks-lib.js`). */
const NOTES = "notes/a.txt";
const NOTEBOOK = "nb.ipynb";
const BASH = ["echo", "probe-bash"];

/**
 * `demo` in `state` (`IMPLEMENTING`) with `paths.src: <src>`, a rule on notebooks and an
 * exclusive check whose default prefix is `echo` (the command of the probe).
 */
async function repo(src = "src", state = "IMPLEMENTING"): Promise<ProjectBuilder> {
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
    .withRecord("demo", state)
    .withChange("demo", { tasks: "## 1. Demo\n\n- [ ] 1.1 Demo\n" })
    .synced();
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
    await started(p, "demo");
    const denied = output(await answer(p, version, "pre-edit"));
    expect(denied["hookEventName"]).toBe("PreToolUse");
    expect(denied["permissionDecision"]).toBe("deny");
    expect(denied["permissionDecisionReason"]).toContain(NOTES);
    expect(denied["permissionDecisionReason"]).toContain("write_scope");
  });

  it("PostToolUse NotebookEdit of a file under a rule not yet shown: the rule text in additionalContext, no permissionDecision (SCN-ENF-018)", async () => {
    const p = await repo();
    await started(p, "demo");
    const hinted = output(await answer(p, version, "post-notebook-edit", "src/nb.ipynb"));
    expect(hinted["hookEventName"]).toBe("PostToolUse");
    expect(hinted["additionalContext"]).toContain(`rule notebooks: ${RULE_TEXT}`);
    expect(hinted).not.toHaveProperty("permissionDecision");
    // Shown once per Run.
    expect(await answer(p, version, "post-notebook-edit", "src/nb.ipynb")).toEqual({ stdout: "", exit: 0 });
  });

  it("PreToolUse Write inside write_scope: no permissionDecision allow, the answer is empty (SCN-ENF-019)", async () => {
    const p = await repo("notes");
    await started(p, "demo");
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
    await started(p, "demo");
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

describe.each(versions)("adapter claude while the policy does not load, on the recorded input of Claude Code %s (ADR-0053 п. 2)", (version) => {
  it("Bash git status and Write of the pin pass silently, Edit of code is denied with the versions; PostToolUse of the pin brings sync (SCN-ENF-053)", async () => {
    const p = await repo();
    const [major, minor] = CORE_SDD_VERSION.split(".").map(Number) as [number, number];
    const pin = `^${major}.${minor - 1}.0`;
    const config = p.json(".warrant/warrant.json");
    p.write(".warrant/warrant.json", { ...config, packs: { "core-sdd": { version: pin } } });

    const bash = JSON.parse(recordedInputIn(recordedHook(version, "pre-bash"), p.root)) as { tool_input: Record<string, unknown> };
    bash.tool_input["command"] = "git status";
    expect(await runGuardFrontend(p.ctx, claudeFrontend, JSON.stringify(bash), ENV)).toEqual({ stdout: "", exit: 0 });
    expect(await answer(p, version, "pre-write", ".warrant/warrant.json")).toEqual({ stdout: "", exit: 0 });

    const denied = output(await answer(p, version, "pre-edit", "src/app.ts"));
    expect(denied["permissionDecision"]).toBe("deny");
    expect(denied["permissionDecisionReason"]).toContain(`CLI ${CLI_VERSION}`);
    expect(denied["permissionDecisionReason"]).toContain(pin);
    expect(denied["permissionDecisionReason"]).toContain("warrant sync");

    const after = output(await answer(p, version, "post-write", ".warrant/warrant.json"));
    expect(after["additionalContext"]).toContain("warrant sync");
    expect(after["additionalContext"]).not.toContain("warrant run start");
    expect(after).not.toHaveProperty("permissionDecision");
  });
});

/** Versions whose fixtures hold the subagent's Bash: the hook of its frontmatter (`agent-pre-bash*`) and of settings.json. */
const agentVersions = versions.filter((version) => existsSync(path.join(CLAUDE_FIXTURES, version, "agent-pre-bash-heredoc.json")));
const AGENT_INPUTS = ["agent-pre-bash", "agent-pre-bash-heredoc", "agent-pre-bash-deny", "agent-session-pre-bash"];

it("fixtures of a subagent are recorded for at least one version of Claude Code (I-168)", () => {
  expect(agentVersions.length).toBeGreaterThan(0);
});

describe.each(agentVersions)("adapter claude on the recorded input of a subagent of Claude Code %s (design phase-4b §6)", (version) => {
  /** `demo` in PROPOSED, its spec committed, the review Run of the subagent active. */
  async function underReview(): Promise<ProjectBuilder> {
    const p = await repo("src", "PROPOSED");
    p.commit("spec");
    await started(p, "demo", { operation: "review" });
    return p;
  }

  it("the input of the subagent differs by agent_id and agent_type only, and reads as the main session's; the heredoc body is data (I-167)", () => {
    const root = path.resolve("/project");
    const main = recordedHook(version, "pre-bash");
    for (const name of AGENT_INPUTS) {
      const recorded = recordedHook(version, name);
      expect(Object.keys(recorded).filter((key) => !(key in main)).sort(), name).toEqual(["agent_id", "agent_type"]);
      expect(Object.keys(main).filter((key) => !(key in recorded)), name).toEqual([]);
    }
    const event = (name: string): unknown => claudeFrontend.toEvent(JSON.parse(recordedInputIn(recordedHook(version, name), root)) as unknown);
    expect(event("agent-pre-bash")).toEqual({ phase: "pre", action: "shell", paths: [], argv: ["echo", "probe-agent-bash"], cwd: root });
    expect(event("agent-session-pre-bash")).toEqual(event("agent-pre-bash"));
    const heredoc = event("agent-pre-bash-heredoc") as { argv: string[] };
    expect(heredoc).toMatchObject({ phase: "pre", action: "shell", paths: [], cwd: root });
    expect(heredoc.argv[0]).toBe("cat");
    expect(heredoc.argv.join(" ")).not.toContain("probe-agent-heredoc");
  });

  it("under a review Run: warrant run submit with the envelope in a heredoc is allowed with an empty answer, any other Bash of the subagent is denied naming run submit", async () => {
    const p = await underReview();
    const recorded = JSON.parse(recordedInputIn(recordedHook(version, "agent-pre-bash-heredoc"), p.root)) as Record<string, any>;
    const command = String(recorded["tool_input"]["command"]);
    expect(command).toMatch(/^cat <<'JSON'\n/);
    const submit = { ...recorded, tool_input: { ...recorded["tool_input"], command: command.replace(/^cat /, "warrant run submit ") } };
    expect(await runGuardFrontend(p.ctx, claudeFrontend, JSON.stringify(submit), ENV)).toEqual({ stdout: "", exit: 0 });

    for (const name of AGENT_INPUTS) {
      const denied = output(await answer(p, version, name));
      expect(denied["permissionDecision"], name).toBe("deny");
      expect(denied["permissionDecisionReason"], name).toContain("warrant run submit");
    }
  });
});
