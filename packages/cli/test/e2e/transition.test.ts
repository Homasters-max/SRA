/**
 * `warrant transition` in temporary git repositories (REQ-VER-007, design
 * §9, §10): forward transitions through the gate engine — SCN-VER-029, 030 —
 * `human-approval` by `--ref --by` — SCN-VER-031, 032 — `MERGED` on the
 * commit of CI evidence after a real merge — SCN-VER-033, 034 — only on the
 * head of the impl-PR — SCN-VER-050, 051 — and only from the run of `--ref` —
 * SCN-VER-052 — and `ABANDONED` with the freeze of the record — SCN-VER-035.
 *
 * Each case copies the synced core-sdd project with Change `add-search` and
 * commits it on `main`. `openspec` on PATH is a fake (validate, status);
 * `tests-passed` is overridden with a node script that writes junit.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { openspecAvailable } from "../../src/core/openspec/cli.js";
import { makeTempDir, removeDir, runCli, type CliRun } from "../helpers/cli.js";
import { PATH_KEY, pathWithFake, writeFakeOpenspec } from "../helpers/fake-openspec.js";
import { PACKS, record, useSyncedProject, validate, write } from "../helpers/synced.js";

const hasOpenspec = openspecAvailable();
const hasGit = spawnSync("git", ["--version"]).status === 0;
const project = useSyncedProject();
const NODE = process.execPath;
const RECORD = ".warrant/changes/add-search.json";
const EVIDENCE = ".warrant/evidence/add-search";
const REVIEW = "https://github.com/o/r/pull/7#pullrequestreview-1";
const CI_RUN = "https://github.com/o/r/actions/runs/42";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

let fakeBin: string | undefined;

function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  if (fakeBin === undefined) {
    fakeBin = makeTempDir("warrant-transition-fake-openspec-");
    tempDirs.push(fakeBin);
    writeFakeOpenspec(fakeBin);
  }
  return { WARRANT_PACKS_DIR: PACKS, [PATH_KEY]: pathWithFake(fakeBin), GITHUB_ACTIONS: "", ...extra };
}

/** Environment of a GitHub Actions run: records get `attestation.type: "ci"` (P-15). */
const CI_ENV: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "o/r",
  GITHUB_RUN_ID: "42"
};

function cli(root: string, args: string[], extra: NodeJS.ProcessEnv = {}): Promise<CliRun> {
  return runCli(args, root, env(extra));
}

function transition(root: string, args: string[]): Promise<CliRun> {
  return cli(root, ["transition", "add-search", ...args]);
}

function git(cwd: string, ...args: string[]): string {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
  return run.stdout.trim();
}

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}

function recordText(root: string): string {
  return readFileSync(path.join(root, RECORD), "utf8");
}

/** Evidence records of `add-search`, parsed. */
function records(root: string): any[] {
  const dir = path.join(root, EVIDENCE);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("EVID-"))
    .map((name) => readJson(path.join(dir, name)));
}

const FAKE_TESTS = `const fs = require("fs");
const path = require("path");
const out = process.argv[2];
fs.writeFileSync(path.join(out, "junit.xml"),
  '<?xml version="1.0" encoding="UTF-8" ?>\\n<testsuites tests="2" failures="0">\\n' +
  '  <testsuite name="fake" tests="2" failures="0" errors="0" skipped="0">\\n  </testsuite>\\n</testsuites>\\n');
`;

function artifacts(root: string): void {
  write(root, "openspec/changes/add-search/proposal.md", "# Proposal\n");
  write(root, "openspec/changes/add-search/design.md", "# Design\n");
  write(root, "openspec/changes/add-search/tasks.md", "# Tasks\n");
  write(root, "openspec/changes/add-search/specs/search/spec.md", "# Spec\n");
}

function waiver(root: string, id: string, gate: string): void {
  write(root, `.warrant/waivers/${id}.json`, {
    $schema: "warrant://waiver/1",
    id,
    change: "add-search",
    gate,
    reason: "no producer in phase 3",
    owner: "kat",
    approved_by: "human:kat",
    expires_at: "2099-12-31",
    waiver_state: "ACTIVE"
  });
}

/** The synced project with record `add-search` in `state`, committed on `main`. */
function repo(state: string, extra: Record<string, unknown>, setup?: (root: string) => void): string {
  const root = project();
  write(root, RECORD, record("add-search", state, extra));
  artifacts(root);
  setup?.(root);
  git(root, "-c", "init.defaultBranch=main", "init", "--quiet");
  git(root, "config", "user.name", "warrant-test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "checkout", "--quiet", "-B", "main");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "base");
  return root;
}

function commitAll(root: string, message: string): string {
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

const FEATURE = { classification: { profiles: ["feature"] } };
const CHORE = { classification: { profiles: ["chore"] } };

describe.skipIf(!hasOpenspec || !hasGit)("warrant transition", () => {
  it("records a forward transition whose gates passed, with verdicts and evidence (SCN-VER-029)", async () => {
    const root = repo("PROPOSED", FEATURE);
    const check = await cli(root, ["check", "add-search", "openspec-validate"]);
    expect(check.status).toBe(0);
    const evid = check.json.data.checks[0].evidence as string;

    const run = await transition(root, ["SPECIFIED"]);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json.data).toMatchObject({
      transition: "PROPOSED->SPECIFIED",
      change_state: "SPECIFIED",
      gates: { "ids-valid": "PASS", "required-artifacts-present": "PASS", "spec-valid": "PASS" },
      controller_action: "CONTINUE"
    });

    const stored = readJson(path.join(root, RECORD));
    expect(stored.change_state).toBe("SPECIFIED");
    const last = stored.transitions.at(-1);
    expect(last).toEqual({
      to: "SPECIFIED",
      at: expect.any(String),
      by: "cli:local",
      effective_policy_hash: expect.stringMatching(/^sha256:/),
      gates: { "ids-valid": "PASS", "required-artifacts-present": "PASS", "spec-valid": "PASS" },
      evidence: [evid]
    });
    expect(run.json.data.recorded).toEqual(last);
    expect((await validate(root)).json?.errors).toEqual([]);
  }, 120_000);

  it("refuses with GATES_NOT_PASSED when a gate fails and leaves the record as it was (SCN-VER-030)", async () => {
    const root = repo("PROPOSED", FEATURE);
    const check = await cli(root, ["check", "add-search", "openspec-validate"], { FAKE_OPENSPEC_INVALID: "1" });
    expect(check.status).toBe(0);
    const before = recordText(root);

    const run = await transition(root, ["SPECIFIED"]);
    expect(run.json.ok).toBe(false);
    expect(run.json.errors[0].code).toBe("GATES_NOT_PASSED");
    expect(run.json.data.gates["spec-valid"]).toBe("FAIL");
    expect(run.json.data.rule).toBe("gate-failed");
    expect(run.status).toBe(2);
    expect(recordText(root)).toBe(before);

    // No evidence at all: BLOCKED, the kernel fallback waits — still refused, still exit 2.
    const bare = repo("PROPOSED", FEATURE);
    const blocked = await transition(bare, ["SPECIFIED"]);
    expect(blocked.json.errors[0].code).toBe("GATES_NOT_PASSED");
    expect(blocked.json.data.gates["spec-valid"]).toBe("BLOCKED");
    expect(blocked.status).toBe(2);
  }, 120_000);

  it("writes human-approval evidence from --ref and --by before the gates and records APPROVED with ref (SCN-VER-031)", async () => {
    const root = repo("SPECIFIED", FEATURE, (r) => waiver(r, "WAV-2026-001", "adversarial-review"));

    // Without --ref: usage error, nothing written.
    const noRef = await transition(root, ["APPROVED", "--by", "kat"]);
    expect(noRef.json.errors[0].code).toBe("USAGE");
    expect(noRef.status).toBe(3);
    // Without --by: the policy has gate human-approval on SPECIFIED->APPROVED.
    const noBy = await transition(root, ["APPROVED", "--ref", REVIEW]);
    expect(noBy.json.errors[0].code).toBe("USAGE");
    expect(records(root)).toEqual([]);

    // No spec-report yet: the approval is written anyway and the gates refuse.
    const first = await transition(root, ["APPROVED", "--ref", REVIEW, "--by", "kat"]);
    expect(first.json.errors[0].code).toBe("GATES_NOT_PASSED");
    expect(first.json.data.gates["human-approval"]).toBe("PASS");
    expect(first.json.data.gates["spec-valid"]).toBe("BLOCKED");
    const approvals = records(root).filter((r) => r.kind === "human-approval");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      evidence_status: "PROVEN",
      produced_by: { type: "human", id: "kat" },
      attestation: { type: "human-review", ref: REVIEW },
      subject: { commit: git(root, "rev-parse", "HEAD") }
    });
    // --ref is only checked to be a URL; the record says so (R-10).
    expect(approvals[0].limitations).toContain("ref not verified (phase 4: warrant ci)");
    expect(readJson(path.join(root, RECORD)).change_state).toBe("SPECIFIED");

    const check = await cli(root, ["check", "add-search", "openspec-validate"]);
    expect(check.status).toBe(0);
    const run = await transition(root, ["APPROVED", "--ref", REVIEW, "--by", "kat"]);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json.data.gates).toEqual({
      "adversarial-review": "WAIVED",
      "blocking-unknowns-resolved": "PASS",
      "human-approval": "PASS",
      "ids-valid": "PASS",
      "required-artifacts-present": "PASS",
      "spec-valid": "PASS"
    });
    // The repeated transition reused the approval the pre-filter still admits.
    expect(run.json.data.approval).toEqual({ evidence: approvals[0].id, reused: true });
    expect(records(root).filter((r) => r.kind === "human-approval")).toHaveLength(1);

    const last = readJson(path.join(root, RECORD)).transitions.at(-1);
    expect(last).toMatchObject({ to: "APPROVED", by: "cli:local", ref: REVIEW });
    expect(last.evidence).toEqual([approvals[0].id, check.json.data.checks[0].evidence].sort());
    expect((await validate(root)).json?.errors).toEqual([]);
  }, 180_000);

  it("refuses --by outside the role with ROLE_REQUIRED and writes no evidence (SCN-VER-032)", async () => {
    const root = repo("SPECIFIED", FEATURE);
    const before = recordText(root);
    const run = await transition(root, ["APPROVED", "--ref", REVIEW, "--by", "bob"]);
    expect(run.json.errors[0].code).toBe("ROLE_REQUIRED");
    expect(run.status).toBe(3);
    expect(records(root)).toEqual([]);
    expect(recordText(root)).toBe(before);
  }, 60_000);

  it("records MERGED on the commit of CI evidence after the impl-PR is merged (SCN-VER-033, SCN-VER-034)", async () => {
    const root = repo("VERIFYING", CHORE, (r) => {
      write(r, "scripts/fake-tests.cjs", FAKE_TESTS);
      write(r, ".warrant/local/checks/tests-passed.json", {
        $schema: "warrant://check/1",
        id: "tests-passed",
        version: "1.0.0",
        overrides: "core-sdd:tests-passed",
        level: "L1",
        run: { command: [NODE, "scripts/fake-tests.cjs", "{out}"] }
      });
    });
    const fork = git(root, "rev-parse", "HEAD");

    // impl-PR: code, then the CI run records evidence on its head.
    git(root, "checkout", "--quiet", "-b", "worktree/add-search");
    write(root, "src/search.ts", "export const search = 1;\n");
    const implHead = commitAll(root, "impl");
    const ci = await cli(root, ["verify", "add-search", "--transition", "VERIFYING->MERGED"], CI_ENV);
    expect(ci.json.data.checks[0]).toMatchObject({ id: "tests-passed", evidence_status: "PROVEN" });
    expect(ci.json.data.gates["tests-passed"]).toBe("PASS");

    // A commit that never reaches main: not merged (SCN-VER-034).
    git(root, "checkout", "--quiet", "-b", "stray", "main");
    write(root, "src/stray.ts", "export {};\n");
    // Only the file: the untracked CI records must stay untracked across the checkouts.
    git(root, "add", "src/stray.ts");
    git(root, "commit", "--quiet", "-m", "stray");
    const stray = git(root, "rev-parse", "HEAD");

    // Merge the impl-PR with a merge commit, then the archive branch carries the CI records.
    git(root, "checkout", "--quiet", "main");
    git(root, "merge", "--quiet", "--no-ff", "-m", "Merge impl", "worktree/add-search");
    git(root, "checkout", "--quiet", "-b", "archive/add-search");
    commitAll(root, "evidence from CI");

    const before = recordText(root);
    const notMerged = await transition(root, ["MERGED", "--ref", CI_RUN, "--commit", stray]);
    expect(notMerged.json.errors[0].code).toBe("COMMIT_NOT_MERGED");
    expect(notMerged.status).toBe(3);
    expect(recordText(root)).toBe(before);

    const noRef = await transition(root, ["MERGED", "--commit", implHead]);
    expect(noRef.json.errors[0].code).toBe("USAGE");

    // Without --commit: the commit of the freshest record, which is the impl head.
    const run = await transition(root, ["MERGED", "--ref", CI_RUN]);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json.data).toMatchObject({
      transition: "VERIFYING->MERGED",
      commit: implHead,
      base: fork,
      gates: { "ids-valid": "PASS", "scope-valid": "PASS", "tests-passed": "PASS" },
      change_state: "MERGED"
    });
    const last = readJson(path.join(root, RECORD)).transitions.at(-1);
    expect(last).toMatchObject({ to: "MERGED", by: "cli:local", ref: CI_RUN, evidence: [ci.json.data.checks[0].evidence] });
    expect((await validate(root)).json?.errors).toEqual([]);
  }, 180_000);

  it("refuses MERGED on a commit that is not the head of the merged impl-PR (SCN-VER-050, review R-1)", async () => {
    const root = repo("VERIFYING", CHORE, (r) => {
      write(r, "scripts/fake-tests.cjs", FAKE_TESTS);
      write(r, ".warrant/local/checks/tests-passed.json", {
        $schema: "warrant://check/1",
        id: "tests-passed",
        version: "1.0.0",
        overrides: "core-sdd:tests-passed",
        level: "L1",
        run: { command: [NODE, "scripts/fake-tests.cjs", "{out}"] }
      });
    });

    // impl-PR: CI evidence on an early commit, then a later commit outside the impl-PR scope.
    git(root, "checkout", "--quiet", "-b", "worktree/add-search");
    write(root, "src/search.ts", "export const search = 1;\n");
    const early = commitAll(root, "impl, early");
    const ci = await cli(root, ["verify", "add-search", "--transition", "VERIFYING->MERGED"], CI_ENV);
    expect(ci.json.data.gates["tests-passed"]).toBe("PASS");
    write(root, "openspec/specs/other/spec.md", "# other\n");
    git(root, "add", "openspec/specs/other/spec.md");
    git(root, "commit", "--quiet", "-m", "impl, late");
    const late = git(root, "rev-parse", "HEAD");

    git(root, "checkout", "--quiet", "main");
    git(root, "merge", "--quiet", "--no-ff", "-m", "Merge impl", "worktree/add-search");
    const merge = git(root, "rev-parse", "HEAD");
    git(root, "checkout", "--quiet", "-b", "archive/add-search");
    commitAll(root, "evidence of the early CI run");
    const before = recordText(root);

    // The freshest record is on the early commit: refused, not judged on base...early.
    const byDefault = await transition(root, ["MERGED", "--ref", CI_RUN]);
    expect(byDefault.json.errors[0].code).toBe("COMMIT_NOT_MERGED");
    expect(byDefault.json.errors[0].message).toContain(`not the head of the impl-PR merged by ${merge} (head ${late})`);
    expect(byDefault.status).toBe(3);
    const explicit = await transition(root, ["MERGED", "--ref", CI_RUN, "--commit", early]);
    expect(explicit.json.errors[0].code).toBe("COMMIT_NOT_MERGED");
    // A commit of the base line itself has no PR boundary.
    const onLine = await transition(root, ["MERGED", "--ref", CI_RUN, "--commit", `${merge}^1`]);
    expect(onLine.json.errors[0].code).toBe("COMMIT_NOT_MERGED");
    expect(onLine.json.errors[0].message).toContain("first-parent line");
    expect(recordText(root)).toBe(before);

    // The head passes the commit check; its gates see the late commit.
    const onHead = await transition(root, ["MERGED", "--ref", CI_RUN, "--commit", late]);
    expect(onHead.json.errors[0].code).toBe("GATES_NOT_PASSED");
    expect(onHead.json.data).toMatchObject({ commit: late, gates: { "scope-valid": "FAIL", "tests-passed": "BLOCKED" } });
    expect(recordText(root)).toBe(before);
  }, 180_000);

  it("refuses MERGED after a fast-forward merge of the impl-PR (SCN-VER-051, review R-1)", async () => {
    const root = repo("VERIFYING", CHORE, (r) => {
      write(r, "scripts/fake-tests.cjs", FAKE_TESTS);
      write(r, ".warrant/local/checks/tests-passed.json", {
        $schema: "warrant://check/1",
        id: "tests-passed",
        version: "1.0.0",
        overrides: "core-sdd:tests-passed",
        level: "L1",
        run: { command: [NODE, "scripts/fake-tests.cjs", "{out}"] }
      });
    });
    git(root, "checkout", "--quiet", "-b", "worktree/add-search");
    write(root, "src/a.ts", "export const a = 1;\n");
    commitAll(root, "impl 1");
    write(root, "src/b.ts", "export const b = 1;\n");
    const head = commitAll(root, "impl 2");
    await cli(root, ["verify", "add-search", "--transition", "VERIFYING->MERGED"], CI_ENV);
    git(root, "checkout", "--quiet", "main");
    git(root, "merge", "--quiet", "--ff-only", "worktree/add-search");
    git(root, "checkout", "--quiet", "-b", "archive/add-search");
    commitAll(root, "evidence from CI");

    // Before R-1 the base was head^1 and the diff held "impl 2" only.
    const run = await transition(root, ["MERGED", "--ref", CI_RUN, "--commit", head]);
    expect(run.json.errors[0].code).toBe("COMMIT_NOT_MERGED");
    expect(run.json.errors[0].message).toContain("fast-forward");
  }, 180_000);

  it("refuses MERGED with REF_MISMATCH when the CI records come from another run (SCN-VER-052)", async () => {
    const root = repo("VERIFYING", CHORE, (r) => {
      write(r, "scripts/fake-tests.cjs", FAKE_TESTS);
      write(r, ".warrant/local/checks/tests-passed.json", {
        $schema: "warrant://check/1",
        id: "tests-passed",
        version: "1.0.0",
        overrides: "core-sdd:tests-passed",
        level: "L1",
        run: { command: [NODE, "scripts/fake-tests.cjs", "{out}"] }
      });
    });
    git(root, "checkout", "--quiet", "-b", "worktree/add-search");
    write(root, "src/search.ts", "export const search = 1;\n");
    const implHead = commitAll(root, "impl");
    const ci = await cli(root, ["verify", "add-search", "--transition", "VERIFYING->MERGED"], { ...CI_ENV, GITHUB_RUN_ID: "2" });
    expect(ci.json.data.gates["tests-passed"]).toBe("PASS");
    const evidence = ci.json.data.checks[0].evidence;
    git(root, "checkout", "--quiet", "main");
    git(root, "merge", "--quiet", "--no-ff", "-m", "Merge impl", "worktree/add-search");
    git(root, "checkout", "--quiet", "-b", "archive/add-search");
    commitAll(root, "evidence from CI run 2");
    const before = recordText(root);

    const run = await transition(root, ["MERGED", "--ref", "https://github.com/o/r/actions/runs/1", "--commit", implHead]);
    expect(run.json.errors[0].code).toBe("REF_MISMATCH");
    expect(run.json.errors[0].message).toContain(evidence);
    expect(run.status).toBe(3);
    expect(recordText(root)).toBe(before);

    // The run of the records, spelled with a trailing slash, is the same run.
    const same = await transition(root, ["MERGED", "--ref", "https://github.com/o/r/actions/runs/2/", "--commit", implHead]);
    expect(same.json?.errors).toEqual([]);
    expect(same.json.data.change_state).toBe("MERGED");
  }, 180_000);

  it("evidence-complete on merge counts the approval of an earlier commit and review excused by a waiver (I-96)", async () => {
    const root = repo("SPECIFIED", FEATURE, (r) => {
      waiver(r, "WAV-2026-001", "analyze-clean");
      waiver(r, "WAV-2026-002", "adversarial-review");
      write(r, "scripts/fake-tests.cjs", FAKE_TESTS);
      write(r, ".warrant/local/checks/tests-passed.json", {
        $schema: "warrant://check/1",
        id: "tests-passed",
        version: "1.0.0",
        overrides: "core-sdd:tests-passed",
        level: "L1",
        run: { command: [NODE, "scripts/fake-tests.cjs", "{out}"] }
      });
    });
    const specCommit = git(root, "rev-parse", "HEAD");
    expect((await cli(root, ["check", "add-search", "openspec-validate"])).status).toBe(0);
    const approved = await transition(root, ["APPROVED", "--ref", REVIEW, "--by", "kat"]);
    expect(approved.json?.errors).toEqual([]);
    commitAll(root, "approved");

    // impl-PR: IMPLEMENTING first, code, VERIFYING last.
    git(root, "checkout", "--quiet", "-b", "worktree/add-search");
    expect((await transition(root, ["IMPLEMENTING"])).status).toBe(0);
    write(root, "src/search.ts", "export const search = 1;\n");
    expect((await transition(root, ["VERIFYING"])).status).toBe(0);
    const implHead = commitAll(root, "impl");

    // Before the CI run: only test-report is missing — human-approval (earlier commit) and review (waived) are accounted for.
    const local = await cli(root, ["gate", "add-search", "evidence-complete", "--transition", "VERIFYING->MERGED"]);
    expect(local.json.data.gates).toEqual({ "evidence-complete": "FAIL" });
    expect(local.json.data.findings).toEqual([expect.objectContaining({ code: "EVIDENCE_MISSING", items: ["test-report"] })]);

    const ci = await cli(root, ["verify", "add-search", "--transition", "VERIFYING->MERGED"], CI_ENV);
    expect(ci.json?.errors).toEqual([]);
    expect(ci.json.data.gates).toEqual({
      "analyze-clean": "WAIVED",
      "evidence-complete": "PASS",
      "ids-valid": "PASS",
      "scope-valid": "PASS",
      "tests-passed": "PASS"
    });
    expect(ci.json.data.controller_action).toBe("CONTINUE");
    expect(ci.status).toBe(0);
    const approval = records(root).find((r) => r.kind === "human-approval");
    expect(approval.subject.commit).toBe(specCommit);
    expect(approval.subject.commit).not.toBe(implHead);

    // The CI evidence is an artifact: set it aside, merge, then lay it into the archive branch.
    const artifact = path.join(makeTempDir("warrant-transition-artifact-"), "evidence");
    tempDirs.push(path.dirname(artifact));
    cpSync(path.join(root, EVIDENCE), artifact, { recursive: true });
    git(root, "checkout", "--quiet", "--force", "main");
    git(root, "merge", "--quiet", "--no-ff", "-m", "Merge impl", "worktree/add-search");
    cpSync(artifact, path.join(root, EVIDENCE), { recursive: true, force: true });
    const merged = await transition(root, ["MERGED", "--ref", CI_RUN]);
    expect(merged.json?.errors).toEqual([]);
    expect(merged.json.data).toMatchObject({ commit: implHead, change_state: "MERGED" });
    expect(merged.json.data.gates["evidence-complete"]).toBe("PASS");
  }, 240_000);

  it("records backward transitions without gates and refuses moves outside 04 section 2", async () => {
    const root = repo("VERIFYING", FEATURE);
    const back = await transition(root, ["IMPLEMENTING"]);
    expect(back.json?.errors).toEqual([]);
    expect(back.json.data.recorded).toEqual({ to: "IMPLEMENTING", at: expect.any(String), by: "cli:local" });
    const again = await transition(root, ["SPECIFIED"]);
    expect(again.status).toBe(0);
    expect(readJson(path.join(root, RECORD)).change_state).toBe("SPECIFIED");

    const skip = await transition(root, ["IMPLEMENTING"]);
    expect(skip.json.errors[0].code).toBe("STATE_INVALID");
    expect(skip.status).toBe(3);
    const unknown = await transition(root, ["DONE"]);
    expect(unknown.json.errors[0].code).toBe("USAGE");
  }, 60_000);

  it("ABANDONED removes the change directory after the record, then the record is frozen (SCN-VER-035)", async () => {
    const root = repo("SPECIFIED", FEATURE);
    const run = await transition(root, ["ABANDONED"]);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json.data.removed).toBe("openspec/changes/add-search");
    expect(existsSync(path.join(root, "openspec/changes/add-search"))).toBe(false);
    expect(readJson(path.join(root, RECORD)).change_state).toBe("ABANDONED");

    const status = await cli(root, ["status", "add-search"]);
    expect(status.json.data.stale).toEqual([]);

    const before = recordText(root);
    const again = await transition(root, ["SPECIFIED"]);
    expect(again.json.errors[0].code).toBe("RECORD_FROZEN");
    expect(again.status).toBe(3);
    const classify = await cli(root, ["classify", "add-search", "--base", "main"]);
    expect(classify.json.errors[0].code).toBe("RECORD_FROZEN");
    expect(classify.status).toBe(3);
    expect(recordText(root)).toBe(before);
  }, 60_000);
});
