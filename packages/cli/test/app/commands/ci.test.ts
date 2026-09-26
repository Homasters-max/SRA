/**
 * `warrant ci` in the test process (REQ-VER-011, group 4 of phase-4c): the
 * structure of the record — SCN-VER-078, 090, 105, 107, 108 — refs through the
 * forge — SCN-VER-081, 093 — path rules by kind — SCN-VER-073, 074, 092, 094,
 * 099, 100 — the merge verdict of an impl-PR — SCN-VER-068, 075, 076, 082, 095,
 * 098 — the forge unavailable and `--dry-run` — SCN-VER-084, 085.
 *
 * Each case builds the synced core-sdd project on `main` of `FakeGit`, opens a
 * pull request on a branch and merges it into `main` with a merge commit: HEAD
 * is the result of the merge, as the job `warrant` makes it. `tests-passed` is
 * overridden with a fake command writing junit into `{out}`.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../../../src/commands/check.js";
import { runCi, type CiOptions } from "../../../src/commands/ci.js";
import { runTransition } from "../../../src/commands/transition.js";
import type { CommandResult } from "../../../src/io/output.js";
import { FAKE_REPOSITORY, fakePull } from "../helpers/fakes/forge.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { started } from "../helpers/run.js";

const project = useProjectBuilder();

type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

const RECORD = ".warrant/changes/add-search.json";
const EVIDENCE = ".warrant/evidence/add-search";
const HASH = `sha256:${"0".repeat(64)}`;
const AT = "2026-09-25T10:00:00Z";
const SPEC_PR = `https://github.com/${FAKE_REPOSITORY}/pull/5`;
const IMPL_PR = `https://github.com/${FAKE_REPOSITORY}/pull/9`;
const LOCAL: NodeJS.ProcessEnv = {};
const CI_ENV: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: FAKE_REPOSITORY,
  GITHUB_RUN_ID: "42"
};
const CHORE = { classification: { profiles: ["chore"] } };

function ci(p: ProjectBuilder, env: NodeJS.ProcessEnv = LOCAL, opts: CiOptions = {}): Promise<Result> {
  return invoke(() => runCi(p.ctx, opts, env)) as Promise<Result>;
}

const junit = (failures: number): string =>
  '<?xml version="1.0" encoding="UTF-8" ?>\n' +
  `<testsuites tests="2" failures="${failures}">\n` +
  `  <testsuite name="fake" tests="2" failures="${failures}" errors="0" skipped="0">\n  </testsuite>\n</testsuites>\n`;

/** `tests-passed` overridden by `fake-tests {out}`; `failures` — what its junit report says. */
function fakeTests(p: ProjectBuilder, failures = 0): void {
  p.withCheck(
    "fake-tests",
    { effect: (spec) => writeFileSync(path.resolve(spec.cwd, spec.argv[1] as string, "junit.xml"), junit(failures), "utf8") },
    { id: "tests-passed", args: ["{out}"] }
  );
}

function waiver(p: ProjectBuilder, id: string, gate: string, change = "add-search"): void {
  p.withWaiver({
    id,
    change,
    gate,
    reason: "no producer in the fixture",
    owner: "kat",
    approved_by: "human:kat",
    expires_at: "2099-12-31",
    waiver_state: "ACTIVE"
  });
}

/** The synced project on `main`: `setup` adds files and models before the first commit. */
async function repo(setup?: (p: ProjectBuilder) => void): Promise<ProjectBuilder> {
  const p = project().withOpenspecValidate();
  setup?.(p);
  await p.synced();
  p.commit("base");
  return p;
}

/** Change `add-search` with its record in `state` on `main`, `tests-passed` fake and `spec-approved` waived. */
async function changeRepo(state: string, extra: Record<string, unknown> = CHORE, setup?: (p: ProjectBuilder) => void): Promise<ProjectBuilder> {
  return repo((p) => {
    p.withChange("add-search", { design: "# Design\n", tasks: "# Tasks\n", specs: { search: [] } }).withRecord("add-search", state, extra);
    waiver(p, "WAV-2026-001", "spec-approved");
    fakeTests(p);
    setup?.(p);
  });
}

/** Appends a transition to the record of `add-search` in the working tree. */
function advance(p: ProjectBuilder, to: string, fields: Record<string, unknown> = {}): void {
  const record = p.json(RECORD);
  const forward = to !== "ABANDONED";
  record.transitions.push({ to, at: AT, by: "cli:local", ...(forward ? { effective_policy_hash: HASH, gates: {} } : {}), ...fields });
  record.change_state = to;
  p.write(RECORD, record);
}

/** A pull request: branch `name` from `main`, `work` on it, one commit; `main` merges it with a merge commit. */
function pullRequest(p: ProjectBuilder, name: string, work: (p: ProjectBuilder) => void): { head: string; merge: string } {
  if (p.git.current !== name) p.branch(name, "main");
  work(p);
  const head = p.commit(`${name}: head`);
  p.checkout("main", { force: true });
  const merge = p.merge(name, { label: `Merge ${name}` });
  return { head, merge };
}

function codes(result: Result): string[] {
  return result.errors.map((e) => e.code);
}

function scope(result: Result): string[] {
  return result.errors.filter((e) => e.code === "SCOPE_VIOLATION").map((e) => e.path as string);
}

describe("warrant ci: path rules by kind", () => {
  it("spec-PR: only code is out of scope; the Run, evidence, docs and the Change are its own (SCN-VER-073)", async () => {
    const build = async (withCode: boolean): Promise<Result> => {
      const p = await repo((b) => b.write(".warrant/warrant.json", { ...b.json(".warrant/warrant.json"), paths: { src: "src" } }));
      p.branch("spec/add-search", "main");
      p.withChange("add-search", { design: "# Design\n", tasks: "# Tasks\n", specs: { search: [] } }).withRecord("add-search", "PROPOSED", CHORE);
      p.write(`${EVIDENCE}/EVID-01J8ZQ7Y3N4M5P6Q7R8S9T0V1W.json`, { $schema: "warrant://evidence/1" });
      p.write("docs/adr/0042.md", "# ADR 42\n");
      if (withCode) p.write("src/app.py", "print(1)\n");
      // A Run of the Change, committed as frontends commit it (`current` is ignored by git).
      await started(p, "add-search", { operation: "specify" });
      p.remove(".warrant/runs/current");
      pullRequest(p, "spec/add-search", () => undefined);
      return ci(p);
    };
    const withCode = await build(true);
    expect(withCode.data["kind"]).toBe("spec");
    expect(scope(withCode)).toEqual(["src/app.py"]);
    expect(withCode.exitCode).toBe(1);

    const clean = await build(false);
    expect(clean.errors).toEqual([]);
    expect(clean.exitCode).toBe(0);
    expect(clean.data["transitions"]).toEqual([{ to: "PROPOSED", at: "2026-09-22T09:00:00Z" }]);
    expect(clean.data["gates"]).toBeDefined();
  });

  it("main specs without a Change: kind none, SCOPE_VIOLATION (SCN-VER-074)", async () => {
    const p = await repo((b) => b.withSpec("search"));
    pullRequest(p, "fix/specs", (b) => b.write("openspec/specs/search/spec.md", `${b.read("openspec/specs/search/spec.md")}\nMore.\n`));
    const result = await ci(p);
    expect(result.data["kind"]).toBe("none");
    expect(scope(result)).toEqual(["openspec/specs/search/spec.md"]);
    expect(result.exitCode).toBe(1);
  });

  it("policy path and artifacts of a Change without its record: kind none, both paths (SCN-VER-094)", async () => {
    const p = await changeRepo("SPECIFIED");
    pullRequest(p, "fix/process", (b) => {
      b.write("packs/core-sdd/gates/spec-valid.json", { id: "spec-valid" });
      b.write("openspec/changes/add-search/tasks.md", "# Tasks\n\n- [ ] more\n");
    });
    const result = await ci(p);
    expect(result.data["kind"]).toBe("none");
    expect(scope(result)).toEqual(["openspec/changes/add-search/tasks.md", "packs/core-sdd/gates/spec-valid.json"]);
    expect(result.exitCode).toBe(1);
  });

  it("abandon-PR: main specs beside the record and the removed Change are out of scope (SCN-VER-092)", async () => {
    const p = await changeRepo("SPECIFIED", CHORE, (b) => b.withSpec("search"));
    pullRequest(p, "abandon/add-search", (b) => {
      advance(b, "ABANDONED");
      b.remove("openspec/changes/add-search");
      b.write("openspec/specs/search/spec.md", `${b.read("openspec/specs/search/spec.md")}\nMore.\n`);
    });
    const result = await ci(p);
    expect(result.data["kind"]).toBe("abandon");
    expect(scope(result)).toEqual(["openspec/specs/search/spec.md"]);
    expect(result.exitCode).toBe(1);
  });

  it("spec-PR: a waiver of its own Change is allowed, one of another Change is not (SCN-VER-099)", async () => {
    const p = await changeRepo("PROPOSED");
    pullRequest(p, "spec/add-search", (b) => {
      advance(b, "SPECIFIED", { gates: { "ids-valid": "PASS" } });
      waiver(b, "WAV-2026-020", "adversarial-review");
      waiver(b, "WAV-2026-021", "adversarial-review", "fix-login");
    });
    const result = await ci(p);
    expect(result.data["kind"]).toBe("spec");
    expect(scope(result)).toEqual([".warrant/waivers/WAV-2026-021.json"]);
    expect(result.exitCode).toBe(1);
  });
});

describe("warrant ci: the structure of the record", () => {
  it("a new transition naming evidence without a file, or without effective_policy_hash: RECORD_MISMATCH (SCN-VER-078)", async () => {
    const p = await changeRepo("PROPOSED");
    pullRequest(p, "spec/add-search", (b) => advance(b, "SPECIFIED", { gates: { "ids-valid": "PASS" }, evidence: ["EVID-01J8ZQ7Y3N4M5P6Q7R8S9T0V1W"] }));
    const missing = await ci(p);
    expect(codes(missing)).toEqual(["RECORD_MISMATCH"]);
    expect(missing.errors[0]?.message).toContain("SPECIFIED");
    expect(missing.errors[0]?.message).toContain("evidence: EVID-01J8ZQ7Y3N4M5P6Q7R8S9T0V1W");
    expect(missing.exitCode).toBe(1);

    const q = await changeRepo("PROPOSED");
    pullRequest(q, "spec/add-search", (b) => {
      advance(b, "SPECIFIED", { gates: { "ids-valid": "PASS" } });
      const record = b.json(RECORD);
      delete record.transitions.at(-1).effective_policy_hash;
      b.write(RECORD, record);
    });
    const noHash = await ci(q);
    expect(codes(noHash)).toEqual(["RECORD_MISMATCH"]);
    expect(noHash.errors[0]?.message).toContain("effective_policy_hash");
  });

  it("an impl-PR that drops factory-change from the profiles of the base: RECORD_MISMATCH classification (SCN-VER-105)", async () => {
    const p = await changeRepo("IMPLEMENTING", { classification: { profiles: ["chore", "factory-change"] } });
    pullRequest(p, "worktree/add-search", (b) => {
      b.write("src/search.ts", "export const search = 1;\n");
      advance(b, "VERIFYING");
      const record = b.json(RECORD);
      record.classification.profiles = ["chore"];
      b.write(RECORD, record);
    });
    const result = await ci(p, CI_ENV);
    const mismatch = result.errors.filter((e) => e.code === "RECORD_MISMATCH");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]?.message).toContain("classification");
    expect(mismatch[0]?.message).toContain("factory-change");
    expect(result.exitCode).toBe(1);
  });

  it("an impl-PR that narrows the policy paths: the profile derived by the packs of the base is required (SCN-VER-107)", async () => {
    const p = await changeRepo("IMPLEMENTING", { classification: { profiles: ["feature"] } });
    pullRequest(p, "worktree/add-search", (b) => {
      b.write("packs/core-sdd/profiles/factory-change.json", { id: "factory-change", match: { paths: [".warrant/**"] } });
      advance(b, "VERIFYING");
    });
    const result = await ci(p, CI_ENV);
    const mismatch = result.errors.filter((e) => e.code === "RECORD_MISMATCH");
    expect(mismatch.map((e) => e.message.includes("classification") && e.message.includes("factory-change"))).toEqual([true]);
    expect(result.exitCode).toBe(1);
  });

  it("a bundled pack not held by the lock of the base is the law changed: factory-change required in impl, SCOPE_VIOLATION elsewhere (I-179)", async () => {
    const stale = (b: ProjectBuilder): void => {
      const lock = b.json(".warrant/warrant.lock.json");
      lock.packs["core-sdd"].hash = HASH;
      b.write(".warrant/warrant.lock.json", lock);
    };
    const impl = await changeRepo("IMPLEMENTING");
    stale(impl);
    impl.commit("base: a lock of another core-sdd");
    pullRequest(impl, "worktree/add-search", (b) => advance(b, "VERIFYING"));
    const judged = await ci(impl, CI_ENV);
    const mismatch = judged.errors.filter((e) => e.code === "RECORD_MISMATCH");
    expect(mismatch.map((e) => e.message.includes("classification") && e.message.includes("factory-change"))).toEqual([true]);

    const none = await repo();
    stale(none);
    none.commit("base: a lock of another core-sdd");
    pullRequest(none, "docs/readme", (b) => b.write("docs/readme.md", "# Readme\n"));
    const result = await ci(none);
    expect(scope(result)).toEqual([".warrant/warrant.lock.json"]);
    expect(result.exitCode).toBe(1);
  });
});

/**
 * The spec-PR merged by `S` (pull 5), then an impl-PR whose first commit records
 * `APPROVED` with the ref of the spec-PR and `IMPLEMENTING` (SCN-VER-090).
 */
async function firstImplCommit(mergedBy: string): Promise<ProjectBuilder> {
  const p = await changeRepo("PROPOSED");
  const spec = pullRequest(p, "spec/add-search", (b) => advance(b, "SPECIFIED", { gates: { "ids-valid": "PASS" } }));
  p.withForge({ pulls: [fakePull(5, { mergeCommit: spec.merge, headSha: spec.head, mergedBy, author: "kat" })] });
  pullRequest(p, "worktree/add-search", (b) => {
    advance(b, "APPROVED", { gates: { "human-approval": "PASS" }, ref: SPEC_PR });
    advance(b, "IMPLEMENTING", { gates: { "branch-isolated": "PASS" } });
  });
  return p;
}

describe("warrant ci: refs through the forge", () => {
  it("first commit of an impl-PR: record and ref in order, not VERIFYING yet (SCN-VER-090, SCN-VER-081)", async () => {
    const p = await firstImplCommit("kat");
    const result = await ci(p);
    expect(result.data["kind"]).toBe("impl");
    expect(result.data["transitions"]).toEqual([
      { to: "APPROVED", at: AT, ref: SPEC_PR },
      { to: "IMPLEMENTING", at: AT }
    ]);
    expect(codes(result)).not.toContain("RECORD_MISMATCH");
    expect(codes(result)).not.toContain("REF_NOT_VERIFIED");
    expect(codes(result)).toContain("CHANGE_NOT_VERIFYING");
    // Merged by the maintainer who authored the spec-PR: a finding, not a violation (ADR-0037 п. 5).
    expect(result.data["findings"].filter((f: Data) => f["code"] === "APPROVER_IS_AUTHOR")).toHaveLength(1);
    expect(result.exitCode).toBe(1);
    expect(p.forge.calls).toEqual(["pullRequest 5"]);
  });

  it("the spec-PR merged by a login outside roles.maintainer: REF_NOT_VERIFIED merged_by (SCN-VER-081)", async () => {
    const p = await firstImplCommit("mallory");
    const result = await ci(p);
    const ref = result.errors.filter((e) => e.code === "REF_NOT_VERIFIED");
    expect(ref).toHaveLength(1);
    expect(ref[0]?.message).toContain("merged_by");
    expect(ref[0]?.path).toBe(`${RECORD}#/transitions/2/ref`);
    expect(result.data["findings"].filter((f: Data) => f["code"] === "APPROVER_IS_AUTHOR")).toEqual([]);
    expect(result.exitCode).toBe(1);
  });
});

/**
 * The whole way to an archive-PR: `main` with the record in `IMPLEMENTING`; the
 * impl-PR records `VERIFYING` and is merged by M; `warrant ci` on M writes the
 * CI records; the archive branch commits them with `transition MERGED --ref`
 * of the impl-PR (pull 9); `main` merges the archive branch: HEAD.
 */
async function archivePr(options: { pull?: Record<string, unknown>; work?: (p: ProjectBuilder) => void; record?: (record: Data) => void } = {}): Promise<{ p: ProjectBuilder; m: string; head: string }> {
  const p = await changeRepo("IMPLEMENTING", CHORE, (b) => b.write(".warrant/warrant.json", { ...b.json(".warrant/warrant.json"), paths: { src: "src" } }));
  const impl = pullRequest(p, "worktree/add-search", (b) => {
    b.write("src/search.ts", "export const search = 1;\n");
    advance(b, "VERIFYING", { gates: { "tests-passed": "PASS" } });
  });
  const run = await ci(p, CI_ENV);
  expect(run.errors).toEqual([]);
  p.withForge({ pulls: [fakePull(9, { mergeCommit: impl.merge, headSha: impl.head, ...options.pull })] });

  p.branch("archive/add-search", "main");
  const merged = await invoke(() => runTransition(p.ctx, "add-search", "MERGED", { ref: IMPL_PR }, LOCAL));
  expect(merged.errors).toEqual([]);
  if (options.record !== undefined) {
    const record = p.json(RECORD);
    options.record(record);
    p.write(RECORD, record);
  }
  options.work?.(p);
  p.commit("archive: MERGED");
  p.checkout("main", { force: true });
  p.merge("archive/add-search", { label: "Merge archive" });
  return { p, m: impl.merge, head: impl.head };
}

describe("warrant ci: archive-PR", () => {
  it("an archive-PR with MERGED from CI evidence: ref and record in order; code in it is out of scope (SCN-VER-100)", async () => {
    const { p } = await archivePr({ work: (b) => b.write("src/app.py", "print(1)\n") });
    const result = await ci(p);
    expect(result.data["kind"]).toBe("archive");
    expect(result.data["transitions"]).toEqual([{ to: "MERGED", at: expect.any(String), ref: IMPL_PR }]);
    expect(codes(result)).toEqual(["SCOPE_VIOLATION"]);
    expect(scope(result)).toEqual(["src/app.py"]);
    expect(result.exitCode).toBe(1);
  });

  it("MERGED whose ref is a PR merged by another commit than M: REF_NOT_VERIFIED merge_commit (SCN-VER-093)", async () => {
    const { p } = await archivePr({ pull: { mergeCommit: "c".repeat(40) } });
    const result = await ci(p);
    expect(codes(result)).toEqual(["REF_NOT_VERIFIED"]);
    expect(result.errors[0]?.message).toContain("merge_commit");
    expect(result.exitCode).toBe(1);
  });

  it("MERGED with a PASS gate of checks but no CI record: ci_evidence; with empty gates: policy (SCN-VER-108)", async () => {
    const local = await archivePr({
      record: (record) => {
        const merged = record.transitions.at(-1);
        merged.evidence = [];
      }
    });
    const noCi = await ci(local.p);
    const reasons = noCi.errors.filter((e) => e.code === "RECORD_MISMATCH").map((e) => e.message);
    expect(reasons.some((m) => m.includes("ci_evidence") && m.includes("tests-passed"))).toBe(true);
    expect(noCi.exitCode).toBe(1);

    const empty = await archivePr({ record: (record) => void (record.transitions.at(-1).gates = {}) });
    const policy = await ci(empty.p);
    expect(policy.errors.filter((e) => e.code === "RECORD_MISMATCH").map((e) => e.message.includes(": policy: "))).toEqual([true]);
    expect(policy.exitCode).toBe(1);
  });

  it("the forge unreachable while a ref needs it: FORGE_UNAVAILABLE with the hint, exit 3 (SCN-VER-084)", async () => {
    const { p } = await archivePr();
    p.forge.unavailable = true;
    const result = await ci(p);
    expect(result.errors[0]?.code).toBe("FORGE_UNAVAILABLE");
    expect(result.errors[0]?.hint).toContain("gh auth login");
    expect(result.errors[0]?.hint).toContain("GH_TOKEN");
    expect(result.exitCode).toBe(3);
  });
});

/** `main` with the record in `IMPLEMENTING` (`extra`), the impl-PR recording `VERIFYING` with `src/search.ts`, merged: HEAD. */
async function implPr(extra: Record<string, unknown> = CHORE, setup?: (p: ProjectBuilder) => void): Promise<{ p: ProjectBuilder; head: string; merge: string }> {
  const p = await changeRepo("IMPLEMENTING", extra, setup);
  const { head, merge } = pullRequest(p, "worktree/add-search", (b) => {
    b.write("src/search.ts", "export const search = 1;\n");
    advance(b, "VERIFYING", { gates: { "tests-passed": "PASS" } });
  });
  return { p, head, merge };
}

const HIGH = { classification: { profiles: ["chore"], risk_level: "HIGH" } };

describe("warrant ci: the merge verdict of an impl-PR", () => {
  it("checks on the result of the merge write CI evidence; human-approval deferred; no commit (SCN-VER-075, SCN-VER-068)", async () => {
    const { p, head, merge } = await implPr(HIGH);
    const commits = p.git.commits.size;
    const result = await ci(p, CI_ENV);
    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.data["kind"]).toBe("impl");
    expect(result.data["deferred"]).toEqual(["human-approval"]);
    expect(result.data["gates"]["tests-passed"]).toBe("PASS");
    expect(result.data["artifact"]).toEqual({ name: "evidence-add-search-1", path: EVIDENCE });
    const ids = result.data["evidence"] as string[];
    expect(ids.length).toBeGreaterThan(0);
    const tree = await p.git.treeId(merge);
    for (const id of ids) {
      const record = p.json(`${EVIDENCE}/${id}.json`);
      expect(record.attestation).toEqual({ type: "ci", ref: "https://github.com/kat/project/actions/runs/42" });
      expect(record.subject).toMatchObject({ commit: head, base_commit: await p.git.resolveCommit(`${merge}^1`), tree });
    }
    expect(p.git.commits.size).toBe(commits);
    expect(await p.git.head()).toBe(merge);

    const second = await ci(p, { ...CI_ENV, GITHUB_RUN_ATTEMPT: "2" });
    expect(second.data["artifact"]["name"]).toBe("evidence-add-search-2");
  });

  it("junit with a failure: tests-passed FAIL, GATE_NOT_PASSED (SCN-VER-076)", async () => {
    const { p } = await implPr();
    fakeTests(p, 1);
    const result = await ci(p, CI_ENV);
    expect(result.data["gates"]["tests-passed"]).toBe("FAIL");
    expect(result.errors.filter((e) => e.code === "GATE_NOT_PASSED").map((e) => e.message.includes("tests-passed"))).toEqual([true]);
    expect(result.exitCode).toBe(1);
  });

  it("code changed without a post event: FRONTEND_HOOKS_INACTIVE in findings, exit 0 (SCN-VER-082)", async () => {
    const { p } = await implPr(CHORE, (b) => b.write(".warrant/warrant.json", { ...b.json(".warrant/warrant.json"), paths: { src: "src" } }));
    const result = await ci(p, CI_ENV);
    expect(result.errors).toEqual([]);
    const hooks = result.data["findings"].filter((f: Data) => f["code"] === "FRONTEND_HOOKS_INACTIVE");
    expect(hooks.map((f: Data) => f["paths"])).toEqual([["src/search.ts"]]);
    expect(result.exitCode).toBe(0);
  });

  it("a check over its timeout: CHECK_TIMEOUT, tests-passed BLOCKED, exit 3 (SCN-VER-095)", async () => {
    const { p } = await implPr();
    p.checks.on("fake-tests", { timedOut: true });
    const result = await ci(p, CI_ENV);
    expect(codes(result)).toContain("CHECK_TIMEOUT");
    expect(result.data["gates"]["tests-passed"]).toBe("BLOCKED");
    expect(result.exitCode).toBe(3);
  });

  it("a later PROVEN record of another run does not count: the attempt's NOT_PROVEN fails the gate (SCN-VER-098)", async () => {
    const { p } = await implPr();
    const other = await ci(p, { ...CI_ENV, GITHUB_RUN_ID: "41" });
    expect(other.exitCode).toBe(0);
    for (const id of other.data["evidence"] as string[]) {
      const rel = `${EVIDENCE}/${id}.json`;
      p.write(rel, { ...p.json(rel), created_at: "2099-01-01T00:00:00Z" });
    }
    fakeTests(p, 1);
    const result = await ci(p, CI_ENV);
    expect(result.data["gates"]["tests-passed"]).toBe("FAIL");
    expect(codes(result)).toContain("GATE_NOT_PASSED");
    expect(result.exitCode).toBe(1);
  });

  it("--dry-run: kind, checks and would_write without running a check or asking the forge (SCN-VER-085)", async () => {
    const { p } = await implPr();
    const result = await ci(p, CI_ENV, { dryRun: true });
    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({ kind: "impl", change: "add-search", dry_run: true, would_write: [`${EVIDENCE}/`] });
    expect(result.data["checks"]).toContain("tests-passed");
    expect(p.checks.calls).toEqual([]);
    expect(p.forge.calls).toEqual([]);
  });

  it("WARRANT_STATE_DIR: USAGE, exit 3", async () => {
    const { p } = await implPr();
    const result = await ci(p, { ...CI_ENV, WARRANT_STATE_DIR: path.join(p.root, "state") });
    expect(codes(result)).toEqual(["USAGE"]);
    expect(result.exitCode).toBe(3);
  });

  it("a local run of runCheck leaves nothing for ci to count (the attempt of this call only)", async () => {
    const { p } = await implPr();
    const local = await invoke(() => runCheck(p.ctx, "add-search", ["tests-passed"], {}, LOCAL));
    expect(local.errors).toEqual([]);
    // Outside GitHub Actions the records of this call carry attestation none: gates L1 are BLOCKED (REQ-VER-003).
    const result = await ci(p, LOCAL);
    expect(result.data["gates"]["tests-passed"]).toBe("BLOCKED");
    expect(codes(result)).toContain("GATE_NOT_PASSED");
    expect(result.exitCode).toBe(1);
  });
});
