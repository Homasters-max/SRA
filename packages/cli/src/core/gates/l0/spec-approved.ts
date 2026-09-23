/**
 * `spec-approved` (REQ-VER-004, phase-3b design §6, ADR-0024): the contract
 * of the Change — `proposal.md` and `specs/**` of `openspec/changes/<change>/`,
 * as pairs path → blob sha — on the evaluated commit is the one approved.
 *
 * The approval commit is `subject.commit` of the `human-approval` record whose
 * id is listed in `evidence[]` of the last transition to `APPROVED` of the
 * record ({@link approvalOf}); the command layer reads both trees from git
 * (`contractTree`) into `signals.contract`. `design.md` and `tasks.md` are the
 * journal of the implementation and are not part of the contract.
 *
 * No such transition, record or git → `BLOCKED` with `NO_INPUT`; any path
 * added, removed or changed → `FAIL` with `SPEC_CHANGED_AFTER_APPROVAL` naming
 * the paths. The gate is `waivable: true`: a maintainer's waiver turns the
 * `FAIL` into `WAIVED` by step 4 of the verdict, the finding stays.
 */
import type { Availability, BlobTree, EvidenceInput } from "../types.js";
import { noInput, pass, type Calculator } from "./types.js";

export const SPEC_APPROVED = "spec-approved";

const HUMAN_APPROVAL = "human-approval";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The approval the contract is judged against: its record id and commit. */
export interface Approval {
  evidence: string;
  commit: string;
}

/**
 * The `human-approval` record of the last transition to `APPROVED` of `record`
 * and its `subject.commit`, or why there is none. When the transition lists
 * several such records (several approvers), the newest one counts — they were
 * all written on the commit of that transition.
 */
export function approvalOf(record: Record<string, unknown>, records: readonly EvidenceInput[]): Availability<Approval> {
  const transitions = Array.isArray(record["transitions"]) ? record["transitions"] : [];
  const approved = [...transitions].reverse().find((t) => isPlainObject(t) && t["to"] === "APPROVED");
  if (!isPlainObject(approved)) return { ok: false, reason: "the record has no transition to APPROVED" };
  const listed = new Set(Array.isArray(approved["evidence"]) ? approved["evidence"].filter((e) => typeof e === "string") : []);
  if (listed.size === 0) return { ok: false, reason: "the last transition to APPROVED lists no evidence" };

  const approvals = records
    .filter((r) => listed.has(r.id) && r.json["kind"] === HUMAN_APPROVAL)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const newest = approvals.at(-1);
  if (newest === undefined) {
    return {
      ok: false,
      reason: `no ${HUMAN_APPROVAL} record among the evidence of the last transition to APPROVED (${[...listed].sort().join(", ")}) is in the evidence store`
    };
  }
  const subject = isPlainObject(newest.json["subject"]) ? newest.json["subject"] : {};
  const commit = subject["commit"];
  if (typeof commit !== "string" || commit === "") {
    return { ok: false, reason: `${HUMAN_APPROVAL} record ${newest.id} names no subject.commit` };
  }
  return { ok: true, value: { evidence: newest.id, commit } };
}

/** Paths added, removed or changed between two trees, sorted. */
export function treeDifferences(before: BlobTree, after: BlobTree): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths].filter((p) => before[p] !== after[p]).sort();
}

export const specApproved: Calculator = (ctx) => {
  const contract = ctx.signals.contract;
  if (contract === undefined) return noInput(ctx.gate, "the contract of the change was not read");
  if (!contract.ok) return noInput(ctx.gate, contract.reason);
  const { approved, evaluated, evidence } = contract.value;
  const changed = treeDifferences(approved.tree, evaluated.tree);
  if (changed.length === 0) return pass();
  return {
    verdict: "FAIL",
    findings: [
      {
        code: "SPEC_CHANGED_AFTER_APPROVAL",
        gate: ctx.gate,
        evidence,
        paths: changed,
        message: `the contract changed after approval (${evidence} on ${approved.commit}, evaluated ${evaluated.commit}): ${changed.join(", ")}`
      }
    ]
  };
};
