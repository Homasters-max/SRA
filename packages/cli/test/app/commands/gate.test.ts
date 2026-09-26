/**
 * `warrant gate` in the test process (REQ-VER-003, REQ-VER-004, REQ-VER-005):
 * the computed L0 gates on diffs and branches of `FakeGit` — SCN-VER-014, 019,
 * 020, 021, 022, 023 — the output shape and the exit code of the controller, a
 * project controller rule it skips (SCN-VER-049), and `spec-approved` after an
 * approval made through the commands (SCN-VER-046, 047, 048), the own state of
 * the Change in `scope-valid` (SCN-VER-060, 061) and a `review` record bound to
 * the spec tree (SCN-VER-056, 057), `analyze-clean` of an archived Change
 * (SCN-VER-072), a CI workflow as a policy path (SCN-SDD-026). Moved from e2e
 * (ADR-0025, task 5.1); the parse of argv and the exit code of the binary stay
 * in `e2e/gate.test.ts`.
 *
 * Each case builds the synced core-sdd project with Change `add-search`, makes
 * `main` with one commit and, where a diff is needed, a branch with a second
 * one. The check `openspec-validate` is answered by `FakeCheckRunner`
 * (`withOpenspecValidate`).
 */
import { readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../../../src/commands/check.js";
import { runGate, type GateOptions } from "../../../src/commands/gate.js";
import { runStatus } from "../../../src/commands/status.js";
import { runTransition, type TransitionOptions } from "../../../src/commands/transition.js";
import { runVerify } from "../../../src/commands/verify.js";
import { runWaive } from "../../../src/commands/waive.js";
import { specTreeHash } from "../../../src/core/git/facts.js";
import type { CommandResult } from "../../../src/io/output.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { validateErrors } from "../helpers/validate.js";

const project = useProjectBuilder();

/** Environment of a local run: no CI attestation, whatever the environment of the test runner. */
const LOCAL: NodeJS.ProcessEnv = {};

const FEATURE = { classification: { profiles: ["feature"] } };
const FACTORY = { classification: { profiles: ["factory-change"] } };
const REVIEW = "https://github.com/o/r/pull/7#pullrequestreview-1";
const MERGE = "VERIFYING->MERGED";
const SPEC = "openspec/changes/add-search/specs/search/spec.md";

/** The data of a result, read as the envelope is. */
type Data = Record<string, any>;

function gate(p: ProjectBuilder, ids: string[], opts: GateOptions = {}): Promise<CommandResult & { data: Data }> {
  return invoke(() => runGate(p.ctx, "add-search", ids, opts, LOCAL));
}

function check(p: ProjectBuilder, id: string): Promise<CommandResult & { data: Data }> {
  return invoke(() => runCheck(p.ctx, "add-search", [id], {}, LOCAL));
}

function transition(p: ProjectBuilder, target: string, opts: TransitionOptions = {}): Promise<CommandResult & { data: Data }> {
  return invoke(() => runTransition(p.ctx, "add-search", target, opts, LOCAL));
}

/**
 * The synced project with record `add-search` and every artifact of `feature`,
 * `main` holding everything written so far in one commit.
 */
async function repo(state: string, extra: Record<string, unknown> = {}, setup?: (p: ProjectBuilder) => void): Promise<ProjectBuilder> {
  const p = project()
    .withChange("add-search", { design: "# Design\n", tasks: "# Tasks\n", specs: { search: [] } })
    .withRecord("add-search", state, extra)
    .withOpenspecValidate();
  setup?.(p);
  await p.synced();
  p.commit("base");
  return p;
}

/** A branch off the checked-out one with one more commit made by `change`. */
function branch(p: ProjectBuilder, name: string, change: (p: ProjectBuilder) => void): void {
  p.branch(name);
  change(p);
  p.commit(name);
}

/**
 * A Change approved through the commands — `check openspec-validate` and
 * `transition APPROVED --ref --by kat` on `main`, so the `human-approval`
 * record is the one `transition` writes — then an impl-PR branch: `IMPLEMENTING`,
 * the edits of `impl`, `VERIFYING`, one commit. Returns the approval record
 * and the commit it was made on.
 */
async function approvedThenImplemented(
  impl: (p: ProjectBuilder) => void
): Promise<{ p: ProjectBuilder; approval: string; approvedOn: string }> {
  const p = await repo("SPECIFIED", FEATURE, (b) =>
    b.withWaiver({
      id: "WAV-2026-001",
      change: "add-search",
      gate: "adversarial-review",
      reason: "no review producer in the fixture",
      risk: "LOW",
      compensating_controls: ["maintainer review"],
      owner: "human:kat",
      approved_by: "human:kat",
      expires_at: "2099-12-31",
      waiver_state: "ACTIVE"
    })
  );
  const approvedOn = p.git.headCommit()?.sha as string;
  expect((await check(p, "openspec-validate")).exitCode).toBe(0);
  const approved = await transition(p, "APPROVED", { ref: REVIEW, by: "kat" });
  expect(approved.errors).toEqual([]);
  const approval = approved.data["approval"].evidence as string;
  p.commit("approved");

  p.branch("worktree/add-search");
  expect((await transition(p, "IMPLEMENTING")).errors).toEqual([]);
  p.write("src/search.ts", "export const search = 1;\n");
  impl(p);
  expect((await transition(p, "VERIFYING")).errors).toEqual([]);
  p.commit("impl");
  return { p, approval, approvedOn };
}

describe("warrant gate", () => {
  it("prints transition, gates and findings; a local record passes PROPOSED->SPECIFIED and is written to manifest.gates", async () => {
    const p = await repo("PROPOSED", FEATURE);
    expect((await check(p, "openspec-validate")).exitCode).toBe(0);

    const run = await gate(p, []);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.ok).toBe(true);
    expect(run.data).toEqual({
      transition: "PROPOSED->SPECIFIED",
      gates: { "ids-valid": "PASS", "required-artifacts-present": "PASS", "spec-valid": "PASS" },
      findings: [],
      controller_action: "CONTINUE",
      rule: null
    });
    const manifest = JSON.parse(readFileSync(path.join(p.root, ".warrant/evidence/add-search/manifest.json"), "utf8"));
    expect(manifest.gates).toEqual(run.data["gates"]);
    expect(await validateErrors(p)).toEqual([]);

    // One gate by id; an id outside the transition is a usage error.
    const one = await gate(p, ["spec-valid"]);
    expect(one.data["gates"]).toEqual({ "spec-valid": "PASS" });
    const outside = await gate(p, ["scope-valid"]);
    expect(outside.errors[0]?.code).toBe("USAGE");
    expect(outside.exitCode).toBe(3);
    const bad = await gate(p, [], { transition: "PROPOSED->MERGED" });
    expect(bad.errors[0]?.code).toBe("USAGE");
  });

  it("a record of the previous commit is STALE and the gate BLOCKED with NO_EVIDENCE (SCN-VER-013)", async () => {
    const p = await repo("PROPOSED", FEATURE);
    const checked = await check(p, "openspec-validate");
    expect(checked.exitCode).toBe(0);
    p.write("src/search.ts", "export {};\n");
    p.commit("next");

    const run = await gate(p, []);
    expect(run.data["gates"]["spec-valid"]).toBe("BLOCKED");
    expect(run.data["findings"]).toContainEqual(
      expect.objectContaining({ code: "STALE", evidence: checked.data["checks"][0].evidence, reason: "commit" })
    );
    expect(run.data["findings"]).toContainEqual(expect.objectContaining({ code: "NO_EVIDENCE", gate: "spec-valid" }));
    // BLOCKED alone matches no rule of core-sdd: the kernel fallback waits (SCN-VER-039).
    expect(run.data).toMatchObject({ controller_action: "WAIT", next: "verify", rule: "verify-incomplete" });
    expect(run.exitCode).toBe(2);
  });

  it("factory-golden-passed is NOT_APPLICABLE when the diff misses applies_when (SCN-VER-014)", async () => {
    const p = await repo("VERIFYING", FACTORY);
    branch(p, "worktree/add-search", (b) => b.write("src/search.ts", "export {};\n"));
    const run = await gate(p, ["factory-golden-passed"], { transition: MERGE });
    expect(run.data["gates"]).toEqual({ "factory-golden-passed": "NOT_APPLICABLE" });
    expect(run.data["findings"]).toEqual([]);
    expect(run.exitCode).toBe(0);
  });

  it("impl-PR touching openspec/specs/** fails scope-valid with that path (SCN-VER-019)", async () => {
    const p = await repo("VERIFYING", FEATURE);
    branch(p, "worktree/add-search", (b) => {
      b.write("src/search.ts", "export {};\n");
      b.write("openspec/specs/search/spec.md", "# Search\n");
    });
    const run = await gate(p, [], { transition: MERGE });
    expect(run.data["transition"]).toBe(MERGE);
    expect(run.data["gates"]["scope-valid"]).toBe("FAIL");
    expect(run.data["findings"]).toContainEqual(
      expect.objectContaining({ code: "SCOPE_VIOLATION", gate: "scope-valid", paths: ["openspec/specs/search/spec.md"] })
    );
    // FAIL → WAIT by gate-failed, exit 2 (SCN-VER-024 end to end).
    expect(run.data["controller_action"]).toBe("WAIT");
    expect(run.data["rule"]).toBe("gate-failed");
    expect(run.ok).toBe(false);
    expect(run.exitCode).toBe(2);
    // Every other gate of the transition is computed too.
    expect(Object.keys(run.data["gates"])).toEqual([
      "analyze-clean",
      "evidence-complete",
      "ids-valid",
      "scope-valid",
      "spec-approved",
      "tests-passed"
    ]);
    // analyze-clean is computed: the Change has no finding (REQ-VER-004, I-166).
    expect(run.data["gates"]["analyze-clean"]).toBe("PASS");
  });

  it("archive-PR inside its own archive directory passes scope-valid (SCN-VER-020)", async () => {
    const p = await repo("MERGED", FEATURE, (b) =>
      b.write(".warrant/local/overlays/archive-scope.json", {
        $schema: "warrant://overlay/1",
        id: "archive-scope",
        version: "1.0.0",
        match: {},
        gates: { "MERGED->ARCHIVED": ["scope-valid"] }
      })
    );
    branch(p, "archive/add-search", (b) => {
      // `git mv openspec/changes/add-search openspec/changes/archive/2026-09-22-add-search`
      renameSync(path.join(b.root, "openspec/changes/add-search"), path.join(b.root, "openspec/changes/archive/2026-09-22-add-search"));
      b.write("openspec/specs/search/spec.md", "# Search\n");
    });
    const run = await gate(p, ["scope-valid"], { transition: "MERGED->ARCHIVED" });
    expect(run.errors).toEqual([]);
    expect(run.data["gates"]).toEqual({ "scope-valid": "PASS" });
    expect(run.exitCode).toBe(0);
  });

  it("policy paths fail scope-valid without factory-change and pass with it (SCN-VER-021)", async () => {
    const policyPath = (b: ProjectBuilder): void => void b.write("packs/core-sdd/gates/spec-valid.json", { changed: true });
    const feature = await repo("VERIFYING", FEATURE);
    branch(feature, "worktree/add-search", policyPath);
    const fail = await gate(feature, ["scope-valid"], { transition: MERGE });
    expect(fail.data["gates"]).toEqual({ "scope-valid": "FAIL" });
    expect(fail.data["findings"][0]).toMatchObject({ code: "SCOPE_VIOLATION", paths: ["packs/core-sdd/gates/spec-valid.json"] });

    const factory = await repo("VERIFYING", FACTORY);
    branch(factory, "worktree/add-search", policyPath);
    const pass = await gate(factory, ["scope-valid"], { transition: MERGE });
    expect(pass.data["gates"]).toEqual({ "scope-valid": "PASS" });
  });

  it("a CI workflow is a policy path: without reclassification scope-valid of a feature Change fails naming it (SCN-SDD-026)", async () => {
    const p = await repo("VERIFYING", FEATURE);
    branch(p, "worktree/add-search", (b) => void b.write(".github/workflows/ci.yml", "name: ci\n"));
    const run = await gate(p, ["scope-valid"], { transition: MERGE });
    expect(run.data["gates"]).toEqual({ "scope-valid": "FAIL" });
    expect(run.data["findings"][0]).toMatchObject({ code: "SCOPE_VIOLATION", paths: [".github/workflows/ci.yml"] });
  });

  it("an open blocking UNKNOWN fails blocking-unknowns-resolved naming it (SCN-VER-022)", async () => {
    const p = await repo("SPECIFIED", { ...FEATURE, unknowns: [{ id: "UNK-SRC-001", text: "Which index?", blocking: true }] });
    const run = await gate(p, [], { transition: "SPECIFIED->APPROVED" });
    expect(run.data["gates"]["blocking-unknowns-resolved"]).toBe("FAIL");
    expect(run.data["findings"]).toContainEqual(
      expect.objectContaining({ code: "BLOCKING_UNKNOWN", gate: "blocking-unknowns-resolved", items: ["UNK-SRC-001"] })
    );
    expect(run.data["controller_action"]).toBe("WAIT");
    expect(run.exitCode).toBe(2);
  });

  it("branch-isolated fails on main (SCN-VER-023) and passes on a branch", async () => {
    const p = await repo("APPROVED", FEATURE);
    const onMain = await gate(p, [], { transition: "APPROVED->IMPLEMENTING" });
    expect(onMain.data["gates"]).toEqual({ "branch-isolated": "FAIL" });
    expect(onMain.data["findings"][0]).toMatchObject({ code: "BRANCH_NOT_ISOLATED", items: ["main"] });
    expect(onMain.exitCode).toBe(2);

    p.branch("worktree/add-search");
    const onBranch = await gate(p, []);
    expect(onBranch.data).toMatchObject({ transition: "APPROVED->IMPLEMENTING", gates: { "branch-isolated": "PASS" } });
    expect(onBranch.exitCode).toBe(0);
  });

  it("a project rule cannot CONTINUE past BLOCKED in gate, verify and status (SCN-VER-049)", async () => {
    const p = await repo("PROPOSED", FEATURE, (b) =>
      b.write(".warrant/local/controller/rules.json", {
        $schema: "warrant://controller-rules/1",
        rules: [{ id: "let-blocked-through", when: { gate_verdict: "BLOCKED" }, action: "CONTINUE" }]
      })
    );
    const ignored = expect.objectContaining({ code: "CONTROLLER_RULE_IGNORED", rule: "let-blocked-through" });

    // No spec-report yet: spec-valid is BLOCKED, the project rule is skipped, the kernel fallback waits.
    const run = await gate(p, []);
    expect(run.data["gates"]["spec-valid"]).toBe("BLOCKED");
    expect(run.data["findings"]).toContainEqual(ignored);
    expect(run.data).toMatchObject({ controller_action: "WAIT", next: "verify", rule: "verify-incomplete" });
    expect(run.exitCode).toBe(2);

    const status: CommandResult & { data: Data } = await invoke(() => runStatus(p.ctx, "add-search", LOCAL));
    expect(status.data["verification"].findings).toContainEqual(ignored);
    expect(status.data["verification"].rule).toBe("verify-incomplete");

    // verify of SPECIFIED->APPROVED: spec-valid passes, adversarial-review and human-approval stay BLOCKED.
    const verify: CommandResult & { data: Data } = await invoke(() =>
      runVerify(p.ctx, "add-search", { transition: "SPECIFIED->APPROVED" }, LOCAL)
    );
    expect(verify.data["gates"]["adversarial-review"]).toBe("BLOCKED");
    expect(verify.data["findings"]).toContainEqual(ignored);
    expect(verify.data).toMatchObject({ controller_action: "WAIT", next: "verify", rule: "verify-incomplete" });
    expect(verify.exitCode).toBe(2);
    expect(await validateErrors(p)).toEqual([]);
  });

  it("spec-approved passes when only design.md and tasks.md changed after APPROVED (SCN-VER-046)", async () => {
    const { p, approval, approvedOn } = await approvedThenImplemented((b) => {
      b.write("openspec/changes/add-search/design.md", "# Design\n\n| I-1 | a decision made while implementing |\n");
      b.write("openspec/changes/add-search/tasks.md", "# Tasks\n\n- [x] 1.1 done\n");
    });
    const record = JSON.parse(p.read(".warrant/changes/add-search.json"));
    const lastApproved = record.transitions.filter((t: { to: string }) => t.to === "APPROVED").at(-1);
    expect(lastApproved.evidence).toContain(approval);
    const stored = JSON.parse(p.read(`.warrant/evidence/add-search/${approval}.json`));
    expect(stored).toMatchObject({ kind: "human-approval", subject: { commit: approvedOn } });
    expect(p.git.headCommit()?.sha).not.toBe(approvedOn);

    const run = await gate(p, ["spec-approved"], { transition: MERGE });
    expect(run.errors).toEqual([]);
    expect(run.data["gates"]).toEqual({ "spec-approved": "PASS" });
    expect(run.data["findings"]).toEqual([]);
  });

  it("spec-approved fails naming the changed delta spec, and a maintainer's waiver makes it WAIVED (SCN-VER-047)", async () => {
    const { p, approval } = await approvedThenImplemented((b) => {
      b.write("openspec/changes/add-search/design.md", "# Design\n\n| I-1 | the spec was clarified |\n");
      b.write(SPEC, "# Spec\n\nClarified while implementing.\n");
    });
    const run = await gate(p, ["spec-approved"], { transition: MERGE });
    expect(run.data["gates"]).toEqual({ "spec-approved": "FAIL" });
    expect(run.data["findings"]).toEqual([
      expect.objectContaining({ code: "SPEC_CHANGED_AFTER_APPROVAL", gate: "spec-approved", evidence: approval, paths: [SPEC] })
    ]);
    expect(run.data["controller_action"]).toBe("WAIT");
    expect(run.exitCode).toBe(2);

    // The contract edit is a maintainer's decision: propose, then activate (REQ-KRN-031).
    const proposed: CommandResult & { data: Data } = await invoke(() =>
      runWaive(p.ctx, ["add-search", "spec-approved"], {
        reason: "I-1: the spec was clarified during implementation",
        risk: "LOW",
        control: ["maintainer review of the spec diff"],
        owner: "human:kat",
        expires: "2099-12-31"
      })
    );
    expect(proposed.errors).toEqual([]);
    const id = proposed.data["waiver"].id as string;
    // A PROPOSED waiver waives nothing.
    const pending = await gate(p, ["spec-approved"], { transition: MERGE });
    expect(pending.data["gates"]).toEqual({ "spec-approved": "FAIL" });
    expect(pending.data["findings"]).toContainEqual(expect.objectContaining({ code: "WAIVER_IGNORED", waiver: id, reason: "state" }));

    expect((await invoke(() => runWaive(p.ctx, [], { activate: id, by: "kat" }))).errors).toEqual([]);
    const waived = await gate(p, ["spec-approved"], { transition: MERGE });
    expect(waived.data["gates"]).toEqual({ "spec-approved": "WAIVED" });
    // The finding stays visible to the reviewer of the impl-PR.
    expect(waived.data["findings"]).toEqual([
      expect.objectContaining({ code: "SPEC_CHANGED_AFTER_APPROVAL", paths: [SPEC] }),
      expect.objectContaining({ code: "WAIVED_BY", gate: "spec-approved", waiver: id })
    ]);
    expect(waived.exitCode).toBe(0);
    expect(await validateErrors(p)).toEqual([]);
  });

  it("spec-approved is BLOCKED with NO_INPUT without an APPROVED transition or its human-approval record (SCN-VER-048)", async () => {
    const p = await repo("VERIFYING", FEATURE);
    const none = await gate(p, ["spec-approved"], { transition: MERGE });
    expect(none.data["gates"]).toEqual({ "spec-approved": "BLOCKED" });
    expect(none.data["findings"]).toEqual([expect.objectContaining({ code: "NO_INPUT", gate: "spec-approved" })]);
    expect(none.data["findings"][0].message).toContain("no transition to APPROVED");

    // The transition is there, but the record it lists is not in the evidence store.
    const { p: approved, approval } = await approvedThenImplemented(() => undefined);
    rmSync(path.join(approved.root, ".warrant/evidence/add-search", `${approval}.json`));
    const missing = await gate(approved, ["spec-approved"], { transition: MERGE });
    expect(missing.data["gates"]).toEqual({ "spec-approved": "BLOCKED" });
    expect(missing.data["findings"]).toEqual([expect.objectContaining({ code: "NO_INPUT", gate: "spec-approved" })]);
    expect(missing.data["findings"][0].message).toContain(approval);
  });

  it("without git the gates that need a diff or a branch are BLOCKED with NO_INPUT, not an error", async () => {
    const p = await project()
      .withChange("add-search", { design: "# Design\n", tasks: "# Tasks\n", specs: { search: [] } })
      .withRecord("add-search", "APPROVED", FEATURE)
      .synced();
    expect(p.git.initialised).toBe(false);
    const run = await gate(p, []);
    expect(run.errors).toEqual([]);
    expect(run.data["gates"]).toEqual({ "branch-isolated": "BLOCKED" });
    expect(run.data["findings"][0]).toMatchObject({ code: "NO_INPUT", gate: "branch-isolated" });
    const merge = await gate(p, ["scope-valid", "spec-approved"], { transition: MERGE });
    expect(merge.data["gates"]).toEqual({ "scope-valid": "BLOCKED", "spec-approved": "BLOCKED" });
    expect(merge.data["findings"]).toContainEqual(expect.objectContaining({ code: "NO_INPUT", gate: "spec-approved" }));
  });
});

describe("warrant gate: analyze-clean (REQ-VER-004)", () => {
  /** Findings of the gate: `FRONTEND_HOOKS_INACTIVE` of the merge (REQ-VER-009) has no gate. */
  const ofGate = (data: Data): Data[] => (data["findings"] as Data[]).filter((f) => f["gate"] === "analyze-clean");
  const SEARCH = [{ name: "Search by text", id: "REQ-SRC-004", scenarios: [{ name: "Match", id: "SCN-SRC-010" }] }];

  /** `VERIFYING` with `paths.tests: tests`, the delta adding REQ-SRC-004 / SCN-SRC-010, `tasks` and an impl branch tagging the SCN. */
  async function analyzed(tasks: string): Promise<ProjectBuilder> {
    const p = await repo("VERIFYING", FEATURE, (b) => {
      const config = JSON.parse(b.read(".warrant/warrant.json")) as Record<string, unknown>;
      b.write(".warrant/warrant.json", { ...config, paths: { tests: "tests" } });
      b.withChange("add-search", { design: "# Design\n", tasks, specs: { search: SEARCH } });
    });
    branch(p, "worktree/add-search", (b) => b.write("tests/test_search.py", "# SCN-SRC-010\n"));
    return p;
  }

  it("FAIL with UNSATISFIED for a REQ tasks.md does not mention (SCN-VER-058)", async () => {
    const p = await analyzed("# Tasks\n\n- [ ] 1.1 Index the catalogue\n");
    const run = await gate(p, ["analyze-clean"], { transition: MERGE });
    expect(run.data["gates"]).toEqual({ "analyze-clean": "FAIL" });
    expect(ofGate(run.data)).toEqual([
      expect.objectContaining({ code: "UNSATISFIED", gate: "analyze-clean", id: "REQ-SRC-004", missing: ["task"] })
    ]);
  });

  it("PASS without a waiver when tasks.md and a test name the REQ through its SCN (SCN-VER-059)", async () => {
    const p = await analyzed("# Tasks\n\n- [ ] 1.1 Search by text (SCN-SRC-010)\n");
    const run = await gate(p, ["analyze-clean"], { transition: MERGE });
    expect(run.data["gates"]).toEqual({ "analyze-clean": "PASS" });
    expect(ofGate(run.data)).toEqual([]);
  });

  it("MERGED->ARCHIVED after the archive reads the archive directory: PASS; CONFLICT names the archived tasks.md (SCN-VER-072)", async () => {
    const ARCHIVED = "openspec/changes/archive/2026-09-26-add-search";
    /** `MERGED` with `tasks`, a test tagging the SCN on `main` and the branch `archive/add-search` moving the Change to the archive. */
    const archived = async (tasks: string, removed = false): Promise<ProjectBuilder> => {
      const p = await repo("MERGED", FEATURE, (b) => {
        const config = JSON.parse(b.read(".warrant/warrant.json")) as Record<string, unknown>;
        b.write(".warrant/warrant.json", { ...config, paths: { tests: "tests" } });
        b.withChange("add-search", { design: "# Design\n", tasks, specs: { search: SEARCH } });
        if (removed) {
          const delta = b.read("openspec/changes/add-search/specs/search/spec.md");
          b.write(
            "openspec/changes/add-search/specs/search/spec.md",
            `${delta}\n## REMOVED Requirements\n\n### Requirement: Legacy\n<!-- id: REQ-SRC-002 -->\n`
          );
        }
        b.write("tests/test_search.py", "# SCN-SRC-010\n");
      });
      branch(p, "archive/add-search", (b) => {
        // `openspec archive add-search`: the change directory moves into the archive.
        renameSync(path.join(b.root, "openspec/changes/add-search"), path.join(b.root, ARCHIVED));
      });
      return p;
    };

    const clean = await archived("# Tasks\n\n- [x] 1.1 Search by text (SCN-SRC-010)\n");
    const passed = await gate(clean, ["analyze-clean"], { transition: "MERGED->ARCHIVED" });
    expect(passed.data["gates"]).toEqual({ "analyze-clean": "PASS" });
    expect(ofGate(passed.data)).toEqual([]);

    const conflicted = await archived("# Tasks\n\n- [x] 1.1 Search by text (SCN-SRC-010)\n- [x] 1.2 Drop REQ-SRC-002\n", true);
    const failed = await gate(conflicted, ["analyze-clean"], { transition: "MERGED->ARCHIVED" });
    expect(failed.data["gates"]).toEqual({ "analyze-clean": "FAIL" });
    expect(ofGate(failed.data)).toEqual([
      expect.objectContaining({ code: "CONFLICT", gate: "analyze-clean", id: "REQ-SRC-002", path: `${ARCHIVED}/tasks.md` })
    ]);
  });

  it("BLOCKED with NO_INPUT without git", async () => {
    const p = await project()
      .withChange("add-search", { design: "# Design\n", tasks: "# Tasks\n", specs: { search: SEARCH } })
      .withRecord("add-search", "VERIFYING", FEATURE)
      .synced();
    const run = await gate(p, ["analyze-clean"], { transition: MERGE });
    expect(run.data["gates"]).toEqual({ "analyze-clean": "BLOCKED" });
    expect(run.data["findings"]).toEqual([expect.objectContaining({ code: "NO_INPUT", gate: "analyze-clean" })]);
    expect(run.data["findings"][0].message).toContain("not a git repository");
  });
});

/** A Run file of `change`, valid by `warrant://run/1`: `review` (empty `write_scope`, `spec_tree`) or `implement`. */
function runFile(id: string, change: string, operation: "review" | "implement"): Record<string, unknown> {
  return {
    $schema: "warrant://run/1",
    id,
    change,
    operation,
    write_scope: operation === "review" ? [] : ["src/**"],
    scope: [],
    ...(operation === "review" ? { spec_tree: `sha256:${"3".repeat(64)}` } : {}),
    branch: `worktree/${change}`,
    started_at: "2026-09-25T10:00:00Z",
    finished_at: "2026-09-25T10:12:00Z",
    run_state: "SUCCEEDED",
    context_hash: `sha256:${"1".repeat(64)}`,
    effective_policy_hash: `sha256:${"2".repeat(64)}`,
    guard_events: []
  };
}

describe("warrant gate: own state of the Change in scope-valid (REQ-VER-004, N27)", () => {
  const RUN = "RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y";
  const OTHER_RUN = "RUN-01J8Z3KQ2M7N4P6R8T0V2W4X7Z";
  const EVID = ".warrant/evidence/add-search/EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3.json";

  it("spec-PR with its record, evidence, Run and envelope passes; a Run of another Change fails (SCN-VER-060)", async () => {
    // core-sdd judges scope-valid on the merge only; the overlay adds it to the spec-PR, as SCN-VER-020 does to the archive-PR.
    const p = await repo("SPECIFIED", FEATURE, (b) =>
      b.write(".warrant/local/overlays/spec-scope.json", {
        $schema: "warrant://overlay/1",
        id: "spec-scope",
        version: "1.0.0",
        match: {},
        gates: { "SPECIFIED->APPROVED": ["scope-valid"] }
      })
    );
    branch(p, "spec/add-search", (b) => {
      b.write("openspec/changes/add-search/proposal.md", "# Proposal\n\nReviewed.\n");
      b.write(EVID, { id: "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3" });
      b.write(`.warrant/runs/${RUN}.json`, runFile(RUN, "add-search", "review"));
      b.write(`.warrant/runs/${RUN}.result.json`, { run: RUN });
    });
    const pass = await gate(p, ["scope-valid"], { transition: "SPECIFIED->APPROVED" });
    expect(pass.errors).toEqual([]);
    expect(pass.data["gates"]).toEqual({ "scope-valid": "PASS" });

    p.write(`.warrant/runs/${OTHER_RUN}.json`, runFile(OTHER_RUN, "other", "review"));
    p.commit("other");
    const fail = await gate(p, ["scope-valid"], { transition: "SPECIFIED->APPROVED" });
    expect(fail.data["gates"]).toEqual({ "scope-valid": "FAIL" });
    expect(fail.data["findings"]).toEqual([
      expect.objectContaining({ code: "SCOPE_VIOLATION", gate: "scope-valid", paths: [`.warrant/runs/${OTHER_RUN}.json`] })
    ]);
  });

  it("impl-PR Runs of the Change are not policy paths without factory-change (SCN-VER-061)", async () => {
    const p = await repo("VERIFYING", FEATURE);
    branch(p, "worktree/add-search", (b) => {
      b.write("src/app.py", "print('search')\n");
      b.write(`.warrant/runs/${RUN}.json`, runFile(RUN, "add-search", "implement"));
    });
    const run = await gate(p, ["scope-valid"], { transition: MERGE });
    expect(run.data["gates"]).toEqual({ "scope-valid": "PASS" });

    // Runs of another Change stay forbidden, even with factory-change.
    p.write(`.warrant/runs/${OTHER_RUN}.json`, runFile(OTHER_RUN, "other", "implement"));
    p.commit("other");
    const other = await gate(p, ["scope-valid"], { transition: MERGE });
    expect(other.data["findings"]).toEqual([expect.objectContaining({ code: "SCOPE_VIOLATION", paths: [`.warrant/runs/${OTHER_RUN}.json`] })]);
  });
});

describe("warrant gate: review bound to the spec tree (REQ-VER-003, ADR-0036 п. 3)", () => {
  const ID = "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3";
  const REVIEW_GATE = "SPECIFIED->APPROVED";

  /** `SPECIFIED` with a `review` record made on the spec-PR branch and bound to the spec tree there, merged into `main`. */
  async function reviewed(): Promise<ProjectBuilder> {
    const p = await repo("SPECIFIED", FEATURE);
    p.branch("spec/add-search");
    const made = p.git.headCommit()?.sha as string;
    const tree = await specTreeHash(p.ctx, made, "add-search");
    expect(tree.ok).toBe(true);
    p.write(`.warrant/evidence/add-search/${ID}.json`, {
      id: ID,
      kind: "review",
      level: "L2",
      evidence_status: "PROVEN",
      subject: { commit: made, spec_revision: `openspec/changes/add-search@${made}`, spec_tree: tree.ok ? tree.value : "" },
      produced_by: { type: "skill", id: "specification/adversarial-review", version: "0.2.0", run: "RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y" },
      attestation: { type: "none" },
      limitations: ["produced locally, unattested", "same model family as author"],
      created_at: "2026-09-25T10:12:00Z",
      metrics: { BLOCKER: 0, MAJOR: 0, MINOR: 1, INFO: 0 }
    });
    p.commit("review");
    p.checkout("main");
    p.merge("spec/add-search", { ff: "no" });
    return p;
  }

  it("a review made on commit A passes on commit B after the merge when the spec did not change (SCN-VER-056)", async () => {
    const p = await reviewed();
    const run = await gate(p, ["adversarial-review"], { transition: REVIEW_GATE });
    expect(run.errors).toEqual([]);
    expect(run.data["gates"]).toEqual({ "adversarial-review": "PASS" });
    expect(run.data["findings"]).toEqual([]);
  });

  it("a change of a delta spec makes it STALE by spec_tree; a change of design.md does not (SCN-VER-057)", async () => {
    const p = await reviewed();
    p.write("openspec/changes/add-search/design.md", "# Design\n\nMore.\n");
    p.commit("design");
    const design = await gate(p, ["adversarial-review"], { transition: REVIEW_GATE });
    expect(design.data["gates"]).toEqual({ "adversarial-review": "PASS" });

    p.write(SPEC, "# Search\n\nChanged.\n");
    p.commit("spec");
    const spec = await gate(p, ["adversarial-review"], { transition: REVIEW_GATE });
    expect(spec.data["gates"]).toEqual({ "adversarial-review": "BLOCKED" });
    expect(spec.data["findings"]).toEqual([
      expect.objectContaining({ code: "STALE", evidence: ID, reason: "spec_tree", kind: "review" }),
      expect.objectContaining({ code: "NO_EVIDENCE", gate: "adversarial-review", kind: "review" })
    ]);
  });
});
