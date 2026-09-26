/**
 * The `human-approval` record (P-17, design §10 of phase 3, A-23): which record
 * of a login and ref counts as the same approval, the record itself,
 * assembled through {@link buildEvidenceRecord}, and {@link ensureApproval},
 * which reuses one or writes it (A-29).
 */
import { canonicalHash } from "../canon/hash.js";
import type { Ctx } from "../ctx.js";
import { isPlainObject } from "../json.js";
import { gateDefinitions } from "../packs/objects.js";
import type { LoadResult } from "../packs/types.js";
import { buildEvidenceRecord, evidenceSubject } from "./record.js";
import { evidenceDir, readRecords, type PendingRecord } from "./store.js";
import { manifestVersions, storeRecord } from "./write.js";

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

export interface EnsureApprovalParams {
  ctx: Ctx;
  change: string;
  env: NodeJS.ProcessEnv;
  loaded: LoadResult;
  policyHash: string;
  transition: string;
  /** The commit and base the approval is given on, and the limitations of the git facts. */
  git: { commit: string; baseCommit?: string | undefined; limitations: readonly string[] };
  login: string;
  ref: string;
  /**
   * Whether the pre-filter still admits an existing record — same commit and
   * base, the "waiver counts" of the gate engine (A-14). The pre-filter and
   * the waivers rank above this module, so the caller supplies it
   * (`core/transition/approval.ts`).
   */
  admits: (json: Record<string, unknown>) => boolean;
  /** The id of a new record (`allocateUlid("EVID")`, which cannot be imported here: a module cycle); called only when none is reused. */
  newId: () => string;
}

/**
 * The `human-approval` record of `login` for this transition (P-17, design
 * §10 of phase 3, A-29): an existing one the pre-filter still admits — same
 * commit and base, same login and ref — is reused; otherwise a new one is
 * written.
 */
export async function ensureApproval(params: EnsureApprovalParams): Promise<{ evidence: string; reused: boolean; record?: PendingRecord }> {
  const { ctx, change, env, git, login, ref } = params;
  const { root } = ctx;
  for (const record of readRecords(evidenceDir(root, change, env))) {
    if (isApprovalBy(record.json, login, ref) && params.admits(record.json)) {
      return { evidence: record.id, reused: true };
    }
  }

  const gate = gateDefinitions(params.loaded).get(HUMAN_APPROVAL);
  const id = params.newId();
  const record = buildApprovalRecord({
    id,
    change,
    transition: params.transition,
    login,
    ref,
    commit: git.commit,
    baseCommit: git.baseCommit,
    level: typeof gate?.["level"] === "string" ? gate["level"] : "L0",
    limitations: git.limitations,
    effectivePolicyHash: params.policyHash,
    createdAt: new Date().toISOString()
  });
  storeRecord({
    root,
    writes: ctx.writes,
    change,
    env,
    record,
    commit: git.commit,
    versions: await manifestVersions(ctx, params.policyHash),
    what: `${HUMAN_APPROVAL} by ${login}`
  });
  return { evidence: id, reused: false, record: { id, json: record } };
}
