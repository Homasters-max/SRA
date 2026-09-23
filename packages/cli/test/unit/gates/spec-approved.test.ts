/**
 * `spec-approved` as pure functions (REQ-VER-004, phase-3b design §6): which
 * approval the contract is judged against, the tree comparison and the
 * verdict of the calculator over `signals.contract`. The git side is covered
 * end to end in `test/e2e/gate.test.ts` (SCN-VER-046…048).
 */
import { describe, expect, it } from "vitest";

import { approvalOf, specApproved, treeDifferences } from "../../../src/core/gates/l0/spec-approved.js";
import type { L0Context } from "../../../src/core/gates/l0/types.js";
import type { ContractTrees, EvidenceInput, GateSignals } from "../../../src/core/gates/types.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const APPROVAL_1 = "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y001";
const APPROVAL_2 = "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y002";
const SPEC_REPORT = "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y003";

function evidence(id: string, kind: string, commit: string): EvidenceInput {
  return { id, json: { id, kind, subject: { commit } } };
}

function transitions(...entries: Record<string, unknown>[]): Record<string, unknown> {
  return { transitions: [{ to: "PROPOSED" }, ...entries] };
}

function ctx(contract: GateSignals["contract"]): L0Context {
  const signals = { change: "add-search" } as GateSignals;
  if (contract !== undefined) signals.contract = contract;
  return { gate: "spec-approved", transition: "VERIFYING->MERGED", signals } as L0Context;
}

function trees(approved: Record<string, string>, evaluated: Record<string, string>): ContractTrees {
  return { evidence: APPROVAL_2, approved: { commit: A, tree: approved }, evaluated: { commit: B, tree: evaluated } };
}

describe("spec-approved", () => {
  it("takes the human-approval record of the last transition to APPROVED (ADR-0024 п. 2)", () => {
    const records = [
      evidence(APPROVAL_1, "human-approval", "1".repeat(40)),
      evidence(APPROVAL_2, "human-approval", A),
      evidence(SPEC_REPORT, "spec-report", A)
    ];
    const record = transitions(
      { to: "APPROVED", evidence: [APPROVAL_1] },
      { to: "IMPLEMENTING" },
      { to: "SPECIFIED" },
      { to: "APPROVED", evidence: [APPROVAL_2, SPEC_REPORT] }
    );
    expect(approvalOf(record, records)).toEqual({ ok: true, value: { evidence: APPROVAL_2, commit: A } });
  });

  it("has no approval without an APPROVED transition, a listed human-approval or a record in the store (SCN-VER-048)", () => {
    const records = [evidence(SPEC_REPORT, "spec-report", A)];
    expect(approvalOf(transitions(), records)).toMatchObject({ ok: false, reason: expect.stringContaining("no transition to APPROVED") });
    expect(approvalOf(transitions({ to: "APPROVED" }), records)).toMatchObject({ ok: false });
    expect(approvalOf(transitions({ to: "APPROVED", evidence: [SPEC_REPORT] }), records)).toMatchObject({ ok: false });
    expect(approvalOf(transitions({ to: "APPROVED", evidence: [APPROVAL_1] }), records)).toMatchObject({
      ok: false,
      reason: expect.stringContaining(APPROVAL_1)
    });
  });

  it("lists added, removed and changed paths, sorted", () => {
    expect(treeDifferences({ "p.md": "1", "s/a.md": "2", "s/b.md": "3" }, { "p.md": "1", "s/b.md": "4", "s/c.md": "5" })).toEqual([
      "s/a.md",
      "s/b.md",
      "s/c.md"
    ]);
    expect(treeDifferences({ "p.md": "1" }, { "p.md": "1" })).toEqual([]);
  });

  it("passes on equal trees, fails naming the paths, is BLOCKED without input (SCN-VER-046, 047, 048)", () => {
    expect(specApproved(ctx({ ok: true, value: trees({ "p.md": "1" }, { "p.md": "1" }) }))).toEqual({ verdict: "PASS", findings: [] });
    const failed = specApproved(ctx({ ok: true, value: trees({ "p.md": "1" }, { "p.md": "2" }) }));
    expect(failed.verdict).toBe("FAIL");
    expect(failed.findings).toEqual([
      expect.objectContaining({ code: "SPEC_CHANGED_AFTER_APPROVAL", gate: "spec-approved", evidence: APPROVAL_2, paths: ["p.md"] })
    ]);
    expect(specApproved(ctx({ ok: false, reason: "no git" }))).toEqual({
      verdict: "BLOCKED",
      findings: [{ code: "NO_INPUT", gate: "spec-approved", message: "no git" }]
    });
    expect(specApproved(ctx(undefined)).verdict).toBe("BLOCKED");
  });
});
