/**
 * `warrant gate` in temporary git repositories (REQ-VER-003, REQ-VER-004,
 * REQ-VER-005): the computed L0 gates on real diffs and branches —
 * SCN-VER-014, 019, 020, 021, 022, 023 — the output shape and the exit code
 * of the controller.
 *
 * Each case copies the synced core-sdd project, adds Change `add-search`,
 * makes `main` with one commit and, where a diff is needed, a branch with a
 * second one. `openspec` on PATH is a fake (`test/helpers/fake-openspec.ts`).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { openspecAvailable } from "../../src/core/openspec/cli.js";
import { makeTempDir, removeDir, runCli, type CliRun } from "../helpers/cli.js";
import { PATH_KEY, pathWithFake, writeFakeOpenspec } from "../helpers/fake-openspec.js";
import { PACKS, record, useSyncedProject, validate, write } from "../helpers/synced.js";

const hasOpenspec = openspecAvailable();
const hasGit = spawnSync("git", ["--version"]).status === 0;
const project = useSyncedProject();

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

let fakeBin: string | undefined;

function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  if (fakeBin === undefined) {
    fakeBin = makeTempDir("warrant-gate-fake-openspec-");
    tempDirs.push(fakeBin);
    writeFakeOpenspec(fakeBin);
  }
  return { WARRANT_PACKS_DIR: PACKS, [PATH_KEY]: pathWithFake(fakeBin), GITHUB_ACTIONS: "", ...extra };
}

function gate(root: string, args: string[]): Promise<CliRun> {
  return runCli(["gate", "add-search", ...args], root, env());
}

function git(cwd: string, ...args: string[]): string {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
  return run.stdout.trim();
}

/** Change directory with every artifact of `feature`. */
function artifacts(root: string): void {
  write(root, "openspec/changes/add-search/proposal.md", "# Proposal\n");
  write(root, "openspec/changes/add-search/design.md", "# Design\n");
  write(root, "openspec/changes/add-search/tasks.md", "# Tasks\n");
  write(root, "openspec/changes/add-search/specs/search/spec.md", "# Spec\n");
}

/**
 * The synced project with record `add-search`, as a git repository whose
 * `main` holds everything written so far in one commit. Local identity and
 * default branch: CI runners may have no global git config.
 */
function repo(state: string, extra: Record<string, unknown> = {}, setup?: (root: string) => void): string {
  const root = project();
  write(root, ".warrant/changes/add-search.json", record("add-search", state, extra));
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

/** A branch off `main` with one more commit made by `change`. */
function branch(root: string, name: string, change: (root: string) => void): void {
  git(root, "checkout", "--quiet", "-b", name);
  change(root);
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", name);
}

const FEATURE = { classification: { profiles: ["feature"] } };
const FACTORY = { classification: { profiles: ["factory-change"] } };

describe.skipIf(!hasOpenspec || !hasGit)("warrant gate", () => {
  it("prints transition, gates and findings; a local record passes PROPOSED->SPECIFIED and is written to manifest.gates", async () => {
    const root = repo("PROPOSED", FEATURE);
    const check = await runCli(["check", "add-search", "openspec-validate"], root, env());
    expect(check.status).toBe(0);

    const run = await gate(root, []);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json.ok).toBe(true);
    expect(run.json.data).toEqual({
      transition: "PROPOSED->SPECIFIED",
      gates: { "ids-valid": "PASS", "required-artifacts-present": "PASS", "spec-valid": "PASS" },
      findings: [],
      controller_action: "CONTINUE",
      rule: null
    });
    const manifest = JSON.parse(readFileSync(path.join(root, ".warrant/evidence/add-search/manifest.json"), "utf8"));
    expect(manifest.gates).toEqual(run.json.data.gates);
    expect((await validate(root)).json?.errors).toEqual([]);

    // One gate by id; an id outside the transition is a usage error.
    const one = await gate(root, ["spec-valid"]);
    expect(one.json.data.gates).toEqual({ "spec-valid": "PASS" });
    const outside = await gate(root, ["scope-valid"]);
    expect(outside.json.errors[0].code).toBe("USAGE");
    expect(outside.status).toBe(3);
    const bad = await gate(root, ["--transition", "PROPOSED->MERGED"]);
    expect(bad.json.errors[0].code).toBe("USAGE");
  }, 120_000);

  it("a record of the previous commit is STALE and the gate BLOCKED with NO_EVIDENCE (SCN-VER-013)", async () => {
    const root = repo("PROPOSED", FEATURE);
    const check = await runCli(["check", "add-search", "openspec-validate"], root, env());
    expect(check.status).toBe(0);
    write(root, "src/search.ts", "export {};\n");
    git(root, "add", "-A");
    git(root, "commit", "--quiet", "-m", "next");

    const run = await gate(root, []);
    expect(run.json.data.gates["spec-valid"]).toBe("BLOCKED");
    expect(run.json.data.findings).toContainEqual(
      expect.objectContaining({ code: "STALE", evidence: check.json.data.checks[0].evidence, reason: "commit" })
    );
    expect(run.json.data.findings).toContainEqual(expect.objectContaining({ code: "NO_EVIDENCE", gate: "spec-valid" }));
    // BLOCKED alone matches no rule of core-sdd: CONTINUE (REQ-VER-005).
    expect(run.json.data.controller_action).toBe("CONTINUE");
  }, 120_000);

  it("factory-golden-passed is NOT_APPLICABLE when the diff misses applies_when (SCN-VER-014)", async () => {
    const root = repo("VERIFYING", FACTORY);
    branch(root, "worktree/add-search", (r) => write(r, "src/search.ts", "export {};\n"));
    const run = await gate(root, ["factory-golden-passed", "--transition", "VERIFYING->MERGED"]);
    expect(run.json.data.gates).toEqual({ "factory-golden-passed": "NOT_APPLICABLE" });
    expect(run.json.data.findings).toEqual([]);
    expect(run.status).toBe(0);
  }, 60_000);

  it("impl-PR touching openspec/specs/** fails scope-valid with that path (SCN-VER-019)", async () => {
    const root = repo("VERIFYING", FEATURE);
    branch(root, "worktree/add-search", (r) => {
      write(r, "src/search.ts", "export {};\n");
      write(r, "openspec/specs/search/spec.md", "# Search\n");
    });
    const run = await gate(root, ["--transition", "VERIFYING->MERGED"]);
    expect(run.json.data.transition).toBe("VERIFYING->MERGED");
    expect(run.json.data.gates["scope-valid"]).toBe("FAIL");
    expect(run.json.data.findings).toContainEqual(
      expect.objectContaining({ code: "SCOPE_VIOLATION", gate: "scope-valid", paths: ["openspec/specs/search/spec.md"] })
    );
    // FAIL → WAIT by gate-failed, exit 2 (SCN-VER-024 end to end).
    expect(run.json.data.controller_action).toBe("WAIT");
    expect(run.json.data.rule).toBe("gate-failed");
    expect(run.json.ok).toBe(false);
    expect(run.status).toBe(2);
    // Every other gate of the transition is computed too.
    expect(Object.keys(run.json.data.gates)).toEqual(["analyze-clean", "evidence-complete", "ids-valid", "scope-valid", "tests-passed"]);
    expect(run.json.data.gates["analyze-clean"]).toBe("BLOCKED");
  }, 60_000);

  it("archive-PR inside its own archive directory passes scope-valid (SCN-VER-020)", async () => {
    const overlay = (r: string): void =>
      write(r, ".warrant/local/overlays/archive-scope.json", {
        $schema: "warrant://overlay/1",
        id: "archive-scope",
        version: "1.0.0",
        match: {},
        gates: { "MERGED->ARCHIVED": ["scope-valid"] }
      });
    const root = repo("MERGED", FEATURE, overlay);
    branch(root, "archive/add-search", (r) => {
      git(r, "mv", "openspec/changes/add-search", "openspec/changes/archive/2026-09-22-add-search");
      write(r, "openspec/specs/search/spec.md", "# Search\n");
    });
    const run = await gate(root, ["scope-valid", "--transition", "MERGED->ARCHIVED"]);
    expect(run.json?.errors).toEqual([]);
    expect(run.json.data.gates).toEqual({ "scope-valid": "PASS" });
    expect(run.status).toBe(0);
  }, 60_000);

  it("policy paths fail scope-valid without factory-change and pass with it (SCN-VER-021)", async () => {
    const policyPath = (r: string): void => write(r, "packs/core-sdd/gates/spec-valid.json", { changed: true });
    const feature = repo("VERIFYING", FEATURE);
    branch(feature, "worktree/add-search", policyPath);
    const fail = await gate(feature, ["scope-valid", "--transition", "VERIFYING->MERGED"]);
    expect(fail.json.data.gates).toEqual({ "scope-valid": "FAIL" });
    expect(fail.json.data.findings[0]).toMatchObject({ code: "SCOPE_VIOLATION", paths: ["packs/core-sdd/gates/spec-valid.json"] });

    const factory = repo("VERIFYING", FACTORY);
    branch(factory, "worktree/add-search", policyPath);
    const pass = await gate(factory, ["scope-valid", "--transition", "VERIFYING->MERGED"]);
    expect(pass.json.data.gates).toEqual({ "scope-valid": "PASS" });
  }, 60_000);

  it("an open blocking UNKNOWN fails blocking-unknowns-resolved naming it (SCN-VER-022)", async () => {
    const root = repo("SPECIFIED", { ...FEATURE, unknowns: [{ id: "UNK-SRC-001", text: "Which index?", blocking: true }] });
    const run = await gate(root, ["--transition", "SPECIFIED->APPROVED"]);
    expect(run.json.data.gates["blocking-unknowns-resolved"]).toBe("FAIL");
    expect(run.json.data.findings).toContainEqual(
      expect.objectContaining({ code: "BLOCKING_UNKNOWN", gate: "blocking-unknowns-resolved", items: ["UNK-SRC-001"] })
    );
    expect(run.json.data.controller_action).toBe("WAIT");
    expect(run.status).toBe(2);
  }, 60_000);

  it("branch-isolated fails on main (SCN-VER-023) and passes on a branch", async () => {
    const root = repo("APPROVED", FEATURE);
    const onMain = await gate(root, ["--transition", "APPROVED->IMPLEMENTING"]);
    expect(onMain.json.data.gates).toEqual({ "branch-isolated": "FAIL" });
    expect(onMain.json.data.findings[0]).toMatchObject({ code: "BRANCH_NOT_ISOLATED", items: ["main"] });
    expect(onMain.status).toBe(2);

    git(root, "checkout", "--quiet", "-b", "worktree/add-search");
    const onBranch = await gate(root, []);
    expect(onBranch.json.data).toMatchObject({ transition: "APPROVED->IMPLEMENTING", gates: { "branch-isolated": "PASS" } });
    expect(onBranch.status).toBe(0);
  }, 60_000);

  it("without git the gates that need a diff or a branch are BLOCKED with NO_INPUT, not an error", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "APPROVED", FEATURE));
    artifacts(root);
    rmSync(path.join(root, ".git"), { recursive: true, force: true });
    const run = await gate(root, []);
    expect(run.json?.errors).toEqual([]);
    expect(run.json.data.gates).toEqual({ "branch-isolated": "BLOCKED" });
    expect(run.json.data.findings[0]).toMatchObject({ code: "NO_INPUT", gate: "branch-isolated" });
    const merge = await gate(root, ["scope-valid", "--transition", "VERIFYING->MERGED"]);
    expect(merge.json.data.gates).toEqual({ "scope-valid": "BLOCKED" });
  }, 60_000);
});
