/**
 * `warrant transition` in the test process (REQ-VER-007, design §9, §10):
 * forward transitions through the gate engine — SCN-VER-029, 030 —
 * `human-approval` by `--ref --by` — SCN-VER-031, 032 — `MERGED` on the
 * commit of CI evidence after a merge, judged by the tree of the merge —
 * SCN-VER-033, 034, 069, 070 — only on the head of the impl-PR — SCN-VER-050,
 * 051 — only from one CI run — SCN-VER-052 — with `--ref` the URL of the
 * impl-PR — SCN-VER-071 — `ABANDONED` with the freeze of the record — SCN-VER-035 — and
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

import { runAnalyze } from "../../../src/commands/analyze.js";
import { runCheck } from "../../../src/commands/check.js";
import { runClassify } from "../../../src/commands/classify.js";
import { runGate } from "../../../src/commands/gate.js";
import { runStart } from "../../../src/commands/run.js";
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
/** The impl-PR: the `--ref` of `MERGED` (ADR-0037 п. 5). */
const IMPL_PR = "https://github.com/o/r/pull/9";
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

/** Evidence records of `add-search`, parsed. */
function records(p: ProjectBuilder): any[] {
  const dir = path.join(p.root, EVIDENCE);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("EVID-"))
    .map((name) => p.json(`${EVIDENCE}/${name}`));
}

/**
 * The record `id` as `warrant ci` writes it on the result of a merge (REQ-VER-001, SCN-VER-068):
 * `subject` gets `extra` (`base_commit` — the tip of the base, `tree` — the tree of the merge).
 */
function ciSubject(p: ProjectBuilder, id: string, extra: Record<string, unknown>): void {
  const rel = `${EVIDENCE}/${id}.json`;
  const json = p.json(rel);
  p.write(rel, { ...json, subject: { ...json.subject, ...extra } });
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

    const stored = p.json(RECORD);
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

  it("the refusal under STOP is exit 1: the controller action enters the code (REQ-VER-007)", async () => {
    const p = await repo("PROPOSED", FEATURE, (b) =>
      b.write(".warrant/local/controller/rules.json", {
        $schema: "warrant://controller-rules/1",
        rules: [{ id: "stop-on-blocked", when: { gate_verdict: "BLOCKED" }, action: "STOP" }]
      })
    );
    const before = p.read(RECORD);

    const run = await transition(p, "SPECIFIED");
    expect(run.errors.map((e) => e.code)).toEqual(["GATES_NOT_PASSED"]);
    expect(run.data["gates"]["spec-valid"]).toBe("BLOCKED");
    expect(run.data).toMatchObject({ controller_action: "STOP", rule: "stop-on-blocked" });
    expect(run.exitCode).toBe(1);
    expect(p.read(RECORD)).toBe(before);
  });

  it("the refusal under CONTINUE is exit 2, never 0: GATES_NOT_PASSED is of class wait (REQ-VER-007)", async () => {
    // A pack without controller rules: a FAIL no rule matches is CONTINUE (REQ-VER-005).
    const p = project()
      .write(".warrant/warrant.json", {
        $schema: "warrant://config/1",
        kernel: "0.1",
        openspec: "1.13.x",
        packs: { mini: { version: "^1.0.0" } },
        roles: { maintainer: ["kat"] }
      })
      .remove(".warrant/warrant.lock.json")
      .write(".warrant/local/mini/pack.json", {
        $schema: "warrant://pack/1",
        id: "mini",
        version: "1.0.0",
        kernel: ">=0.1 <0.11",
        description: "One gate, one profile, no controller rules.",
        depends_on: {},
        provides: { gates: ["gates/required-artifacts-present.json"], profiles: ["profiles/feature.json"] }
      })
      .write(".warrant/local/mini/gates/required-artifacts-present.json", {
        $schema: "warrant://gate/1",
        id: "required-artifacts-present",
        version: "1.0.0",
        level: "L0",
        waivable: false
      })
      .write(".warrant/local/mini/profiles/feature.json", {
        $schema: "warrant://profile/1",
        id: "feature",
        version: "1.0.0",
        artifacts: { required: ["proposal", "design"] },
        gates: { "PROPOSED->SPECIFIED": ["required-artifacts-present"] }
      })
      .withChange("add-search", { tasks: "# Tasks\n" })
      .withRecord("add-search", "PROPOSED", FEATURE);
    p.commit("base");
    const before = p.read(RECORD);

    const run = await transition(p, "SPECIFIED");
    expect(run.errors.map((e) => e.code)).toEqual(["GATES_NOT_PASSED"]);
    expect(run.data["gates"]).toEqual({ "required-artifacts-present": "FAIL" });
    expect(run.data).toMatchObject({ controller_action: "CONTINUE", rule: null });
    expect(run.exitCode).toBe(2);
    expect(p.read(RECORD)).toBe(before);
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
    // --ref is the URL of the spec-PR (a fragment allowed), not of any act (ADR-0037 п. 5).
    const notPr = await transition(p, "APPROVED", { ref: CI_RUN, by: "kat" });
    expect(notPr.errors[0]?.code).toBe("USAGE");
    expect(notPr.errors[0]?.hint).toContain("spec-PR");
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
    expect(p.json(RECORD).change_state).toBe("SPECIFIED");

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

    const last = p.json(RECORD).transitions.at(-1);
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

  it("records MERGED with --ref of the impl-PR on the commit of CI evidence made on the merge tree (SCN-VER-033, SCN-VER-034, SCN-VER-069)", async () => {
    const p = await repo("VERIFYING", CHORE, (b) => {
      // The record never went through APPROVED: the contract check is waived, the case is about the commit and the run.
      waiver(b, "WAV-2026-001", "spec-approved");
      fakeTests(b);
    });
    const fork = head(p);

    // impl-PR: code; meanwhile main moves on with another PR.
    p.branch("worktree/add-search");
    p.write("src/search.ts", "export const search = 1;\n");
    const implHead = p.commit("impl");
    p.checkout("main");
    p.write("docs/other.md", "# Other\n");
    const tip = p.commit("other PR");

    // The CI run records evidence on the impl head; as `warrant ci` it names the tip of main and the merge tree.
    p.checkout("worktree/add-search");
    const ci = await verifyMerge(p, CI_ENV);
    expect(ci.data["checks"][0]).toMatchObject({ id: "tests-passed", evidence_status: "PROVEN" });
    expect(ci.data["gates"]["tests-passed"]).toBe("PASS");
    const evidence = ci.data["checks"][0].evidence as string;

    // A commit that never reaches main: not merged (SCN-VER-034).
    p.branch("stray", "main");
    p.write("src/stray.ts", "export {};\n");
    // Only the file: the untracked CI records must stay untracked across the checkouts.
    const stray = p.commit("stray", { paths: ["src/stray.ts"] });

    // Merge the impl-PR with a merge commit M, then the archive branch carries the CI records.
    p.checkout("main");
    const merge = p.merge("worktree/add-search", { label: "Merge impl" });
    const tree = (await p.git.treeId(merge)) as string;
    ciSubject(p, evidence, { base_commit: tip, tree });
    p.branch("archive/add-search");
    p.commit("evidence from CI");

    const before = p.read(RECORD);
    const notMerged = await transition(p, "MERGED", { ref: IMPL_PR, commit: stray });
    expect(notMerged.errors[0]?.code).toBe("COMMIT_NOT_MERGED");
    expect(notMerged.exitCode).toBe(3);
    expect(p.read(RECORD)).toBe(before);

    const noRef = await transition(p, "MERGED", { commit: implHead });
    expect(noRef.errors[0]?.code).toBe("USAGE");

    // Without --commit: the commit of the freshest record, which is the impl head. The record names
    // the tip of main, not the fork point: the tree of M admits it instead of the base (SCN-VER-069).
    const run = await transition(p, "MERGED", { ref: IMPL_PR });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data).toMatchObject({
      transition: "VERIFYING->MERGED",
      commit: implHead,
      base: fork,
      gates: { "ids-valid": "PASS", "scope-valid": "PASS", "spec-approved": "WAIVED", "tests-passed": "PASS" },
      change_state: "MERGED"
    });
    expect(run.data["findings"].filter((f: Data) => f["code"] === "STALE")).toEqual([]);
    const last = p.json(RECORD).transitions.at(-1);
    expect(last).toMatchObject({ to: "MERGED", by: "cli:local", ref: IMPL_PR, evidence: [evidence] });
    expect(await validateErrors(p)).toEqual([]);
  });

  it("sets aside CI evidence whose merge tree is not the tree of M: STALE tree, MERGED refused (SCN-VER-070)", async () => {
    const p = await repo("VERIFYING", CHORE, (b) => {
      waiver(b, "WAV-2026-001", "spec-approved");
      fakeTests(b);
    });
    p.branch("worktree/add-search");
    p.write("src/search.ts", "export const search = 1;\n");
    const implHead = p.commit("impl");
    const ci = await verifyMerge(p, CI_ENV);
    const evidence = ci.data["checks"][0].evidence as string;
    // The CI run merged into an older main; another PR landed before the merge.
    const stale = (await p.git.treeId(implHead)) as string;
    p.checkout("main");
    p.write("docs/other.md", "# Other\n");
    // Only the file: the untracked CI records must stay untracked across the checkouts.
    p.commit("other PR", { paths: ["docs/other.md"] });
    p.merge("worktree/add-search", { label: "Merge impl" });
    ciSubject(p, evidence, { tree: stale });
    p.branch("archive/add-search");
    p.commit("evidence from CI");
    const before = p.read(RECORD);

    const run = await transition(p, "MERGED", { ref: IMPL_PR, commit: implHead });
    expect(run.errors[0]?.code).toBe("GATES_NOT_PASSED");
    expect(run.data["gates"]["tests-passed"]).toBe("BLOCKED");
    expect(run.data["findings"]).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "STALE", evidence, reason: "tree" })])
    );
    expect(p.read(RECORD)).toBe(before);
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
    const byDefault = await transition(p, "MERGED", { ref: IMPL_PR });
    expect(byDefault.errors[0]?.code).toBe("COMMIT_NOT_MERGED");
    expect(byDefault.errors[0]?.message).toContain(`not the head of the impl-PR merged by ${merge} (head ${late})`);
    expect(byDefault.exitCode).toBe(3);
    const explicit = await transition(p, "MERGED", { ref: IMPL_PR, commit: early });
    expect(explicit.errors[0]?.code).toBe("COMMIT_NOT_MERGED");
    // A commit of the base line itself has no PR boundary.
    const onLine = await transition(p, "MERGED", { ref: IMPL_PR, commit: `${merge}^1` });
    expect(onLine.errors[0]?.code).toBe("COMMIT_NOT_MERGED");
    expect(onLine.errors[0]?.message).toContain("first-parent line");
    expect(p.read(RECORD)).toBe(before);

    // The head passes the commit check; its gates see the late commit.
    const onHead = await transition(p, "MERGED", { ref: IMPL_PR, commit: late });
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
    const run = await transition(p, "MERGED", { ref: IMPL_PR, commit: implHead });
    expect(run.errors[0]?.code).toBe("COMMIT_NOT_MERGED");
    expect(run.errors[0]?.message).toContain("fast-forward");
  });

  it("refuses MERGED with REF_MISMATCH when the CI records of the verdicts come from two runs (SCN-VER-052)", async () => {
    const p = await repo("VERIFYING", CHORE, (b) => {
      // The record never went through APPROVED: the contract check is waived, the case is about the commit and the run.
      waiver(b, "WAV-2026-001", "spec-approved");
      fakeTests(b);
      // tests-passed strengthened to two kinds, so its verdict rests on two records.
      b.write(".warrant/local/gates/tests-passed.json", {
        $schema: "warrant://gate/1",
        id: "tests-passed",
        version: "1.0.1",
        overrides: "core-sdd:tests-passed",
        level: "L1",
        requires_evidence: [
          { kind: "test-report", status: "PROVEN" },
          { kind: "spec-report", status: "PROVEN" }
        ],
        waivable: false,
        accepts_attestation: ["ci"]
      });
    });
    p.branch("worktree/add-search");
    p.write("src/search.ts", "export const search = 1;\n");
    const implHead = p.commit("impl");
    const run1 = await invoke(() => runCheck(p.ctx, "add-search", ["openspec-validate"], {}, { ...CI_ENV, GITHUB_RUN_ID: "1" }));
    const run2 = await invoke(() => runCheck(p.ctx, "add-search", ["tests-passed"], {}, { ...CI_ENV, GITHUB_RUN_ID: "2" }));
    const spec = run1.data["checks"][0].evidence as string;
    const tests = run2.data["checks"][0].evidence as string;
    p.checkout("main");
    p.merge("worktree/add-search", { label: "Merge impl" });
    p.branch("archive/add-search");
    p.commit("evidence from CI runs 1 and 2");
    const before = p.read(RECORD);

    // --ref is the impl-PR; the run comes from the records, and they name two.
    const run = await transition(p, "MERGED", { ref: IMPL_PR, commit: implHead });
    expect(run.errors[0]?.code).toBe("REF_MISMATCH");
    expect(run.errors[0]?.message).toContain(spec);
    expect(run.errors[0]?.message).toContain(tests);
    expect(run.exitCode).toBe(3);
    expect(p.read(RECORD)).toBe(before);

    // Both records of run 2 (a trailing / aside): one run, MERGED recorded.
    const rel = `${EVIDENCE}/${spec}.json`;
    p.write(rel, { ...p.json(rel), attestation: { type: "ci", ref: "https://github.com/o/r/actions/runs/2/" } });
    const same = await transition(p, "MERGED", { ref: IMPL_PR, commit: implHead });
    expect(same.errors).toEqual([]);
    expect(same.data["change_state"]).toBe("MERGED");
    expect(p.json(RECORD).transitions.at(-1).evidence).toEqual([spec, tests].sort());
  });

  it("takes …/runs/7 and …/runs/7/attempts/1 for one CI run: MERGED without REF_MISMATCH (A-31, SCN-VER-052)", async () => {
    const p = await repo("VERIFYING", CHORE, (b) => {
      waiver(b, "WAV-2026-001", "spec-approved");
      fakeTests(b);
      // tests-passed strengthened to two kinds, so its verdict rests on two records.
      b.write(".warrant/local/gates/tests-passed.json", {
        $schema: "warrant://gate/1",
        id: "tests-passed",
        version: "1.0.1",
        overrides: "core-sdd:tests-passed",
        level: "L1",
        requires_evidence: [
          { kind: "test-report", status: "PROVEN" },
          { kind: "spec-report", status: "PROVEN" }
        ],
        waivable: false,
        accepts_attestation: ["ci"]
      });
    });
    p.branch("worktree/add-search");
    p.write("src/search.ts", "export const search = 1;\n");
    const implHead = p.commit("impl");
    const env = { ...CI_ENV, GITHUB_RUN_ID: "7" };
    const spec = (await invoke(() => runCheck(p.ctx, "add-search", ["openspec-validate"], {}, env))).data["checks"][0].evidence as string;
    const tests = (await invoke(() => runCheck(p.ctx, "add-search", ["tests-passed"], {}, env))).data["checks"][0].evidence as string;
    // The run without an attempt names attempt 1 (REQ-VER-011): the same run attempt as the explicit form.
    const rel = `${EVIDENCE}/${spec}.json`;
    expect(p.json(rel).attestation).toEqual({ type: "ci", ref: "https://github.com/o/r/actions/runs/7" });
    p.write(rel, { ...p.json(rel), attestation: { type: "ci", ref: "https://github.com/o/r/actions/runs/7/attempts/1" } });
    p.checkout("main");
    p.merge("worktree/add-search", { label: "Merge impl" });
    p.branch("archive/add-search");
    p.commit("evidence from CI run 7");

    const run = await transition(p, "MERGED", { ref: IMPL_PR, commit: implHead });
    expect(run.errors).toEqual([]);
    expect(run.data["change_state"]).toBe("MERGED");
    expect(p.json(RECORD).transitions.at(-1).evidence).toEqual([spec, tests].sort());
  });

  it("refuses a --ref of MERGED that is not a pull request with USAGE and a hint, writing nothing (SCN-VER-071)", async () => {
    const p = await repo("VERIFYING", CHORE, fakeTests);
    const before = p.read(RECORD);
    for (const ref of [CI_RUN, "https://github.com/o/r/pull/9/files", "https://github.com/o/r/pulls", "https://github.com/o/r/pull/x"]) {
      const run = await transition(p, "MERGED", { ref, by: "kat" });
      expect(run.errors[0]?.code, ref).toBe("USAGE");
      expect(run.errors[0]?.hint, ref).toContain("impl-PR");
      expect(run.exitCode).toBe(3);
    }
    expect(records(p)).toEqual([]);
    expect(p.read(RECORD)).toBe(before);
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
    const merged = await transition(p, "MERGED", { ref: IMPL_PR });
    expect(merged.errors).toEqual([]);
    expect(merged.data).toMatchObject({ commit: implHead, change_state: "MERGED" });
    expect(merged.data["gates"]["evidence-complete"]).toBe("PASS");
  });

  it("judges analyze-clean and scope-valid of MERGED on the head of the impl-PR, not on the archive working tree (R-21)", async () => {
    const SEARCH = [{ name: "Search by text", id: "REQ-SRC-004", scenarios: [{ name: "Match", id: "SCN-SRC-010" }] }];
    const RUN = "RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y";
    const TASKS = "openspec/changes/add-search/tasks.md";
    const p = await repo("VERIFYING", FEATURE, (b) => {
      const config = JSON.parse(b.read(".warrant/warrant.json")) as Record<string, unknown>;
      b.write(".warrant/warrant.json", { ...config, paths: { tests: "tests" } });
      b.withChange("add-search", { design: "# Design\n", tasks: "# Tasks\n\n- [x] 1.1 Search by text (SCN-SRC-010)\n", specs: { search: SEARCH } });
    });

    // impl-PR: code, a test naming the SCN and the Run of the Change.
    p.branch("worktree/add-search");
    p.write("src/search.ts", "export const search = 1;\n");
    p.write("tests/test_search.py", "# SCN-SRC-010\n");
    p.write(`.warrant/runs/${RUN}.json`, {
      $schema: "warrant://run/1",
      id: RUN,
      change: "add-search",
      operation: "implement",
      write_scope: ["src/**"],
      scope: [],
      branch: "worktree/add-search",
      started_at: "2026-09-25T10:00:00Z",
      finished_at: "2026-09-25T10:12:00Z",
      run_state: "SUCCEEDED",
      context_hash: `sha256:${"1".repeat(64)}`,
      effective_policy_hash: `sha256:${"2".repeat(64)}`,
      guard_events: []
    });
    const implHead = p.commit("impl");
    p.checkout("main");
    p.merge("worktree/add-search", { label: "Merge impl" });

    // The archive branch moves on: tasks.md loses the SCN, the Run file is gone.
    p.branch("archive/add-search");
    p.write(TASKS, "# Tasks\n\n- [x] 1.1 Search\n");
    p.remove(`.warrant/runs/${RUN}.json`);
    p.commit("archive edits");
    const working: Result = await invoke(() => runAnalyze(p.ctx, "add-search"));
    expect(working.data["findings"]).toEqual([expect.objectContaining({ code: "UNSATISFIED", id: "REQ-SRC-004" })]);

    const run = await transition(p, "MERGED", { ref: IMPL_PR, commit: implHead });
    expect(run.data["commit"]).toBe(implHead);
    expect(run.data["gates"]["analyze-clean"]).toBe("PASS");
    expect(run.data["gates"]["scope-valid"]).toBe("PASS");
    expect(run.data["findings"].filter((f: Data) => f["gate"] === "analyze-clean" || f["gate"] === "scope-valid")).toEqual([]);
  });

  it("records backward transitions without gates and refuses moves outside 04 section 2", async () => {
    const p = await repo("VERIFYING", FEATURE);
    const back = await transition(p, "IMPLEMENTING");
    expect(back.errors).toEqual([]);
    expect(back.data["recorded"]).toEqual({ to: "IMPLEMENTING", at: expect.any(String), by: "cli:local" });
    const again = await transition(p, "SPECIFIED");
    expect(again.exitCode).toBe(0);
    expect(p.json(RECORD).change_state).toBe("SPECIFIED");

    const skip = await transition(p, "IMPLEMENTING");
    expect(skip.errors[0]?.code).toBe("STATE_INVALID");
    expect(skip.exitCode).toBe(3);
    const unknown = await transition(p, "DONE");
    expect(unknown.errors[0]?.code).toBe("USAGE");
  });

  it("SPECIFIED -> PROPOSED: a rework before APPROVED, no gates, the history kept, a specify Run starts; once APPROVED — STATE_INVALID (SCN-VER-157)", async () => {
    const p = await repo("SPECIFIED", FEATURE);
    const before = p.json(RECORD).transitions;
    const back = await transition(p, "PROPOSED", { by: "kat" });
    expect(back.errors).toEqual([]);
    expect(back.exitCode).toBe(0);
    expect(back.data["recorded"]).toEqual({ to: "PROPOSED", at: expect.any(String), by: "cli:local" });
    expect(p.warnings.join("")).toContain("--by is ignored");
    expect(p.json(RECORD).change_state).toBe("PROPOSED");
    expect(p.json(RECORD).transitions.slice(0, before.length)).toEqual(before);
    const run = await invoke(() => runStart(p.ctx, "add-search", { operation: "specify" }, {}));
    expect(run.errors).toEqual([]);

    for (const reached of [
      async () => repo("APPROVED", FEATURE),
      async () => {
        const q = await repo("VERIFYING", FEATURE);
        // The fixture record holds PROPOSED only: the history of an approved Change.
        const record = q.json(RECORD);
        q.write(RECORD, { ...record, transitions: [...record.transitions, { to: "APPROVED", at: "2026-09-23T09:00:00Z", by: "cli:local" }] });
        await transition(q, "IMPLEMENTING");
        await transition(q, "SPECIFIED");
        return q;
      }
    ]) {
      const q = await reached();
      const frozen = q.read(RECORD);
      const refused = await transition(q, "PROPOSED");
      expect(refused.errors[0]?.code).toBe("STATE_INVALID");
      expect(refused.exitCode).toBe(3);
      expect(q.read(RECORD)).toBe(frozen);
    }
  });

  it("ABANDONED removes the change directory after the record, then the record is frozen (SCN-VER-035)", async () => {
    const p = await repo("SPECIFIED", FEATURE);
    const run = await transition(p, "ABANDONED");
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data["removed"]).toBe("openspec/changes/add-search");
    expect(existsSync(path.join(p.root, "openspec/changes/add-search"))).toBe(false);
    expect(p.json(RECORD).change_state).toBe("ABANDONED");

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
