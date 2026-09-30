/**
 * `evidence-complete` (REQ-VER-004, I-96, R-8): every kind of
 * `evidence.required` of the effective policy is accounted for — the Change
 * has at least one record of that kind on any commit with `evidence_status`
 * `PROVEN` or `NOT_APPLICABLE` (freshness and attestation are judged by the
 * gates that read the kind, not here: a `human-approval` of
 * `SPECIFIED->APPROVED` must still count at `VERIFYING->MERGED`), or a gate
 * whose `requires_evidence` names the kind has a waiver of this Change that
 * counts (`waiverStatus`, design §1 — the same predicate as step 4 of the
 * verdict). A kind accounted for by neither is a `FAIL` naming it.
 */
import { COUNTING_STATUSES } from "../../evidence/record.js";
import { countingWaiver } from "../predicates.js";
import { pass, type Calculator, type L0Context } from "./types.js";

/** Whether `requires_evidence` of a gate document names `kind`. */
function requiresKind(gate: Record<string, unknown> | undefined, kind: string): boolean {
  const list = gate?.["requires_evidence"];
  return Array.isArray(list) && list.some((r) => typeof r === "object" && r !== null && (r as Record<string, unknown>)["kind"] === kind);
}

/** Whether a gate requiring `kind` has a waiver of this Change that counts (`countingWaiver`, D5). */
function waived(ctx: L0Context, kind: string): boolean {
  const gates = new Set(ctx.waivers.flatMap((w) => (typeof w.json["gate"] === "string" ? [w.json["gate"]] : [])));
  return [...gates].some(
    (gate) =>
      requiresKind(ctx.definitions.get(gate), kind) &&
      countingWaiver(gate, ctx.signals.change, ctx.waivers, ctx.definitions, ctx.waiverContext).counting !== undefined
  );
}

export const evidenceComplete: Calculator = (ctx) => {
  const missing: string[] = [];
  for (const kind of ctx.policy.evidence.required) {
    if (ctx.records.some((r) => r.json["kind"] === kind && COUNTING_STATUSES.has(r.json["evidence_status"]))) continue;
    if (waived(ctx, kind)) continue;
    missing.push(kind);
  }
  if (missing.length === 0) return pass();
  return {
    verdict: "FAIL",
    findings: [
      {
        code: "EVIDENCE_MISSING",
        gate: ctx.gate,
        items: missing,
        message: `no PROVEN or NOT_APPLICABLE evidence of the required kinds and no counting waiver on a gate that requires them: ${missing.join(", ")}`
      }
    ]
  };
};
