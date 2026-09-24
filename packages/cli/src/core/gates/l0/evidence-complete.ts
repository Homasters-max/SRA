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
import { waiverStatus } from "../../waivers/status.js";
import { pass, type Calculator, type L0Context } from "./types.js";

/** Statuses of a record that account for its kind (R-8): a `NOT_PROVEN` record proves nothing. */
const COUNTING_STATUSES: ReadonlySet<unknown> = new Set(["PROVEN", "NOT_APPLICABLE"]);

/** Whether `requires_evidence` of a gate document names `kind`. */
function requiresKind(gate: Record<string, unknown> | undefined, kind: string): boolean {
  const list = gate?.["requires_evidence"];
  return Array.isArray(list) && list.some((r) => typeof r === "object" && r !== null && (r as Record<string, unknown>)["kind"] === kind);
}

/** Whether a gate requiring `kind` has a waiver of this Change that counts. */
function waived(ctx: L0Context, kind: string): boolean {
  return ctx.waivers.some((waiver) => {
    const gate = waiver.json["gate"];
    if (typeof gate !== "string" || waiver.json["change"] !== ctx.signals.change) return false;
    const definition = ctx.definitions.get(gate);
    return requiresKind(definition, kind) && waiverStatus(waiver.json, definition, ctx.waiverContext).counts;
  });
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
