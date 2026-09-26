/**
 * The `human-approval` record (P-17, design §10 of phase 3, A-23): which record
 * of a login and ref counts as the same approval, and the record itself,
 * assembled through {@link buildEvidenceRecord}. `transition` decides when to
 * reuse one and writes it.
 */
import { canonicalHash } from "../canon/hash.js";
import { isPlainObject } from "../json.js";
import { buildEvidenceRecord, evidenceSubject } from "./record.js";

export const HUMAN_APPROVAL = "human-approval";

/**
 * Limitation of every `human-approval` record: `--ref` is only checked to be
 * an http(s) URL and `--by` is a claim; `warrant ci` of phase 4 verifies them
 * through the forge (ADR-0010 point 2, R-10).
 */
export const REF_NOT_VERIFIED = "ref not verified (phase 4: warrant ci)";

/** A `PROVEN` `human-approval` record of `login` attested by `ref` (freshness is the pre-filter's). */
export function isApprovalBy(json: Record<string, unknown>, login: string, ref: string): boolean {
  const producedBy = isPlainObject(json["produced_by"]) ? json["produced_by"] : {};
  const attestation = isPlainObject(json["attestation"]) ? json["attestation"] : {};
  return (
    json["kind"] === HUMAN_APPROVAL &&
    json["evidence_status"] === "PROVEN" &&
    producedBy["type"] === "human" &&
    producedBy["id"] === login &&
    attestation["type"] === "human-review" &&
    attestation["ref"] === ref
  );
}

export interface ApprovalRecordInput {
  id: string;
  change: string;
  transition: string;
  login: string;
  ref: string;
  commit: string;
  baseCommit?: string | undefined;
  /** `level` of gate `human-approval`. */
  level: string;
  /** Limitations of the git facts; {@link REF_NOT_VERIFIED} is appended. */
  limitations: readonly string[];
  effectivePolicyHash: string;
  createdAt: string;
}

/** The `human-approval` record of `login` for one transition. */
export function buildApprovalRecord(input: ApprovalRecordInput): Record<string, unknown> {
  return buildEvidenceRecord({
    id: input.id,
    kind: HUMAN_APPROVAL,
    level: input.level,
    status: "PROVEN",
    subject: evidenceSubject({ change: input.change, commit: input.commit, baseCommit: input.baseCommit }),
    claim: `${input.login} approved ${input.change} for ${input.transition}`,
    producedBy: { type: "human", id: input.login },
    attestation: { type: "human-review", ref: input.ref },
    contextHash: canonicalHash({
      change: input.change,
      commit: input.commit,
      transition: input.transition,
      by: input.login,
      ref: input.ref,
      effective_policy_hash: input.effectivePolicyHash
    }),
    effectivePolicyHash: input.effectivePolicyHash,
    createdAt: input.createdAt,
    artifacts: [],
    limitations: [...input.limitations, REF_NOT_VERIFIED]
  });
}
