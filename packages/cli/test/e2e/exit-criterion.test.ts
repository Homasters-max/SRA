// e2e: lifecycle
/**
 * The end-to-end lifecycle of one Change on the REAL `openspec` and `git`
 * (ADR-0025 п. 1, design §9, task 5.5): the phase-1 exit criterion (task 10.1)
 * — `openspec init` → `init` → `init change` → a clean `validate`/`status` —
 * continued through every state to `archive`. What only this chain proves: the
 * `config.yaml` of `openspec init` and the schema `warrant sync` generates are
 * accepted by `openspec new change`, `openspec validate --strict` and
 * `openspec archive` of the same project, and the record, the evidence and the
 * branches of each step are what the next step reads. Each command of the
 * chain is tested in the test process (`test/app/commands/*.test.ts`).
 *
 * In one throwaway directory, with the REAL `openspec` binary and `git`:
 *
 *   openspec init --tools none
 *   warrant init; warrant init change demo
 *   warrant validate / status demo / fmt --check / sync --check   -> clean
 *   spec-PR `spec/demo`: artifacts, `classify --base main` -> chore,
 *     `check openspec-validate`, SPECIFIED, APPROVED (--ref, --by), merged
 *   impl-PR `worktree/demo`: IMPLEMENTING, VERIFYING, the code, CI
 *     `verify --transition VERIFYING->MERGED`, merged with a merge commit
 *   `archive/demo`: MERGED (--ref of the CI run), `archive demo` -> ARCHIVED
 *
 * The steps share the directory and run in order. `openspec` 1.13.1 on PATH is
 * required by the `globalSetup` of `e2e` (ADR-0025 п. 5).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openspecSync } from "../helpers/openspec.js";
import { makeTempDir, removeDir, runCli, type CliRun } from "../helpers/cli.js";
import { git } from "../helpers/git.js";
import { write } from "../helpers/synced.js";
import { readJsonFile } from "../helpers/json.js";

// `openspec` is slow to start, especially on Windows.
const TIMEOUT = 180_000;

const hasGit = spawnSync("git", ["--version"]).status === 0;
const RECORD = ".warrant/changes/demo.json";
const ACTIVE = "openspec/changes/demo";
const REVIEW = "https://github.com/o/r/pull/7#pullrequestreview-1";
/** The impl-PR: the --ref of MERGED (ADR-0037 п. 5). */
const IMPL_PR = "https://github.com/o/r/pull/9";

/** A local run: no CI attestation, whatever the environment of the test runner. */
const LOCAL: NodeJS.ProcessEnv = { GITHUB_ACTIONS: "" };
/** The GitHub Actions run 42: records get `attestation.type: "ci"` (P-15). */
const CI_ENV: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "o/r",
  GITHUB_RUN_ID: "42"
};

/** `tests-passed` of the project: writes a passing junit report into `{out}`. */
const FAKE_TESTS =
  "require('fs').writeFileSync(require('path').join(process.argv[1], 'junit.xml'), " +
  "'<testsuites tests=\"1\" failures=\"0\"><testsuite name=\"demo\" tests=\"1\" failures=\"0\" errors=\"0\" skipped=\"0\"></testsuite></testsuites>')";

const SPEC = `# Spec Delta

## Purpose

Lets users find items by a text query, so that they do not browse every page.

## ADDED Requirements

### Requirement: Search by text

The system SHALL return every item whose title contains the query.

#### Scenario: Match
- **WHEN** a user searches for "lamp"
- **THEN** every item with "lamp" in its title is returned
`;

let root: string;

function cli(args: string[], env: NodeJS.ProcessEnv = LOCAL): Promise<CliRun> {
  return runCli(args, root, env);
}

describe.skipIf(!hasGit)("lifecycle: phase-1 exit criterion, then every state to archive", () => {
  beforeAll(() => {
    root = makeTempDir("warrant-exit-");
  }, TIMEOUT);

  afterAll(() => {
    if (root) removeDir(root);
  });

  it(
    "openspec init --tools none",
    async () => {
      expect(openspecSync(["init", "--tools", "none"], root).ok).toBe(true);
    },
    TIMEOUT
  );

  it(
    "warrant init",
    async () => {
      const run = await cli(["init"]);
      expect(run.json?.errors).toEqual([]);
      expect(run.status).toBe(0);
    },
    TIMEOUT
  );

  it(
    "warrant init change demo",
    async () => {
      const run = await cli(["init", "change", "demo"]);
      expect(run.json?.errors).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.json?.change).toBe("demo");
    },
    TIMEOUT
  );

  it(
    "warrant validate",
    async () => {
      const run = await cli(["validate"]);
      expect(run.json?.errors).toEqual([]);
      expect(run.json?.ok).toBe(true);
      expect(run.status).toBe(0);
    },
    TIMEOUT
  );

  it(
    "warrant status demo",
    async () => {
      const run = await cli(["status", "demo"]);
      expect(run.json?.errors).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.json?.data.stale).toEqual([]);
      expect(run.json?.data.change_state).toBe("PROPOSED");
      expect((run.json?.data.artifacts as Record<string, string>).proposal).toBe("ready");
    },
    TIMEOUT
  );

  it(
    "warrant fmt --check and warrant sync --check are clean after init",
    async () => {
      expect((await cli(["fmt", "--check"])).status).toBe(0);
      expect((await cli(["sync", "--check"])).status).toBe(0);
    },
    TIMEOUT
  );

  it(
    "spec-PR: classify --base main, check openspec-validate, SPECIFIED, APPROVED with --ref and --by",
    async () => {
      // The project on `main`: a maintainer, the project's `tests-passed` and the waiver of
      // `adversarial-review` — outside the spec-PR, whose diff would classify `.warrant/**` as factory-change.
      const config = readJsonFile(root, ".warrant/warrant.json");
      write(root, ".warrant/warrant.json", { ...config, roles: { maintainer: ["kat"] } });
      write(root, ".warrant/local/checks/tests-passed.json", {
        $schema: "warrant://check/1",
        id: "tests-passed",
        version: "1.0.0",
        overrides: "core-sdd:tests-passed",
        level: "L1",
        run: { command: [process.execPath, "-e", FAKE_TESTS, "{out}"] }
      });
      write(root, ".warrant/waivers/WAV-2026-001.json", {
        $schema: "warrant://waiver/1",
        id: "WAV-2026-001",
        change: "demo",
        gate: "adversarial-review",
        reason: "no second reviewer in the lifecycle test",
        owner: "kat",
        approved_by: "human:kat",
        expires_at: "2099-12-31",
        waiver_state: "ACTIVE"
      });
      git(root, "-c", "init.defaultBranch=main", "init", "--quiet");
      git(root, "config", "user.name", "warrant-test");
      git(root, "config", "user.email", "test@example.invalid");
      git(root, "checkout", "--quiet", "-B", "main");
      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "project");

      git(root, "checkout", "--quiet", "-b", "spec/demo");
      write(
        root,
        `${ACTIVE}/proposal.md`,
        "# Proposal: demo\n\n## Why\n\nUsers cannot find items without browsing every page of the catalogue.\n\n## What Changes\n\n- Add text search.\n\n## Capabilities\n\n### New Capabilities\n\n- `search`: text search over items.\n"
      );
      write(root, `${ACTIVE}/design.md`, "# Design\n\n## Context\n\nA linear scan is enough for the catalogue size.\n");
      write(root, `${ACTIVE}/tasks.md`, "# Tasks\n\n## 1. Search\n\n- [x] 1.1 Implement search and verify the unit test passes\n");
      write(root, `${ACTIVE}/specs/search/spec.md`, SPEC);
      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "spec");

      const classified = await cli(["classify", "demo", "--base", "main"]);
      expect(classified.json?.errors).toEqual([]);
      expect(classified.json?.data.classification.profiles).toEqual(["chore"]);

      const checked = await cli(["check", "demo", "openspec-validate"]);
      expect(checked.json?.errors).toEqual([]);
      expect(checked.json?.data.checks[0]).toMatchObject({ id: "openspec-validate", evidence_status: "PROVEN" });

      const specified = await cli(["transition", "demo", "SPECIFIED"]);
      expect(specified.json?.errors).toEqual([]);
      expect(specified.json?.data.gates).toEqual({ "ids-valid": "PASS", "required-artifacts-present": "PASS", "spec-valid": "PASS" });
      expect(specified.status).toBe(0);

      const approved = await cli(["transition", "demo", "APPROVED", "--ref", REVIEW, "--by", "kat"]);
      expect(approved.json?.errors).toEqual([]);
      expect(approved.json?.data.gates).toMatchObject({ "adversarial-review": "WAIVED", "human-approval": "PASS", "spec-valid": "PASS" });
      expect(approved.status).toBe(0);

      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "approved");
      git(root, "checkout", "--quiet", "main");
      git(root, "merge", "--quiet", "--no-ff", "spec/demo", "-m", "Merge spec-PR");
      expect(readJsonFile(root, RECORD).change_state).toBe("APPROVED");
    },
    TIMEOUT
  );

  it(
    "impl-PR: IMPLEMENTING on the branch, VERIFYING, the code, CI verify VERIFYING->MERGED, merged",
    async () => {
      git(root, "checkout", "--quiet", "-b", "worktree/demo");
      const implementing = await cli(["transition", "demo", "IMPLEMENTING"]);
      expect(implementing.json?.errors).toEqual([]);
      expect(implementing.json?.data.gates).toEqual({ "branch-isolated": "PASS" });
      const verifying = await cli(["transition", "demo", "VERIFYING"]);
      expect(verifying.json?.errors).toEqual([]);
      expect(verifying.json?.data.change_state).toBe("VERIFYING");

      write(root, "src/search.ts", "export const search = 1;\n");
      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "impl");

      const ci = await cli(["verify", "demo", "--transition", "VERIFYING->MERGED"], CI_ENV);
      expect(ci.json?.errors).toEqual([]);
      expect(ci.json?.data.checks[0]).toMatchObject({ id: "tests-passed", evidence_status: "PROVEN" });
      expect(ci.json?.data.gates).toEqual({ "ids-valid": "PASS", "scope-valid": "PASS", "spec-approved": "PASS", "tests-passed": "PASS" });
      expect(ci.json?.data.controller_action).toBe("CONTINUE");
      expect(ci.status).toBe(0);

      // The records of the CI run leave the runner as an artifact: set aside, then committed on `archive/demo`.
      git(root, "stash", "push", "--quiet", "--include-untracked");
      git(root, "checkout", "--quiet", "main");
      git(root, "merge", "--quiet", "--no-ff", "worktree/demo", "-m", "Merge impl-PR");
    },
    TIMEOUT
  );

  it(
    "archive/demo: MERGED on the CI evidence, archive demo, a clean validate",
    async () => {
      git(root, "checkout", "--quiet", "-b", "archive/demo");
      git(root, "stash", "pop", "--quiet");
      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "evidence from CI");

      const merged = await cli(["transition", "demo", "MERGED", "--ref", IMPL_PR]);
      expect(merged.json?.errors).toEqual([]);
      expect(merged.json?.data).toMatchObject({ transition: "VERIFYING->MERGED", change_state: "MERGED" });
      expect(merged.status).toBe(0);

      const archived = await cli(["archive", "demo"]);
      expect(archived.json?.errors).toEqual([]);
      expect(archived.status).toBe(0);
      expect(archived.json?.data.archive).toMatch(/^openspec\/changes\/archive\/\d{4}-\d{2}-\d{2}-demo$/);
      expect(existsSync(path.join(root, ACTIVE))).toBe(false);
      // The real openspec merged the delta into the main spec.
      expect(readFileSync(path.join(root, "openspec/specs/search/spec.md"), "utf8")).toContain("### Requirement: Search by text");
      expect(readJsonFile(root, RECORD).change_state).toBe("ARCHIVED");

      const validated = await cli(["validate"]);
      expect(validated.json?.errors).toEqual([]);
      expect(validated.status).toBe(0);
    },
    TIMEOUT
  );
});
