/**
 * `evidence-complete` (REQ-VER-004, I-96): every kind of `evidence.required`
 * of the effective policy is accounted for — the Change has at least one
 * record of that kind on any commit (freshness and attestation are judged by
 * the gates that read the kind, not here: a `human-approval` of
 * `SPECIFIED->APPROVED` must still count at `VERIFYING->MERGED`), or a gate
 * whose `requires_evidence` names the kind has a waiver of this Change in
 * force (`ACTIVE`, `expires_at >= today` UTC — as in the verdict).
 * A kind accounted for by neither is a `FAIL` naming it.
 */
import { isWaiverInForce } from "../prefilter.js";
import { pass, type Calculator, type L0Context } from "./types.js";

/** Whether `requires_evidence` of a gate document names `kind`. */
function requiresKind(gate: Record<string, unknown> | undefined, kind: string): boolean {
  const list = gate?.["requires_evidence"];
  return Array.isArray(list) && list.some((r) => typeof r === "object" && r !== null && (r as Record<string, unknown>)["kind"] === kind);
}

/** Whether a gate requiring `kind` has a waiver of this Change in force. */
function waived(ctx: L0Context, kind: string): boolean {
  return ctx.waivers.some((waiver) => {
    const gate = waiver.json["gate"];
    return (
      typeof gate === "string" &&
      waiver.json["change"] === ctx.signals.change &&
      isWaiverInForce(waiver.json, ctx.signals.today) &&
      requiresKind(ctx.definitions.get(gate), kind)
    );
  });
}

export const evidenceComplete: Calculator = (ctx) => {
  const missing: string[] = [];
  for (const kind of ctx.policy.evidence.required) {
    if (ctx.records.some((r) => r.json["kind"] === kind)) continue;
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
        message: `no evidence of the required kinds and no waiver in force on a gate that requires them: ${missing.join(", ")}`
      }
    ]
  };
};
