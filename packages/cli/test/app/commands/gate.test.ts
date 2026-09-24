/**
 * `warrant gate` in the test process (REQ-VER-003, REQ-VER-004, REQ-VER-005):
 * the computed L0 gates on diffs and branches of `FakeGit` — SCN-VER-014, 019,
 * 020, 021, 022, 023 — the output shape and the exit code of the controller, a
 * project controller rule it skips (SCN-VER-049), and `spec-approved` after an
 * approval made through the commands (SCN-VER-046, 047, 048). Moved from e2e
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
import { runValidate } from "../../../src/commands/validate.js";
import { runVerify } from "../../../src/commands/verify.js";
import { runWaive } from "../../../src/commands/waive.js";
import type { CommandResult } from "../../../src/io/output.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";

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

async function validateErrors(p: ProjectBuilder): Promise<unknown[]> {
  return (await invoke(() => runValidate(p.ctx))).errors;
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
    expect(run.data["gates"]["analyze-clean"]).toBe("BLOCKED");
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
