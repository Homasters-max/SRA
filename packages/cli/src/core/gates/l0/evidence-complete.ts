/**
 * `evidence-complete`: every kind of `evidence.required` of the effective
 * policy has an admissible record — one that passed the pre-filter (D-12)
 * and whose attestation this gate accepts on the transition (06a section 3).
 * A kind without any admissible record is a `FAIL` naming it; a kind whose
 * records are all unattested on a merge is `BLOCKED` with `ATTESTATION_REQUIRED`.
 */
import { pass, type Calculator } from "./types.js";

export const evidenceComplete: Calculator = (ctx) => {
  const missing: string[] = [];
  const unattested: string[] = [];
  for (const kind of ctx.policy.evidence.required) {
    const records = ctx.admissible.filter((r) => r.json["kind"] === kind);
    if (records.length === 0) missing.push(kind);
    else if (!records.some((r) => ctx.accepts(r))) unattested.push(kind);
  }
  if (missing.length > 0) {
    return {
      verdict: "FAIL",
      findings: [
        {
          code: "EVIDENCE_MISSING",
          gate: ctx.gate,
          items: missing,
          message: `no admissible evidence of the required kinds: ${missing.join(", ")}`
        }
      ]
    };
  }
  if (unattested.length > 0) {
    return {
      verdict: "BLOCKED",
      findings: [
        {
          code: "ATTESTATION_REQUIRED",
          gate: ctx.gate,
          items: unattested,
          message: `only unattested evidence of: ${unattested.join(", ")}; ${ctx.transition} needs records from CI`
        }
      ]
    };
  }
  return pass();
};
