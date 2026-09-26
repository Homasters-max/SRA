// e2e: lifecycle
/**
 * Criterion 4b (13 §2, design N26, task 7.1): a Change of a fixture project
 * passes `SPECIFIED -> APPROVED` with `adversarial-review` `PASS` on the
 * evidence of `run submit` and reaches `VERIFYING -> MERGED` with
 * `analyze-clean` `PASS` — without a single waiver, on the REAL `git` and
 * `openspec`, without a real `claude`. Each command is tested in the test
 * process (`test/app/commands/*.test.ts`); what only this chain proves is that
 * the files one step writes are what the next reads:
 *
 *   openspec init --tools none; warrant init; paths.src/tests, roles, areas
 *   spec-PR `spec/demo`: the spec with REQ-SRC-001 / SCN-SRC-001 committed,
 *     classify --set profile=feature, run start --operation review (PROPOSED,
 *     REQ-ENF-002), run submit of the envelope fixture on stdin (REQ-ENF-007),
 *     check openspec-validate, SPECIFIED, APPROVED (--ref, --by): the review
 *     record of commit A is admitted by its spec tree (REQ-VER-003), merged
 *   impl-PR `worktree/demo`: IMPLEMENTING, the code and the test naming
 *     SCN-SRC-001 under an implement Run with the post events of the guard,
 *     VERIFYING, `analyze`, CI `verify`, then `gate VERIFYING->MERGED`: every
 *     gate PASS, `analyze-clean` among them (REQ-VER-004, REQ-VER-010)
 *
 * The steps share the directory and run in order. `openspec` 1.13.1 on PATH is
 * required by the `globalSetup` of `e2e` (ADR-0025 п. 5).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLI_ROOT, makeTempDir, removeDir, runCli, type CliRun } from "../helpers/cli.js";
import { git } from "../helpers/git.js";
import { openspecSync } from "../helpers/openspec.js";
import { write } from "../helpers/synced.js";
import { readJsonFile } from "../helpers/json.js";

// `openspec` is slow to start, especially on Windows.
const TIMEOUT = 180_000;

const hasGit = spawnSync("git", ["--version"]).status === 0;
const RECORD = ".warrant/changes/demo.json";
const ACTIVE = "openspec/changes/demo";
const APPROVAL = "https://github.com/o/r/pull/7#pullrequestreview-1";
/** The envelope of a review as the subagent sends it: the schema fixture of `skill-result/1`. */
const ENVELOPE = path.join(CLI_ROOT, "test", "fixtures", "schemas", "skill-result", "valid-review.json");

/** A local run: no CI attestation, whatever the environment of the test runner. */
const LOCAL: NodeJS.ProcessEnv = { GITHUB_ACTIONS: "" };
/** A GitHub Actions run: records get `attestation.type: "ci"` (P-15). */
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

## ADDED Requirements

### Requirement: Search by text
<!-- id: REQ-SRC-001 -->

The system SHALL return every item whose title contains the query.

#### Scenario: Match
<!-- id: SCN-SRC-001 -->
- **WHEN** a user searches for "lamp"
- **THEN** every item with "lamp" in its title is returned
`;

let root: string;

function cli(args: string[], env: NodeJS.ProcessEnv = LOCAL, input?: string): Promise<CliRun> {
  return runCli(args, root, env, input);
}

/** The waiver files of the project: none in the whole chain. */
function waivers(): string[] {
  const dir = path.join(root, ".warrant", "waivers");
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")) : [];
}

describe.skipIf(!hasGit)("criterion 4b: adversarial-review PASS by run submit, analyze-clean PASS, no waivers", () => {
  beforeAll(() => {
    root = makeTempDir("warrant-e2e-producers-");
  }, TIMEOUT);

  afterAll(() => {
    if (root) removeDir(root);
  });

  it(
    "the project on main: openspec init, warrant init, paths, roles, areas, tests-passed",
    async () => {
      expect(openspecSync(["init", "--tools", "none"], root).ok).toBe(true);
      const init = await cli(["init"]);
      expect(init.json?.errors).toEqual([]);
      const config = readJsonFile(root, ".warrant/warrant.json");
      write(root, ".warrant/warrant.json", { ...config, paths: { src: "src", tests: "tests" }, roles: { maintainer: ["kat"] } });
      write(root, ".warrant/local/areas.json", { $schema: "warrant://areas/1", SRC: { capability: "search" } });
      write(root, ".warrant/local/checks/tests-passed.json", {
        $schema: "warrant://check/1",
        id: "tests-passed",
        version: "1.0.0",
        overrides: "core-sdd:tests-passed",
        level: "L1",
        run: { command: [process.execPath, "-e", FAKE_TESTS, "{out}"] }
      });
      const change = await cli(["init", "change", "demo"]);
      expect(change.json?.errors).toEqual([]);
      const validated = await cli(["validate"]);
      expect(validated.json?.errors).toEqual([]);

      git(root, "-c", "init.defaultBranch=main", "init", "--quiet");
      git(root, "config", "user.name", "warrant-test");
      git(root, "config", "user.email", "test@example.invalid");
      git(root, "checkout", "--quiet", "-B", "main");
      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "project");
    },
    TIMEOUT
  );

  it(
    "spec-PR: review Run in PROPOSED, run submit, SPECIFIED, APPROVED with adversarial-review PASS and no waiver",
    async () => {
      git(root, "checkout", "--quiet", "-b", "spec/demo");
      write(
        root,
        `${ACTIVE}/proposal.md`,
        "# Proposal: demo\n\n## Why\n\nUsers cannot find items without browsing every page of the catalogue.\n\n## What Changes\n\n- Add text search.\n\n## Capabilities\n\n### New Capabilities\n\n- `search`: text search over items.\n"
      );
      write(root, `${ACTIVE}/design.md`, "# Design\n\n## Context\n\nA linear scan is enough for the catalogue size.\n");
      write(root, `${ACTIVE}/tasks.md`, "# Tasks\n\n## 1. Search\n\n- [x] 1.1 Search by text (REQ-SRC-001), the test of SCN-SRC-001\n");
      write(root, `${ACTIVE}/specs/search/spec.md`, SPEC);
      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "spec");

      const classified = await cli(["classify", "demo", "--base", "main", "--set", "profile=feature", "--by", "kat"]);
      expect(classified.json?.errors).toEqual([]);
      expect(classified.json?.data.classification.profiles).toContain("feature");

      // The review Run: PROPOSED, the committed spec, its tree remembered (REQ-ENF-002).
      const start = await cli(["run", "start", "demo", "--operation", "review"]);
      expect(start.json?.errors).toEqual([]);
      expect(start.json?.data).toMatchObject({ operation: "review", write_scope: [], rules: [] });
      const id = start.json?.data.run as string;
      const run = readJsonFile(root, `.warrant/runs/${id}.json`);
      expect(run.spec_tree).toMatch(/^sha256:/);

      // The subagent's one command: the envelope on stdin, its run and the skill of the lock filled in.
      const [skillName, skillEntry] = Object.entries(readJsonFile(root, ".warrant/warrant.lock.json").skills)[0] as [string, { version: string }];
      const envelope = { ...JSON.parse(readFileSync(ENVELOPE, "utf8")), run: id, skill: `${skillName}@${skillEntry.version}` };
      const submitted = await cli(["run", "submit"], LOCAL, JSON.stringify(envelope));
      expect(submitted.json?.errors).toEqual([]);
      expect(submitted.json?.data).toMatchObject({ run: id, change: "demo", evidence_status: "PROVEN", findings: { BLOCKER: 0, MAJOR: 1 } });
      expect(submitted.status).toBe(0);
      const evid = submitted.json?.data.evidence as string;
      expect(readJsonFile(root, `.warrant/evidence/demo/${evid}.json`).subject).toMatchObject({ spec_tree: run.spec_tree });
      expect(readJsonFile(root, `.warrant/runs/${id}.json`)).toMatchObject({ run_state: "SUCCEEDED", evidence: [evid] });
      expect(existsSync(path.join(root, ".warrant", "runs", `${id}.result.json`))).toBe(true);
      expect(existsSync(path.join(root, ".warrant", "runs", "current"))).toBe(false);

      const checked = await cli(["check", "demo", "openspec-validate"]);
      expect(checked.json?.errors).toEqual([]);
      expect(checked.json?.data.checks[0]).toMatchObject({ id: "openspec-validate", evidence_status: "PROVEN" });

      const specified = await cli(["transition", "demo", "SPECIFIED"]);
      expect(specified.json?.errors).toEqual([]);
      expect(specified.json?.data.change_state).toBe("SPECIFIED");

      const approved = await cli(["transition", "demo", "APPROVED", "--ref", APPROVAL, "--by", "kat"]);
      expect(approved.json?.errors).toEqual([]);
      expect(approved.json?.data.gates["adversarial-review"]).toBe("PASS");
      expect(Object.values(approved.json?.data.gates as Record<string, string>).every((verdict) => verdict === "PASS")).toBe(true);
      expect(approved.json?.data.findings).toEqual([]);
      expect(approved.status).toBe(0);
      expect(waivers()).toEqual([]);

      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "review and approval");
      git(root, "checkout", "--quiet", "main");
      git(root, "merge", "--quiet", "--no-ff", "spec/demo", "-m", "Merge spec-PR");
      expect(readJsonFile(root, RECORD).change_state).toBe("APPROVED");
    },
    TIMEOUT
  );

  it(
    "impl-PR: IMPLEMENTING, VERIFYING, the code and its test, gate VERIFYING->MERGED with analyze-clean PASS and no waiver",
    async () => {
      git(root, "checkout", "--quiet", "-b", "worktree/demo");
      const implementing = await cli(["transition", "demo", "IMPLEMENTING"]);
      expect(implementing.json?.errors).toEqual([]);

      // The code and its test under an implement Run: each edit has its post event of the guard.
      const start = await cli(["run", "start", "demo", "--operation", "implement"]);
      expect(start.json?.errors).toEqual([]);
      write(root, "src/search.js", "export const search = (items, q) => items.filter((i) => i.title.includes(q));\n");
      write(root, "tests/search.test.js", "// SCN-SRC-001: every item with the query in its title is returned\n");
      for (const edited of ["src/search.js", "tests/search.test.js"]) {
        const event = { phase: "post", action: "edit", paths: [edited], cwd: root };
        const guarded = await cli(["guard"], LOCAL, JSON.stringify(event));
        expect(guarded.json?.data.decision).toBe("allow");
      }
      const finish = await cli(["run", "finish"]);
      expect(finish.json?.errors).toEqual([]);

      const verifying = await cli(["transition", "demo", "VERIFYING"]);
      expect(verifying.json?.errors).toEqual([]);
      expect(verifying.json?.data.change_state).toBe("VERIFYING");
      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "impl");

      const analyzed = await cli(["analyze", "demo"]);
      expect(analyzed.json?.errors).toEqual([]);
      expect(analyzed.json?.data).toMatchObject({ findings: [], skipped: [] });
      expect(analyzed.status).toBe(0);

      // CI: the test-report of the run, attested; then the verdict of the transition.
      const ci = await cli(["verify", "demo", "--transition", "VERIFYING->MERGED"], CI_ENV);
      expect(ci.json?.errors).toEqual([]);
      expect(ci.json?.data.checks[0]).toMatchObject({ id: "tests-passed", evidence_status: "PROVEN" });

      const gate = await cli(["gate", "demo", "--transition", "VERIFYING->MERGED"]);
      expect(gate.json?.errors).toEqual([]);
      expect(gate.json?.data.gates).toMatchObject({ "analyze-clean": "PASS", "evidence-complete": "PASS", "scope-valid": "PASS", "tests-passed": "PASS" });
      expect(Object.values(gate.json?.data.gates as Record<string, string>).every((verdict) => verdict === "PASS")).toBe(true);
      expect(gate.json?.data.findings).toEqual([]);
      expect(gate.status).toBe(0);
      expect(waivers()).toEqual([]);
    },
    TIMEOUT
  );
});
