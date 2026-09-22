/**
 * The controller (REQ-VER-005, 04 section 4, design §11): inputs from the
 * verdicts, the rules of the shipped `core-sdd` and the first match —
 * SCN-VER-024, 025, 026.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  conditionHolds,
  controllerRules,
  evaluateController,
  exitCodeOf,
  type ControllerRule
} from "../../../src/core/controller/evaluate.js";
import { conflictInputs, controllerInputs, type ControllerInputs } from "../../../src/core/controller/inputs.js";
import type { Finding, Verdict } from "../../../src/core/gates/types.js";
import type { LoadResult, PackObject } from "../../../src/core/packs/types.js";
import type { EffectivePolicy } from "../../../src/core/resolve/types.js";
import { REPO_ROOT } from "../../helpers/cli.js";

const CORE_RULES = JSON.parse(readFileSync(path.join(REPO_ROOT, "packs", "core-sdd", "controller", "rules.json"), "utf8"));
const GATES_DIR = path.join(REPO_ROOT, "packs", "core-sdd", "gates");

function gate(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(GATES_DIR, `${id}.json`), "utf8")) as Record<string, unknown>;
}

const DEFINITIONS = new Map(
  ["spec-valid", "tests-passed", "scope-valid", "branch-isolated", "human-approval", "analyze-clean"].map((id) => [id, gate(id)])
);

function loaded(objects: Partial<PackObject>[], packs: string[] = ["core-sdd"]): LoadResult {
  return {
    config: {},
    packs: packs.map((id) => ({ id, version: "0.2.0", dir: "", source: "bundled", manifest: {}, manifestPath: "" })),
    objects: objects as PackObject[],
    rules: [],
    evidenceKinds: [],
    files: [],
    errors: []
  };
}

const RULES = controllerRules(loaded([{ kind: "controller-rules", id: "rules", pack: "core-sdd", path: "", json: CORE_RULES }]));

const POLICY = {
  artifacts: { required: ["proposal"], recommended: [], forbidden: [] }
} as unknown as EffectivePolicy;

function inputs(gates: Record<string, Verdict>, extra: { unknowns?: unknown[]; findings?: Finding[]; transition?: string } = {}): ControllerInputs {
  return controllerInputs({
    transition: extra.transition ?? "VERIFYING->MERGED",
    gates,
    findings: extra.findings ?? [],
    definitions: DEFINITIONS,
    unknowns: extra.unknowns ?? [],
    policy: POLICY,
    artifacts: { ok: true, value: { proposal: "done" } }
  });
}

describe("controller inputs (04 section 4)", () => {
  it("takes the worst verdict and whether its gates are waivable", () => {
    const one = inputs({ "spec-valid": "PASS", "scope-valid": "FAIL", "branch-isolated": "FAIL" });
    expect(one.gate_verdict).toBe("FAIL");
    expect(one.gate_waivable).toBe(false);
    expect(inputs({ "branch-isolated": "FAIL", "spec-valid": "PASS" }).gate_waivable).toBe(true);
    expect(inputs({}).gate_verdict).toBeNull();
  });

  it("splits BLOCKED gates into pending approvals, awaiting attestation and unevaluated", () => {
    const merge = inputs({ "human-approval": "BLOCKED", "tests-passed": "BLOCKED", "analyze-clean": "BLOCKED" });
    expect([merge.pending_approvals, merge.gates_awaiting_attestation, merge.unevaluated_gates]).toEqual([1, 1, 1]);
    const local = inputs({ "spec-valid": "BLOCKED" }, { transition: "PROPOSED->SPECIFIED" });
    expect([local.pending_approvals, local.gates_awaiting_attestation, local.unevaluated_gates]).toEqual([0, 0, 1]);
  });
});

describe("controller rules of core-sdd", () => {
  it("gate FAIL → WAIT by gate-failed, exit 2 (SCN-VER-024)", () => {
    const decision = evaluateController(RULES, inputs({ "tests-passed": "FAIL", "spec-valid": "PASS" }));
    expect(decision).toEqual({ controller_action: "WAIT", rule: "gate-failed" });
    expect(exitCodeOf(decision.controller_action)).toBe(2);
  });

  it("open blocking UNKNOWN without FAIL → WAIT, next clarify (SCN-VER-025)", () => {
    const decision = evaluateController(
      RULES,
      inputs({ "spec-valid": "PASS" }, { unknowns: [{ id: "UNK-SRC-001", text: "?", blocking: true }] })
    );
    expect(decision).toEqual({ controller_action: "WAIT", next: "clarify", rule: "blocking-unknown" });
  });

  it("nothing matches → CONTINUE, rule null, exit 0 (SCN-VER-026)", () => {
    const decision = evaluateController(
      RULES,
      inputs({ "spec-valid": "PASS", "analyze-clean": "WAIVED", "branch-isolated": "NOT_APPLICABLE" })
    );
    expect(decision).toEqual({ controller_action: "CONTINUE", rule: null });
    expect(exitCodeOf(decision.controller_action)).toBe(0);
  });

  it("policy conflict → ESCALATE first", () => {
    expect(evaluateController(RULES, conflictInputs([{ id: "UNK-SRC-001", blocking: true }]))).toEqual({
      controller_action: "ESCALATE",
      rule: "policy-conflict"
    });
    expect(exitCodeOf("ESCALATE")).toBe(2);
    expect(exitCodeOf("STOP")).toBe(1);
  });
});

describe("rule matching and order", () => {
  it("compares booleans and enums by equality and \">N\" numerically", () => {
    expect(conditionHolds(true, true)).toBe(true);
    expect(conditionHolds(true, false)).toBe(false);
    expect(conditionHolds("FAIL", "FAIL")).toBe(true);
    expect(conditionHolds("FAIL", "BLOCKED")).toBe(false);
    expect(conditionHolds(">0", 1)).toBe(true);
    expect(conditionHolds(">0", 0)).toBe(false);
    expect(conditionHolds(">2", 3)).toBe(true);
    expect(conditionHolds(">0", undefined)).toBe(false);
  });

  it("tries packs in load order and each file in order; an input the CLI does not compute never matches", () => {
    const extra = {
      $schema: "warrant://controller-rules/1",
      rules: [
        { id: "tasks-open", when: { open_tasks: ">0" }, action: "CONTINUE", next: "implement" },
        { id: "verify-incomplete", when: { unevaluated_gates: ">0" }, action: "CONTINUE", next: "verify" }
      ]
    };
    const rules: ControllerRule[] = controllerRules(
      loaded(
        [
          { kind: "controller-rules", id: "a-rules", pack: "later", path: "", json: extra },
          { kind: "controller-rules", id: "rules", pack: "core-sdd", path: "", json: CORE_RULES }
        ],
        ["core-sdd", "later"]
      )
    );
    expect(rules.map((r) => r.id)).toEqual(["policy-conflict", "gate-failed", "blocking-unknown", "tasks-open", "verify-incomplete"]);
    expect(evaluateController(rules, inputs({ "analyze-clean": "BLOCKED" }))).toEqual({
      controller_action: "CONTINUE",
      next: "verify",
      rule: "verify-incomplete"
    });
    expect(evaluateController(rules, inputs({ "tests-passed": "FAIL" })).rule).toBe("gate-failed");
  });
});
