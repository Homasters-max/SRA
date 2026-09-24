/**
 * The scenario of judging a transition, `core/transition/evaluate` (ADR-0030
 * п. 3, arch-boundaries design §7, §8), called with the `ctx` of
 * `ProjectBuilder`: a policy conflict is refused with the controller's decision
 * and nothing is written; a passing transition runs its checks, judges the
 * gates on the same git facts and writes the verdicts into the manifest; a
 * failing gate comes back as the refusal `transition` and `archive` print.
 * No process: `FakeOpenSpec`, `FakeGit`, `FakeCheckRunner`.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checksForTransition } from "../../../src/core/check/execute.js";
import { MANIFEST_FILE } from "../../../src/core/evidence/store.js";
import { evaluate } from "../../../src/core/transition/evaluate.js";
import { gatesNotPassed, gatesNotPassedRefusal } from "../../../src/core/transition/outcome.js";
import { CLI_ROOT } from "../../helpers/cli.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";

const project = useProjectBuilder();

/** Environment of a local run: no CI attestation, whatever the environment of the test runner. */
const LOCAL: NodeJS.ProcessEnv = {};

const CHANGE = "add-search";
const EVIDENCE = `.warrant/evidence/${CHANGE}`;
const FEATURE = { classification: { profiles: ["feature"] } };

const PACKS_ENV = "WARRANT_PACKS_DIR";
const packsEnvBefore = process.env[PACKS_ENV];
afterEach(() => {
  if (packsEnvBefore === undefined) delete process.env[PACKS_ENV];
  else process.env[PACKS_ENV] = packsEnvBefore;
});

/** The synced core-sdd project with record `add-search` in `state`, committed on `main`. */
async function repo(state: string, validSpec: boolean): Promise<ProjectBuilder> {
  const p = project()
    .withChange(CHANGE, { design: "# Design\n", tasks: "# Tasks\n", specs: { search: [] } })
    .withRecord(CHANGE, state, FEATURE)
    .withOpenspecValidate(validSpec);
  await p.synced();
  p.commit("base");
  return p;
}

describe("core/transition evaluate", () => {
  it("refuses a policy conflict with the controller's decision and writes nothing", async () => {
    // Fixture packs `policy` and `policy-conflict` compose no policy for a HIGH data_loss risk (SCN-KRN-067).
    process.env[PACKS_ENV] = path.join(CLI_ROOT, "test", "fixtures", "packs");
    const p = project()
      .remove(".warrant")
      .write(".warrant/warrant.json", {
        $schema: "warrant://config/1",
        kernel: "0.1",
        openspec: "1.13.x",
        packs: { policy: { version: "^1.0" }, "policy-conflict": { version: "^1.0" } }
      })
      // The fixture packs carry no controller rules: the project adds core-sdd's rule on a conflict.
      .write(".warrant/local/controller/rules.json", {
        $schema: "warrant://controller-rules/1",
        rules: [{ id: "policy-conflict", when: { policy_conflict: true }, action: "ESCALATE" }]
      })
      .withRecord(CHANGE, "PROPOSED", {
        classification: { profiles: ["feature"], risk: { data_loss: { value: "HIGH", from: "human:kat" } } }
      });

    const result = await evaluate(p.ctx, CHANGE, { checks: checksForTransition, env: LOCAL });
    expect(result.ok).toBe(false);
    if (result.ok || !result.conflict) throw new Error("expected a policy conflict");
    expect(result.error.code).toBe("POLICY_CONFLICT");
    expect(result.error.message.startsWith(`${CHANGE}: `)).toBe(true);
    expect(result.transition).toBe("PROPOSED->SPECIFIED");
    expect(result.decision).toEqual({ controller_action: "ESCALATE", rule: "policy-conflict" });
    // Refused before git: no check ran, no verdict was written.
    expect(p.checks.calls).toEqual([]);
    expect(existsSync(path.join(p.root, EVIDENCE))).toBe(false);
  });

  it("runs the checks of the transition, judges the gates and writes the verdicts", async () => {
    const p = await repo("PROPOSED", true);

    const result = await evaluate(p.ctx, CHANGE, { checks: checksForTransition, env: LOCAL });
    if (!result.ok) throw new Error(`expected an evaluation, got ${JSON.stringify(result)}`);
    expect(result.record["change_state"]).toBe("PROPOSED");
    expect(result.policy.hash).toMatch(/^sha256:/);
    expect(result.run.errors).toEqual([]);
    expect(result.run.entries.map((e) => e["id"])).toEqual(["openspec-validate"]);
    expect(result.evaluation.transition).toBe("PROPOSED->SPECIFIED");
    expect(result.evaluation.engine.gates).toEqual({
      "ids-valid": "PASS",
      "required-artifacts-present": "PASS",
      "spec-valid": "PASS"
    });
    expect(result.evaluation.decision.controller_action).toBe("CONTINUE");
    expect(gatesNotPassed(result.evaluation.engine.gates)).toEqual([]);
    // The verdicts are in the manifest, next to the record the check wrote.
    const manifest = JSON.parse(p.read(`${EVIDENCE}/${MANIFEST_FILE}`)) as Record<string, unknown>;
    expect(manifest["gates"]).toEqual(result.evaluation.engine.gates);
    expect(manifest["evidence"]).toEqual([result.run.entries[0]?.["evidence"]]);
  });

  it("returns a failing gate as GATES_NOT_PASSED with the controller's exit code", async () => {
    const p = await repo("PROPOSED", false);

    const result = await evaluate(p.ctx, CHANGE, { checks: checksForTransition, env: LOCAL });
    if (!result.ok) throw new Error(`expected an evaluation, got ${JSON.stringify(result)}`);
    expect(result.evaluation.engine.gates["spec-valid"]).toBe("FAIL");
    expect(result.evaluation.decision.rule).toBe("gate-failed");
    const failed = gatesNotPassed(result.evaluation.engine.gates);
    expect(failed).toEqual(["spec-valid"]);
    const refusal = gatesNotPassedRefusal(result.evaluation, failed);
    expect(refusal.error).toEqual({ code: "GATES_NOT_PASSED", message: "PROPOSED->SPECIFIED: gates not passed: spec-valid FAIL" });
    expect(refusal.exitCode).toBe(2);
  });

  it("judges recorded evidence only when no checks are asked for", async () => {
    const p = await repo("PROPOSED", true);

    const result = await evaluate(p.ctx, CHANGE, { env: LOCAL });
    if (!result.ok) throw new Error(`expected an evaluation, got ${JSON.stringify(result)}`);
    expect(result.run).toBeUndefined();
    expect(p.checks.calls).toEqual([]);
    // No spec-report recorded: the gate cannot judge, the transition would be refused.
    expect(result.evaluation.engine.gates["spec-valid"]).toBe("BLOCKED");
    expect(gatesNotPassed(result.evaluation.engine.gates)).toEqual(["spec-valid"]);
  });
});
