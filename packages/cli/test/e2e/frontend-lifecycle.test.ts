// e2e: lifecycle
/**
 * The session of the adapter `claude` through the binary, without a real
 * `claude` (criterion 4a, 13 §2; REQ-ENF-001…005, REQ-KRN-033, REQ-VER-009;
 * task 8.4): what the hooks `warrant sync` registers would run, fed the
 * recorded hook input of Claude Code (`test/contract/fixtures/claude/`) moved
 * into the project. Each command is tested in the test process; what only this
 * chain proves is that the files one step writes are what the next reads:
 *
 *   openspec init --tools none; warrant init --frontend claude; warrant sync
 *     -> .claude/settings.json: static deny Edit(/…) and Bash(…), the hooks
 *   git: main, then worktree/demo; warrant run start demo --operation implement
 *   warrant guard --frontend claude: PreToolUse Edit outside write_scope -> deny;
 *     PreToolUse Write inside -> no answer; PostToolUse Write -> the rule text
 *   warrant run finish; the impl-PR committed with the Run file
 *   warrant verify demo --transition VERIFYING->MERGED -> no FRONTEND_HOOKS_INACTIVE;
 *     an edit of code without the hooks -> FRONTEND_HOOKS_INACTIVE names it
 *
 * Runs on ubuntu and windows in CI. `openspec` 1.13.1 on PATH is required by
 * the `globalSetup` of `e2e` (ADR-0025 п. 5).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { recordedHook, recordedInputIn, recordedVersions } from "../helpers/claude-hooks.js";
import { makeTempDir, removeDir, runCli, type CliRun } from "../helpers/cli.js";
import { git } from "../helpers/git.js";
import { openspecSync } from "../helpers/openspec.js";
import { record, write } from "../helpers/synced.js";

// `openspec` is slow to start, especially on Windows.
const TIMEOUT = 180_000;

const hasGit = spawnSync("git", ["--version"]).status === 0;
/** A local run: no CI attestation, whatever the environment of the test runner. */
const LOCAL: NodeJS.ProcessEnv = { GITHUB_ACTIONS: "" };
const CODE = "FRONTEND_HOOKS_INACTIVE";
const RULE_TEXT = "Every module of src has a docstring.";
const FEATURE = { classification: { profiles: ["feature"] } };

/** `tests-passed` of the project: writes a passing junit report into `{out}`. */
const FAKE_TESTS =
  "require('fs').writeFileSync(require('path').join(process.argv[1], 'junit.xml'), " +
  "'<testsuites tests=\"1\" failures=\"0\"><testsuite name=\"demo\" tests=\"1\" failures=\"0\" errors=\"0\" skipped=\"0\"></testsuite></testsuites>')";

/** The newest recorded version of Claude Code. */
const VERSION = recordedVersions().at(-1) as string;

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) removeDir(root);
});

function readJson(root: string, rel: string): any {
  return JSON.parse(readFileSync(path.join(root, rel), "utf8"));
}

/** A hook of Claude Code: the recorded input `name`, the file of its tool at `rel`, through `warrant guard --frontend claude`. */
function hook(root: string, name: string, rel: string): Promise<CliRun> {
  return runCli(["guard", "--frontend", "claude"], root, LOCAL, recordedInputIn(recordedHook(VERSION, name), root, rel));
}

function hookOutput(run: CliRun): Record<string, string> {
  expect(run.status, run.stderr).toBe(0);
  return (JSON.parse(run.stdout) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput;
}

describe.skipIf(!hasGit)("adapter claude: init --frontend claude, sync, run, guard, verify", () => {
  it(
    "deny outside write_scope, hints after the edit, verify without FRONTEND_HOOKS_INACTIVE",
    async () => {
      const root = makeTempDir("warrant-e2e-frontend-");
      roots.push(root);
      const cli = (args: string[]): Promise<CliRun> => runCli(args, root, LOCAL);

      // The project: warrant.json of init --frontend claude with the paths of code and tests, a rule on src.
      expect(openspecSync(["init", "--tools", "none"], root).ok).toBe(true);
      const init = await cli(["init", "--frontend", "claude"]);
      expect(init.json?.errors).toEqual([]);
      const config = readJson(root, ".warrant/warrant.json");
      expect(config.frontends).toEqual(["claude"]);
      write(root, ".warrant/warrant.json", { ...config, paths: { src: "src", tests: "tests" }, roles: { maintainer: ["kat"] } });
      write(root, ".warrant/local/rules/docstrings.json", { $schema: "warrant://rule/1", id: "docstrings", paths: ["src/**/*.py"], text: RULE_TEXT });
      write(root, ".warrant/local/checks/tests-passed.json", {
        $schema: "warrant://check/1",
        id: "tests-passed",
        version: "1.0.0",
        overrides: "core-sdd:tests-passed",
        level: "L1",
        run: { command: [process.execPath, "-e", FAKE_TESTS, "{out}"] }
      });
      const sync = await cli(["sync"]);
      expect(sync.json?.errors).toEqual([]);
      const settings = readJson(root, ".claude/settings.json");
      expect(settings.permissions.deny).toContain("Edit(/.warrant/runs/**)");
      expect(settings.permissions.deny).toContain("Bash(git push origin main:*)");
      expect(settings.permissions.deny.filter((rule: string) => rule.startsWith("Write("))).toEqual([]);
      expect(settings.hooks.PreToolUse).toEqual([{ matcher: "Edit|Write|NotebookEdit|Bash", hooks: [{ type: "command", command: "warrant guard --frontend claude" }] }]);
      expect(settings.hooks.PostToolUse).toEqual([{ matcher: "Edit|Write|NotebookEdit", hooks: [{ type: "command", command: "warrant guard --frontend claude" }] }]);
      expect(readFileSync(path.join(root, ".gitignore"), "utf8").split(/\r?\n/)).toContain(".warrant/runs/current");

      // The Change in IMPLEMENTING on its branch.
      const change = await cli(["init", "change", "demo"]);
      expect(change.json?.errors).toEqual([]);
      write(root, "openspec/changes/demo/tasks.md", "# Tasks\n\n## 1. Search\n\n- [x] 1.1 Implement search\n");
      write(root, ".warrant/changes/demo.json", record("demo", "IMPLEMENTING", FEATURE));
      const validated = await cli(["validate"]);
      expect(validated.json?.errors).toEqual([]);
      git(root, "-c", "init.defaultBranch=main", "init", "--quiet");
      git(root, "checkout", "--quiet", "-B", "main");
      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "project");
      git(root, "checkout", "--quiet", "-b", "worktree/demo");

      const start = await cli(["run", "start", "demo", "--operation", "implement"]);
      expect(start.json?.errors).toEqual([]);
      const id = start.json?.data.run as string;
      expect(existsSync(path.join(root, ".warrant", "runs", "current"))).toBe(true);

      // The hooks: an edit outside write_scope is denied, one inside passes silently, the rule text follows the edit.
      const denied = hookOutput(await hook(root, "pre-edit", "docs/readme.md"));
      expect(denied).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
      expect(denied["permissionDecisionReason"]).toContain("docs/readme.md");
      const allowed = await hook(root, "pre-write", "src/search.py");
      expect({ status: allowed.status, stdout: allowed.stdout }).toEqual({ status: 0, stdout: "" });
      write(root, "src/search.py", '"""Search."""\n');
      const hinted = hookOutput(await hook(root, "post-write", "src/search.py"));
      expect(hinted["hookEventName"]).toBe("PostToolUse");
      expect(hinted["additionalContext"]).toContain(`rule docstrings: ${RULE_TEXT}`);
      expect(hinted).not.toHaveProperty("permissionDecision");

      const finish = await cli(["run", "finish"]);
      expect(finish.json?.errors).toEqual([]);
      const run = readJson(root, `.warrant/runs/${id}.json`);
      expect(run.guard_events.map((e: { phase: string; decision: string }) => `${e.phase} ${e.decision}`)).toEqual(["pre deny", "pre allow", "post allow"]);
      expect(JSON.stringify(run)).not.toMatch(/claude/i);

      // The impl-PR with the Run file: every edit of code had its post event.
      write(root, ".warrant/changes/demo.json", record("demo", "VERIFYING", FEATURE));
      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "impl");
      const verify = (): Promise<CliRun> => cli(["verify", "demo", "--transition", "VERIFYING->MERGED"]);
      const clean = await verify();
      expect(clean.json?.data.transition).toBe("VERIFYING->MERGED");
      expect(clean.json?.data.findings.map((f: { code: string }) => f.code)).not.toContain(CODE);

      // An edit of code the hooks did not see is named.
      write(root, "src/extra.py", '"""Extra."""\n');
      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "edit without hooks");
      const unseen = await verify();
      expect(unseen.json?.data.findings).toContainEqual(expect.objectContaining({ code: CODE, paths: ["src/extra.py"] }));
    },
    TIMEOUT
  );
});
