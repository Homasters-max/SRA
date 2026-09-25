/**
 * `warrant transition` in the test process (REQ-VER-007, design §9, §10):
 * forward transitions through the gate engine — SCN-VER-029, 030 —
 * `human-approval` by `--ref --by` — SCN-VER-031, 032 — `MERGED` on the
 * commit of CI evidence after a merge — SCN-VER-033, 034 — only on the head of
 * the impl-PR — SCN-VER-050, 051 — and only from the run of `--ref` —
 * SCN-VER-052 — `ABANDONED` with the freeze of the record — SCN-VER-035 — and
 * `--dry-run` — SCN-KRN-135, 136.
 * Moved from e2e (ADR-0025, task 5.1); the parse of argv and the exit code of
 * the binary stay in `e2e/transition.test.ts`.
 *
 * Each case builds the synced core-sdd project with Change `add-search` and
 * commits it on `main` of `FakeGit`. The check `openspec-validate` is answered
 * by `FakeCheckRunner` (`withOpenspecValidate`); `tests-passed` is overridden
 * with a fake command that writes junit into `{out}`.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../../../src/commands/check.js";
import { runClassify } from "../../../src/commands/classify.js";
import { runGate } from "../../../src/commands/gate.js";
import { runStatus } from "../../../src/commands/status.js";
import { runTransition, type TransitionOptions } from "../../../src/commands/transition.js";
import { runVerify } from "../../../src/commands/verify.js";
import type { CommandResult } from "../../../src/io/output.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { withoutDryRun, writtenBeyond } from "../helpers/dry-run.js";
import { validateErrors } from "../helpers/validate.js";

const project = useProjectBuilder();

const RECORD = ".warrant/changes/add-search.json";
const EVIDENCE = ".warrant/evidence/add-search";
const REVIEW = "https://github.com/o/r/pull/7#pullrequestreview-1";
const CI_RUN = "https://github.com/o/r/actions/runs/42";

/** Environment of a local run: no CI attestation, whatever the environment of the test runner. */
const LOCAL: NodeJS.ProcessEnv = {};

/** Environment of a GitHub Actions run: records get `attestation.type: "ci"` (P-15). */
const CI_ENV: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "o/r",
  GITHUB_RUN_ID: "42"
};

/** The data of a result, read as the envelope is. */
type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

function transition(p: ProjectBuilder, target: string, opts: TransitionOptions = {}): Promise<Result> {
  return invoke(() => runTransition(p.ctx, "add-search", target, opts, LOCAL));
}

function check(p: ProjectBuilder, id: string): Promise<Result> {
  return invoke(() => runCheck(p.ctx, "add-search", [id], {}, LOCAL));
}

function verifyMerge(p: ProjectBuilder, env: NodeJS.ProcessEnv): Promise<Result> {
  return invoke(() => runVerify(p.ctx, "add-search", { transition: "VERIFYING->MERGED" }, env));
}

function readJson(p: ProjectBuilder, rel: string): any {
  return JSON.parse(p.read(rel));
}

/** Evidence records of `add-search`, parsed. */
function records(p: ProjectBuilder): any[] {
  const dir = path.join(p.root, EVIDENCE);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("EVID-"))
    .map((name) => readJson(p, `${EVIDENCE}/${name}`));
}

const JUNIT =
  '<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites tests="2" failures="0">\n' +
  '  <testsuite name="fake" tests="2" failures="0" errors="0" skipped="0">\n  </testsuite>\n</testsuites>\n';

/** `tests-passed` overridden by `fake-tests {out}`, which writes a passing junit report into `{out}`. */
function fakeTests(p: ProjectBuilder): void {
  p.withCheck(
    "fake-tests",
    { effect: (spec) => writeFileSync(path.resolve(spec.cwd, spec.argv[1] as string, "junit.xml"), JUNIT, "utf8") },
    { id: "tests-passed", args: ["{out}"] }
  );
}

function waiver(p: ProjectBuilder, id: string, gate: string): void {
  p.withWaiver({
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
async function repo(state: string, extra: Record<string, unknown>, setup?: (p: ProjectBuilder) => void): Promise<ProjectBuilder> {
  const p = project()
    .withChange("add-search", { design: "# Design\n", tasks: "# Tasks\n", specs: { search: [] } })
    .withRecord("add-search", state, extra)
    .withOpenspecValidate();
  setup?.(p);
  await p.synced();
  p.commit("base");
  return p;
}

function head(p: ProjectBuilder): string {
  return p.git.headCommit()?.sha as string;
}

const FEATURE = { classification: { profiles: ["feature"] } };
const CHORE = { classification: { profiles: ["chore"] } };

describe("warrant transition", () => {
  it("records a forward transition whose gates passed, with verdicts and evidence (SCN-VER-029)", async () => {
    const p = await repo("PROPOSED", FEATURE);
    const checked = await check(p, "openspec-validate");
    expect(checked.exitCode).toBe(0);
    const evid = checked.data["checks"][0].evidence as string;

    const run = await transition(p, "SPECIFIED");
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data).toMatchObject({
      transition: "PROPOSED->SPECIFIED",
      change_state: "SPECIFIED",
      gates: { "ids-valid": "PASS", "required-artifacts-present": "PASS", "spec-valid": "PASS" },
      controller_action: "CONTINUE"
    });

    const stored = readJson(p, RECORD);
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
    expect(run.data["recorded"]).toEqual(last);
    expect(await validateErrors(p)).toEqual([]);
  });

  it("refuses with GATES_NOT_PASSED when a gate fails and leaves the record as it was (SCN-VER-030)", async () => {
    const p = await repo("PROPOSED", FEATURE, (b) => b.withOpenspecValidate(false));
    expect((await check(p, "openspec-validate")).exitCode).toBe(0);
    const before = p.read(RECORD);

    const run = await transition(p, "SPECIFIED");
    expect(run.ok).toBe(false);
    expect(run.errors[0]?.code).toBe("GATES_NOT_PASSED");
    expect(run.data["gates"]["spec-valid"]).toBe("FAIL");
    expect(run.data["rule"]).toBe("gate-failed");
    expect(run.exitCode).toBe(2);
    expect(p.read(RECORD)).toBe(before);

    // No evidence at all: BLOCKED, the kernel fallback waits — still refused, still exit 2.
    const bare = await repo("PROPOSED", FEATURE);
    const blocked = await transition(bare, "SPECIFIED");
    expect(blocked.errors[0]?.code).toBe("GATES_NOT_PASSED");
    expect(blocked.data["gates"]["spec-valid"]).toBe("BLOCKED");
    expect(blocked.exitCode).toBe(2);
  });

  it("writes human-approval evidence from --ref and --by before the gates and records APPROVED with ref (SCN-VER-031)", async () => {
    const p = await repo("SPECIFIED", FEATURE, (b) => waiver(b, "WAV-2026-001", "adversarial-review"));

    // Without --ref: usage error, nothing written.
    const noRef = await transition(p, "APPROVED", { by: "kat" });
    expect(noRef.errors[0]?.code).toBe("USAGE");
    expect(noRef.exitCode).toBe(3);
    // Without --by: the policy has gate human-approval on SPECIFIED->APPROVED.
    const noBy = await transition(p, "APPROVED", { ref: REVIEW });
    expect(noBy.errors[0]?.code).toBe("USAGE");
    expect(records(p)).toEqual([]);

    // No spec-report yet: the approval is written anyway and the gates refuse.
    const first = await transition(p, "APPROVED", { ref: REVIEW, by: "kat" });
    expect(first.errors[0]?.code).toBe("GATES_NOT_PASSED");
    expect(first.data["gates"]["human-approval"]).toBe("PASS");
    expect(first.data["gates"]["spec-valid"]).toBe("BLOCKED");
    const approvals = records(p).filter((r) => r.kind === "human-approval");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      evidence_status: "PROVEN",
      produced_by: { type: "human", id: "kat" },
      attestation: { type: "human-review", ref: REVIEW },
      subject: { commit: head(p) }
    });
    // --ref is only checked to be a URL; the record says so (R-10).
    expect(approvals[0].limitations).toContain("ref not verified (phase 4: warrant ci)");
    expect(readJson(p, RECORD).change_state).toBe("SPECIFIED");

    const checked = await check(p, "openspec-validate");
    expect(checked.exitCode).toBe(0);
    const run = await transition(p, "APPROVED", { ref: REVIEW, by: "kat" });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data["gates"]).toEqual({
      "adversarial-review": "WAIVED",
      "blocking-unknowns-resolved": "PASS",
      "human-approval": "PASS",
      "ids-valid": "PASS",
      "required-artifacts-present": "PASS",
      "spec-valid": "PASS"
    });
    // The repeated transition reused the approval the pre-filter still admits.
    expect(run.data["approval"]).toEqual({ evidence: approvals[0].id, reused: true });
    expect(records(p).filter((r) => r.kind === "human-approval")).toHaveLength(1);

    const last = readJson(p, RECORD).transitions.at(-1);
    expect(last).toMatchObject({ to: "APPROVED", by: "cli:local", ref: REVIEW });
    expect(last.evidence).toEqual([approvals[0].id, checked.data["checks"][0].evidence].sort());
    expect(await validateErrors(p)).toEqual([]);
  });

  it("refuses --by outside the role with ROLE_REQUIRED and writes no evidence (SCN-VER-032)", async () => {
    const p = await repo("SPECIFIED", FEATURE);
    const before = p.read(RECORD);
    const run = await transition(p, "APPROVED", { ref: REVIEW, by: "bob" });
    expect(run.errors[0]?.code).toBe("ROLE_REQUIRED");
    expect(run.exitCode).toBe(3);
    expect(records(p)).toEqual([]);
    expect(p.read(RECORD)).toBe(before);
  });

  it("records MERGED on the commit of CI evidence after the impl-PR is merged (SCN-VER-033, SCN-VER-034)", async () => {
    const p = await repo("VERIFYING", CHORE, (b) => {
      // The record never went through APPROVED: the contract check is waived, the case is about the commit and the run.
      waiver(b, "WAV-2026-001", "spec-approved");
      fakeTests(b);
    });
    const fork = head(p);

    // impl-PR: code, then the CI run records evidence on its head.
    p.branch("worktree/add-search");
    p.write("src/search.ts", "export const search = 1;\n");
    const implHead = p.commit("impl");
    const ci = await verifyMerge(p, CI_ENV);
    expect(ci.data["checks"][0]).toMatchObject({ id: "tests-passed", evidence_status: "PROVEN" });
    expect(ci.data["gates"]["tests-passed"]).toBe("PASS");

    // A commit that never reaches main: not merged (SCN-VER-034).
    p.branch("stray", "main");
    p.write("src/stray.ts", "export {};\n");
    // Only the file: the untracked CI records must stay untracked across the checkouts.
    const stray = p.commit("stray", { paths: ["src/stray.ts"] });

    // Merge the impl-PR with a merge commit, then the archive branch carries the CI records.
    p.checkout("main");
    p.merge("worktree/add-search", { label: "Merge impl" });
    p.branch("archive/add-search");
    p.commit("evidence from CI");

    const before = p.read(RECORD);
    const notMerged = await transition(p, "MERGED", { ref: CI_RUN, commit: stray });
    expect(notMerged.errors[0]?.code).toBe("COMMIT_NOT_MERGED");
    expect(notMerged.exitCode).toBe(3);
    expect(p.read(RECORD)).toBe(before);

    const noRef = await transition(p, "MERGED", { commit: implHead });
    expect(noRef.errors[0]?.code).toBe("USAGE");

    // Without --commit: the commit of the freshest record, which is the impl head.
    const run = await transition(p, "MERGED", { ref: CI_RUN });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data).toMatchObject({
      transition: "VERIFYING->MERGED",
      commit: implHead,
      base: fork,
      gates: { "ids-valid": "PASS", "scope-valid": "PASS", "spec-approved": "WAIVED", "tests-passed": "PASS" },
      change_state: "MERGED"
    });
    const last = readJson(p, RECORD).transitions.at(-1);
    expect(last).toMatchObject({ to: "MERGED", by: "cli:local", ref: CI_RUN, evidence: [ci.data["checks"][0].evidence] });
    expect(await validateErrors(p)).toEqual([]);
  });

  it("refuses MERGED on a commit that is not the head of the merged impl-PR (SCN-VER-050, review R-1)", async () => {
    const p = await repo("VERIFYING", CHORE, fakeTests);

    // impl-PR: CI evidence on an early commit, then a later commit outside the impl-PR scope.
    p.branch("worktree/add-search");
    p.write("src/search.ts", "export const search = 1;\n");
    const early = p.commit("impl, early");
    const ci = await verifyMerge(p, CI_ENV);
    expect(ci.data["gates"]["tests-passed"]).toBe("PASS");
    p.write("openspec/specs/other/spec.md", "# other\n");
    const late = p.commit("impl, late", { paths: ["openspec/specs/other/spec.md"] });

    p.checkout("main");
    const merge = p.merge("worktree/add-search", { label: "Merge impl" });
    p.branch("archive/add-search");
    p.commit("evidence of the early CI run");
    const before = p.read(RECORD);

    // The freshest record is on the early commit: refused, not judged on base...early.
    const byDefault = await transition(p, "MERGED", { ref: CI_RUN });
    expect(byDefault.errors[0]?.code).toBe("COMMIT_NOT_MERGED");
    expect(byDefault.errors[0]?.message).toContain(`not the head of the impl-PR merged by ${merge} (head ${late})`);
    expect(byDefault.exitCode).toBe(3);
    const explicit = await transition(p, "MERGED", { ref: CI_RUN, commit: early });
    expect(explicit.errors[0]?.code).toBe("COMMIT_NOT_MERGED");
    // A commit of the base line itself has no PR boundary.
    const onLine = await transition(p, "MERGED", { ref: CI_RUN, commit: `${merge}^1` });
    expect(onLine.errors[0]?.code).toBe("COMMIT_NOT_MERGED");
    expect(onLine.errors[0]?.message).toContain("first-parent line");
    expect(p.read(RECORD)).toBe(before);

    // The head passes the commit check; its gates see the late commit.
    const onHead = await transition(p, "MERGED", { ref: CI_RUN, commit: late });
    expect(onHead.errors[0]?.code).toBe("GATES_NOT_PASSED");
    expect(onHead.data).toMatchObject({ commit: late, gates: { "scope-valid": "FAIL", "tests-passed": "BLOCKED" } });
    expect(p.read(RECORD)).toBe(before);
  });

  it("refuses MERGED after a fast-forward merge of the impl-PR (SCN-VER-051, review R-1)", async () => {
    const p = await repo("VERIFYING", CHORE, fakeTests);
    p.branch("worktree/add-search");
    p.write("src/a.ts", "export const a = 1;\n");
    p.commit("impl 1");
    p.write("src/b.ts", "export const b = 1;\n");
    const implHead = p.commit("impl 2");
    await verifyMerge(p, CI_ENV);
    p.checkout("main");
    p.merge("worktree/add-search", { ff: "only" });
    p.branch("archive/add-search");
    p.commit("evidence from CI");

    // Before R-1 the base was head^1 and the diff held "impl 2" only.
    const run = await transition(p, "MERGED", { ref: CI_RUN, commit: implHead });
    expect(run.errors[0]?.code).toBe("COMMIT_NOT_MERGED");
    expect(run.errors[0]?.message).toContain("fast-forward");
  });

  it("refuses MERGED with REF_MISMATCH when the CI records come from another run (SCN-VER-052)", async () => {
    const p = await repo("VERIFYING", CHORE, (b) => {
      // The record never went through APPROVED: the contract check is waived, the case is about the commit and the run.
      waiver(b, "WAV-2026-001", "spec-approved");
      fakeTests(b);
    });
    p.branch("worktree/add-search");
    p.write("src/search.ts", "export const search = 1;\n");
    const implHead = p.commit("impl");
    const ci = await verifyMerge(p, { ...CI_ENV, GITHUB_RUN_ID: "2" });
    expect(ci.data["gates"]["tests-passed"]).toBe("PASS");
    const evidence = ci.data["checks"][0].evidence as string;
    p.checkout("main");
    p.merge("worktree/add-search", { label: "Merge impl" });
    p.branch("archive/add-search");
    p.commit("evidence from CI run 2");
    const before = p.read(RECORD);

    const run = await transition(p, "MERGED", { ref: "https://github.com/o/r/actions/runs/1", commit: implHead });
    expect(run.errors[0]?.code).toBe("REF_MISMATCH");
    expect(run.errors[0]?.message).toContain(evidence);
    expect(run.exitCode).toBe(3);
    expect(p.read(RECORD)).toBe(before);

    // The run of the records, spelled with a trailing slash, is the same run.
    const same = await transition(p, "MERGED", { ref: "https://github.com/o/r/actions/runs/2/", commit: implHead });
    expect(same.errors).toEqual([]);
    expect(same.data["change_state"]).toBe("MERGED");
  });

  it("evidence-complete on merge counts the approval of an earlier commit and review excused by a waiver (I-96)", async () => {
    const p = await repo("SPECIFIED", FEATURE, (b) => {
      waiver(b, "WAV-2026-001", "analyze-clean");
      waiver(b, "WAV-2026-002", "adversarial-review");
      fakeTests(b);
    });
    const specCommit = head(p);
    expect((await check(p, "openspec-validate")).exitCode).toBe(0);
    const approved = await transition(p, "APPROVED", { ref: REVIEW, by: "kat" });
    expect(approved.errors).toEqual([]);
    p.commit("approved");

    // impl-PR: IMPLEMENTING first, code, VERIFYING last.
    p.branch("worktree/add-search");
    expect((await transition(p, "IMPLEMENTING")).exitCode).toBe(0);
    p.write("src/search.ts", "export const search = 1;\n");
    expect((await transition(p, "VERIFYING")).exitCode).toBe(0);
    const implHead = p.commit("impl");

    // Before the CI run: only test-report is missing — human-approval (earlier commit) and review (waived) are accounted for.
    const local: Result = await invoke(() =>
      runGate(p.ctx, "add-search", ["evidence-complete"], { transition: "VERIFYING->MERGED" }, LOCAL)
    );
    expect(local.data["gates"]).toEqual({ "evidence-complete": "FAIL" });
    expect(local.data["findings"]).toEqual([expect.objectContaining({ code: "EVIDENCE_MISSING", items: ["test-report"] })]);

    const ci = await verifyMerge(p, CI_ENV);
    expect(ci.errors).toEqual([]);
    expect(ci.data["gates"]).toEqual({
      // Computed and clean: the waiver on it is not needed (REQ-VER-004, I-166).
      "analyze-clean": "PASS",
      "evidence-complete": "PASS",
      "ids-valid": "PASS",
      "scope-valid": "PASS",
      // Only code changed after APPROVED: the contract is the approved one (SCN-VER-046).
      "spec-approved": "PASS",
      "tests-passed": "PASS"
    });
    expect(ci.data["controller_action"]).toBe("CONTINUE");
    expect(ci.exitCode).toBe(0);
    const approval = records(p).find((r) => r.kind === "human-approval");
    expect(approval.subject.commit).toBe(specCommit);
    expect(approval.subject.commit).not.toBe(implHead);

    // The CI evidence is an artifact: set it aside, merge, then lay it into the archive branch.
    const aside = mkdtempSync(path.join(tmpdir(), "warrant-app-artifact-"));
    try {
      const artifact = path.join(aside, "evidence");
      cpSync(path.join(p.root, EVIDENCE), artifact, { recursive: true });
      p.checkout("main", { force: true });
      p.merge("worktree/add-search", { label: "Merge impl" });
      cpSync(artifact, path.join(p.root, EVIDENCE), { recursive: true, force: true });
    } finally {
      rmSync(aside, { recursive: true, force: true });
    }
    const merged = await transition(p, "MERGED", { ref: CI_RUN });
    expect(merged.errors).toEqual([]);
    expect(merged.data).toMatchObject({ commit: implHead, change_state: "MERGED" });
    expect(merged.data["gates"]["evidence-complete"]).toBe("PASS");
  });

  it("records backward transitions without gates and refuses moves outside 04 section 2", async () => {
    const p = await repo("VERIFYING", FEATURE);
    const back = await transition(p, "IMPLEMENTING");
    expect(back.errors).toEqual([]);
    expect(back.data["recorded"]).toEqual({ to: "IMPLEMENTING", at: expect.any(String), by: "cli:local" });
    const again = await transition(p, "SPECIFIED");
    expect(again.exitCode).toBe(0);
    expect(readJson(p, RECORD).change_state).toBe("SPECIFIED");

    const skip = await transition(p, "IMPLEMENTING");
    expect(skip.errors[0]?.code).toBe("STATE_INVALID");
    expect(skip.exitCode).toBe(3);
    const unknown = await transition(p, "DONE");
    expect(unknown.errors[0]?.code).toBe("USAGE");
  });

  it("ABANDONED removes the change directory after the record, then the record is frozen (SCN-VER-035)", async () => {
    const p = await repo("SPECIFIED", FEATURE);
    const run = await transition(p, "ABANDONED");
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data["removed"]).toBe("openspec/changes/add-search");
    expect(existsSync(path.join(p.root, "openspec/changes/add-search"))).toBe(false);
    expect(readJson(p, RECORD).change_state).toBe("ABANDONED");

    const status: Result = await invoke(() => runStatus(p.ctx, "add-search", LOCAL));
    expect(status.data["stale"]).toEqual([]);

    const before = p.read(RECORD);
    const again = await transition(p, "SPECIFIED");
    expect(again.errors[0]?.code).toBe("RECORD_FROZEN");
    expect(again.exitCode).toBe(3);
    const classify = await invoke(() => runClassify(p.ctx, "add-search", { base: "main" }));
    expect(classify.errors[0]?.code).toBe("RECORD_FROZEN");
    expect(classify.exitCode).toBe(3);
    expect(p.read(RECORD)).toBe(before);
  });
});

describe("warrant transition --dry-run (REQ-KRN-034)", () => {
  function dry(p: ProjectBuilder, target: string, opts: TransitionOptions = {}): Promise<Result> {
    return invoke(() => runTransition(p.dryRun(), "add-search", target, opts, LOCAL));
  }

  it("prints what SPECIFIED would record, writes nothing, and the real run writes only would_write[] (SCN-KRN-135)", async () => {
    const p = await repo("PROPOSED", FEATURE);
    expect((await check(p, "openspec-validate")).exitCode).toBe(0);
    const before = p.tree();

    const run = await dry(p, "SPECIFIED");
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data["dry_run"]).toBe(true);
    expect(run.data["would_write"]).toEqual([RECORD, `${EVIDENCE}/manifest.json`]);
    expect(p.tree()).toEqual(before);

    const real = await transition(p, "SPECIFIED");
    expect(real.exitCode).toBe(0);
    expect(real.data["dry_run"]).toBeUndefined();
    expect(withoutDryRun(run.data)).toEqual(withoutDryRun(real.data));
    expect(writtenBeyond(before, p.tree(), run.data["would_write"])).toEqual([]);
  });

  it("refuses with the same error and exit code as the real run when a gate fails (SCN-KRN-136)", async () => {
    const p = await repo("PROPOSED", FEATURE, (b) => b.withOpenspecValidate(false));
    expect((await check(p, "openspec-validate")).exitCode).toBe(0);
    const before = p.tree();

    const run = await dry(p, "SPECIFIED");
    expect(p.tree()).toEqual(before);
    const real = await transition(p, "SPECIFIED");
    expect(run.errors[0]?.code).toBe("GATES_NOT_PASSED");
    expect(run.errors).toEqual(real.errors);
    expect(run.exitCode).toBe(real.exitCode);
    expect(run.data["dry_run"]).toBe(true);
    expect(withoutDryRun(run.data)).toEqual(withoutDryRun(real.data));
  });

  it("judges the human-approval record it would write, and writes neither it nor the record", async () => {
    const p = await repo("SPECIFIED", FEATURE, (b) => waiver(b, "WAV-2026-001", "adversarial-review"));
    expect((await check(p, "openspec-validate")).exitCode).toBe(0);
    const before = p.tree();

    const run = await dry(p, "APPROVED", { ref: REVIEW, by: "kat" });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data["gates"]["human-approval"]).toBe("PASS");
    expect(run.data["approval"]).toEqual({ evidence: expect.stringMatching(/^EVID-/), reused: false });
    expect(run.data["would_write"]).toEqual([RECORD, `${EVIDENCE}/${run.data["approval"].evidence}.json`, `${EVIDENCE}/manifest.json`]);
    expect(p.tree()).toEqual(before);
    expect(records(p).filter((r) => r.kind === "human-approval")).toEqual([]);

    const real = await transition(p, "APPROVED", { ref: REVIEW, by: "kat" });
    expect(withoutDryRun(run.data)).toEqual(withoutDryRun(real.data));
    expect(writtenBeyond(before, p.tree(), run.data["would_write"])).toEqual([]);
  });

  it("ABANDONED under --dry-run keeps the directory and the record, and names both", async () => {
    const p = await repo("SPECIFIED", FEATURE);
    const before = p.tree();
    const run = await dry(p, "ABANDONED");
    expect(run.errors).toEqual([]);
    expect(run.data["removed"]).toBe("openspec/changes/add-search");
    expect(run.data["would_write"]).toEqual([RECORD, "openspec/changes/add-search"]);
    expect(p.tree()).toEqual(before);
    const refused = await dry(p, "DONE");
    expect(refused.errors[0]?.code).toBe("USAGE");
    expect(refused.exitCode).toBe(3);
    expect(refused.data).toEqual({ dry_run: true, would_write: [] });
  });
});
