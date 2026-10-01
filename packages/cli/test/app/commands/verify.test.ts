/**
 * `warrant verify` (REQ-VER-006) and `status.verification` (REQ-KRN-027) in the
 * test process: the full local cycle SCN-VER-027, a check that is not
 * configured SCN-VER-028, and verdicts of `status` without running a check
 * SCN-KRN-101. Moved from e2e (ADR-0025, task 5.3); the parse of argv and the
 * exit codes of the binary stay in `e2e/verify.test.ts`.
 *
 * Each case builds the synced core-sdd project with a complete `feature`
 * Change `add-search`, committed on `main` of `FakeGit`. The check
 * `openspec-validate` is answered by `FakeCheckRunner` (`withOpenspecValidate`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../../../src/commands/check.js";
import { runGate } from "../../../src/commands/gate.js";
import { runStatus } from "../../../src/commands/status.js";
import { runVerify, type VerifyOptions } from "../../../src/commands/verify.js";
import { toEnvelope, type CommandResult } from "../../../src/io/output.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { validateErrors } from "../helpers/validate.js";

const project = useProjectBuilder();

/** Environment of a local run: no CI attestation, whatever the environment of the test runner. */
const LOCAL: NodeJS.ProcessEnv = {};

/** The data of a result, read as the envelope is. */
type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

function verify(p: ProjectBuilder, opts: VerifyOptions = {}): Promise<Result> {
  return invoke(() => runVerify(p.ctx, "add-search", opts, LOCAL));
}

/** `status add-search`, or `status` of every Change with `all`. */
function status(p: ProjectBuilder, all = false): Promise<Result> {
  return invoke(() => runStatus(p.ctx, all ? undefined : "add-search", LOCAL));
}

/** The synced project with a complete `feature` Change `add-search`, committed on `main`. */
async function repo(state = "PROPOSED", setup?: (p: ProjectBuilder) => void): Promise<ProjectBuilder> {
  const p = project()
    .withChange("add-search", { design: "# Design\n", tasks: "# Tasks\n", specs: { search: [] } })
    .withRecord("add-search", state, { classification: { profiles: ["feature"] } })
    .withOpenspecValidate();
  setup?.(p);
  await p.synced();
  p.commit("base");
  return p;
}

describe("warrant verify", () => {
  it("runs openspec-validate, then the gates and the controller: all PASS, CONTINUE, exit 0 (SCN-VER-027)", async () => {
    const p = await repo();
    const run = await verify(p);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(p.checks.calls.map((c) => c.argv.slice(1))).toEqual([["validate", "add-search", "--strict", "--json"]]);

    const data = run.data;
    expect(Object.keys(data)).toEqual(["transition", "checks", "gates", "findings", "controller_action", "rule", "effective_policy"]);
    expect(data["transition"]).toBe("PROPOSED->SPECIFIED");
    expect(data["checks"]).toHaveLength(1);
    expect(data["checks"][0]).toMatchObject({ id: "openspec-validate", kind: "spec-report", evidence_status: "PROVEN" });
    expect(data["gates"]).toEqual({ "ids-valid": "PASS", "required-artifacts-present": "PASS", "spec-valid": "PASS" });
    expect(data["findings"]).toEqual([]);
    expect(data["controller_action"]).toBe("CONTINUE");
    expect(data["rule"]).toBeNull();
    expect(data["effective_policy"]).toEqual({ hash: expect.stringMatching(/^sha256:/), risk_level: expect.any(String) });
    expect(await validateErrors(p)).toEqual([]);
  });

  it("a check without a command leaves its gate BLOCKED, the others computed, exit 3 (SCN-VER-028)", async () => {
    const p = await repo("VERIFYING");
    const run = await verify(p, { transition: "VERIFYING->MERGED" });
    expect(run.ok).toBe(false);
    expect(run.errors.map((e) => e.code)).toEqual(["CHECK_NOT_CONFIGURED"]);
    expect(run.exitCode).toBe(3);
    const data = run.data;
    expect(data["checks"]).toEqual([expect.objectContaining({ id: "tests-passed", error: "CHECK_NOT_CONFIGURED" })]);
    expect(data["gates"]["tests-passed"]).toBe("BLOCKED");
    expect(data["findings"]).toContainEqual(
      expect.objectContaining({ code: "NO_INPUT", gate: "tests-passed", check: "tests-passed", error: "CHECK_NOT_CONFIGURED" })
    );
    expect(Object.keys(data["gates"])).toEqual([
      "analyze-clean",
      "evidence-complete",
      "ids-valid",
      "scope-valid",
      "spec-approved",
      "tests-passed"
    ]);
    expect(data["gates"]["ids-valid"]).toBe("PASS");
    expect(data["gates"]["scope-valid"]).toBe("PASS");
    expect(data["gates"]["evidence-complete"]).toBe("FAIL");
    // evidence-complete FAIL → WAIT (2); the check error (3) is higher.
    expect(data["controller_action"]).toBe("WAIT");
  });

  it("a check over its timeout: CHECK_TIMEOUT retryable, its gate BLOCKED, WAIT — exit 4 (SCN-VER-136, SCN-KRN-161)", async () => {
    const p = await repo("VERIFYING", (b) => b.withCheck("fake-tests", { timedOut: true }, { id: "tests-passed", args: ["{out}"] }));
    const run = await verify(p, { transition: "VERIFYING->MERGED" });
    expect(run.errors.map((e) => e.code)).toEqual(["CHECK_TIMEOUT"]);
    expect(toEnvelope("verify", run).errors[0]).toMatchObject({ code: "CHECK_TIMEOUT", retryable: true });
    expect(run.data["gates"]["tests-passed"]).toBe("BLOCKED");
    expect(run.data["controller_action"]).toBe("WAIT");
    // 4 > 2: the wait was computed on data the failure left incomplete (REQ-KRN-003).
    expect(run.exitCode).toBe(4);
  });

  it("CHECK_NOT_CONFIGURED is elder than CHECK_TIMEOUT: exit 3 (SCN-KRN-161)", async () => {
    const p = await repo("VERIFYING", (b) => {
      b.withCheck("fake-tests", { timedOut: true }, { id: "tests-passed", args: ["{out}"] });
      // A second check of the transition (it produces test-report too) without run.command.
      b.write(".warrant/local/checks/tests-smoke.json", {
        $schema: "warrant://check/1",
        id: "tests-smoke",
        version: "1.0.0",
        level: "L1",
        produces: ["test-report"],
        parser: "junit"
      });
    });
    const run = await verify(p, { transition: "VERIFYING->MERGED" });
    expect(run.errors.map((e) => e.code).sort()).toEqual(["CHECK_NOT_CONFIGURED", "CHECK_TIMEOUT"]);
    expect(run.data["controller_action"]).toBe("WAIT");
    expect(run.exitCode).toBe(3);
  });

  it("an invalid change gives spec-valid FAIL and WAIT, exit 2", async () => {
    const p = await repo();
    p.withOpenspecValidate(false);
    const run = await verify(p);
    expect(run.errors).toEqual([]);
    expect(run.data["gates"]["spec-valid"]).toBe("FAIL");
    expect(run.data["findings"]).toContainEqual(expect.objectContaining({ code: "EVIDENCE_STATUS", gate: "spec-valid" }));
    expect(run.data["rule"]).toBe("gate-failed");
    expect(run.exitCode).toBe(2);
  });
});

describe("warrant status: verification", () => {
  it("judges the next transition by recorded evidence and runs no check (SCN-KRN-101)", async () => {
    const p = await repo();
    const before = await status(p);
    expect(before.exitCode).toBe(0);
    expect(before.data["verification"]).toMatchObject({
      transition: "PROPOSED->SPECIFIED",
      gates: { "spec-valid": "BLOCKED" },
      findings: [expect.objectContaining({ code: "NO_EVIDENCE", gate: "spec-valid" })],
      controller_action: "WAIT",
      next: "verify",
      rule: "verify-incomplete"
    });

    const check = await invoke(() => runCheck(p.ctx, "add-search", ["openspec-validate"], {}, LOCAL));
    expect(check.exitCode).toBe(0);
    const runsBefore = p.checks.calls.length;
    const manifest = path.join(p.root, ".warrant/evidence/add-search/manifest.json");
    const manifestBefore = readFileSync(manifest, "utf8");
    const run = await status(p);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data["effective_policy"].risk_level).toEqual(expect.any(String));
    expect(run.data["verification"]).toEqual({
      transition: "PROPOSED->SPECIFIED",
      gates: { "ids-valid": "PASS", "required-artifacts-present": "PASS", "spec-valid": "PASS" },
      findings: [],
      controller_action: "CONTINUE",
      rule: null
    });
    // No check ran and nothing was written.
    expect(p.checks.calls).toHaveLength(runsBefore);
    expect(readFileSync(manifest, "utf8")).toBe(manifestBefore);

    // The list form carries verification too.
    const all = await status(p, true);
    expect(all.data["changes"][0].verification.gates["spec-valid"]).toBe("PASS");
  });

  it("has verification null for a Change without a next transition", async () => {
    const p = project().withRecord("add-search", "ABANDONED");
    await p.synced();
    const run = await status(p);
    expect(run.exitCode).toBe(0);
    expect(run.data["verification"]).toBeNull();
    const gate: Result = await invoke(() => runGate(p.ctx, "add-search", [], {}, LOCAL));
    expect(gate.errors[0]?.code).toBe("USAGE");
  });
});
