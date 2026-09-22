/**
 * `warrant verify` (REQ-VER-006) and `status.verification` (REQ-KRN-027):
 * the full local cycle SCN-VER-027, a check that is not configured
 * SCN-VER-028, and verdicts of `status` without running a check SCN-KRN-101.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { openspecAvailable } from "../../src/core/openspec/cli.js";
import { makeTempDir, removeDir, runCli } from "../helpers/cli.js";
import { PATH_KEY, pathWithFake, writeFakeOpenspec } from "../helpers/fake-openspec.js";
import { PACKS, record, useSyncedProject, validate, write } from "../helpers/synced.js";

const hasOpenspec = openspecAvailable();
const hasGit = spawnSync("git", ["--version"]).status === 0;
const project = useSyncedProject();

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

function temp(prefix: string): string {
  const dir = makeTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

let fakeBin: string | undefined;

function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  fakeBin ??= writeFakeOpenspec(temp("warrant-verify-fake-openspec-"));
  return { WARRANT_PACKS_DIR: PACKS, [PATH_KEY]: pathWithFake(fakeBin), GITHUB_ACTIONS: "", ...extra };
}

function git(cwd: string, ...args: string[]): string {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
  return run.stdout.trim();
}

/** The synced project with a complete `feature` Change `add-search`, committed on `main`. */
function repo(state = "PROPOSED"): string {
  const root = project();
  write(root, ".warrant/changes/add-search.json", record("add-search", state, { classification: { profiles: ["feature"] } }));
  write(root, "openspec/changes/add-search/proposal.md", "# Proposal\n");
  write(root, "openspec/changes/add-search/design.md", "# Design\n");
  write(root, "openspec/changes/add-search/tasks.md", "# Tasks\n");
  write(root, "openspec/changes/add-search/specs/search/spec.md", "# Spec\n");
  git(root, "-c", "init.defaultBranch=main", "init", "--quiet");
  git(root, "config", "user.name", "warrant-test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "checkout", "--quiet", "-B", "main");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "base");
  return root;
}

describe.skipIf(!hasOpenspec || !hasGit)("warrant verify", () => {
  it("runs openspec-validate, then the gates and the controller: all PASS, CONTINUE, exit 0 (SCN-VER-027)", async () => {
    const root = repo();
    const log = path.join(temp("warrant-verify-log-"), "argv.jsonl");
    const run = await runCli(["verify", "add-search"], root, env({ FAKE_OPENSPEC_LOG: log }));
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      ["validate", "add-search", "--strict", "--json"]
    ]);

    const data = run.json.data;
    expect(Object.keys(data)).toEqual(["transition", "checks", "gates", "findings", "controller_action", "rule", "effective_policy"]);
    expect(data.transition).toBe("PROPOSED->SPECIFIED");
    expect(data.checks).toHaveLength(1);
    expect(data.checks[0]).toMatchObject({ id: "openspec-validate", kind: "spec-report", evidence_status: "PROVEN" });
    expect(data.gates).toEqual({ "ids-valid": "PASS", "required-artifacts-present": "PASS", "spec-valid": "PASS" });
    expect(data.findings).toEqual([]);
    expect(data.controller_action).toBe("CONTINUE");
    expect(data.rule).toBeNull();
    expect(data.effective_policy).toEqual({ hash: expect.stringMatching(/^sha256:/), risk_level: expect.any(String) });
    expect((await validate(root)).json?.errors).toEqual([]);
  }, 120_000);

  it("a check without a command leaves its gate BLOCKED, the others computed, exit 3 (SCN-VER-028)", async () => {
    const root = repo("VERIFYING");
    const run = await runCli(["verify", "add-search", "--transition", "VERIFYING->MERGED"], root, env());
    expect(run.json.ok).toBe(false);
    expect(run.json.errors.map((e: { code: string }) => e.code)).toEqual(["CHECK_NOT_CONFIGURED"]);
    expect(run.status).toBe(3);
    const data = run.json.data;
    expect(data.checks).toEqual([expect.objectContaining({ id: "tests-passed", error: "CHECK_NOT_CONFIGURED" })]);
    expect(data.gates["tests-passed"]).toBe("BLOCKED");
    expect(data.findings).toContainEqual(
      expect.objectContaining({ code: "NO_INPUT", gate: "tests-passed", check: "tests-passed", error: "CHECK_NOT_CONFIGURED" })
    );
    expect(Object.keys(data.gates)).toEqual(["analyze-clean", "evidence-complete", "ids-valid", "scope-valid", "tests-passed"]);
    expect(data.gates["ids-valid"]).toBe("PASS");
    expect(data.gates["scope-valid"]).toBe("PASS");
    expect(data.gates["evidence-complete"]).toBe("FAIL");
    // evidence-complete FAIL → WAIT (2); the check error (3) is higher.
    expect(data.controller_action).toBe("WAIT");
  }, 120_000);

  it("an invalid change gives spec-valid FAIL and WAIT, exit 2", async () => {
    const root = repo();
    const run = await runCli(["verify", "add-search"], root, env({ FAKE_OPENSPEC_INVALID: "1" }));
    expect(run.json.errors).toEqual([]);
    expect(run.json.data.gates["spec-valid"]).toBe("FAIL");
    expect(run.json.data.findings).toContainEqual(expect.objectContaining({ code: "EVIDENCE_STATUS", gate: "spec-valid" }));
    expect(run.json.data.rule).toBe("gate-failed");
    expect(run.status).toBe(2);
  }, 120_000);
});

describe.skipIf(!hasOpenspec || !hasGit)("warrant status: verification", () => {
  it("judges the next transition by recorded evidence and runs no check (SCN-KRN-101)", async () => {
    const root = repo();
    const before = await runCli(["status", "add-search"], root, env());
    expect(before.status).toBe(0);
    expect(before.json.data.verification).toMatchObject({
      transition: "PROPOSED->SPECIFIED",
      gates: { "spec-valid": "BLOCKED" },
      findings: [expect.objectContaining({ code: "NO_EVIDENCE", gate: "spec-valid" })],
      controller_action: "CONTINUE",
      rule: null
    });

    const check = await runCli(["check", "add-search", "openspec-validate"], root, env());
    expect(check.status).toBe(0);
    const log = path.join(temp("warrant-status-log-"), "argv.jsonl");
    const manifest = path.join(root, ".warrant/evidence/add-search/manifest.json");
    const manifestBefore = readFileSync(manifest, "utf8");
    const run = await runCli(["status", "add-search"], root, env({ FAKE_OPENSPEC_LOG: log }));
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json.data.effective_policy.risk_level).toEqual(expect.any(String));
    expect(run.json.data.verification).toEqual({
      transition: "PROPOSED->SPECIFIED",
      gates: { "ids-valid": "PASS", "required-artifacts-present": "PASS", "spec-valid": "PASS" },
      findings: [],
      controller_action: "CONTINUE",
      rule: null
    });
    // No check ran and nothing was written.
    expect(existsSync(log)).toBe(false);
    expect(readFileSync(manifest, "utf8")).toBe(manifestBefore);

    // The list form carries verification too.
    const all = await runCli(["status"], root, env());
    expect(all.json.data.changes[0].verification.gates["spec-valid"]).toBe("PASS");
  }, 120_000);

  it("has verification null for a Change without a next transition", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "ABANDONED"));
    const run = await runCli(["status", "add-search"], root, env());
    expect(run.status).toBe(0);
    expect(run.json.data.verification).toBeNull();
    const gate = await runCli(["gate", "add-search"], root, env());
    expect(gate.json.errors[0].code).toBe("USAGE");
  }, 60_000);
});
