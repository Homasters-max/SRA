/**
 * Building one evidence record (REQ-VER-001, design §6, 06a §2): `subject` and
 * the record of any producer (A-23), and the record of a check over them;
 * reading `subject` back (A-28).
 *
 * Everything the record says is computed by the CLI: the id is a ULID, the
 * hashes are SHA-256, the commit comes from git (06a section 3). The record
 * is assembled here as data; the command writes it with `writeJsonFile`.
 */
import { readFileSync } from "node:fs";

import { bytesHash, canonicalHash } from "../canon/hash.js";
import { projectUri, walkFiles } from "../fs.js";
import { isPlainObject } from "../json.js";
import type { Attestation } from "./attestation.js";

/** Status axis of an evidence record (02 §2): owned here (registry `enums` of `architecture.json`); the schema holds the same values. */
export const EVIDENCE_STATUSES = ["PROVEN", "NOT_PROVEN", "INCONCLUSIVE", "NOT_APPLICABLE"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/** Statuses of a record that account for its kind (R-8, `evidence-complete`): a `NOT_PROVEN` record proves nothing. */
export const COUNTING_STATUSES: ReadonlySet<unknown> = new Set<EvidenceStatus>(["PROVEN", "NOT_APPLICABLE"]);

/** Commit written when the project is not a git work tree (design §6). */
export const NO_GIT_COMMIT = "nogit";
export const NO_GIT_LIMITATION = "no git: commit unknown";

export interface Artifact {
  uri: string;
  sha256: string;
}

/** What `context_hash` covers for a check record (design §6). */
export interface CheckContext {
  change: string;
  commit: string;
  /** `<check-id>@<version>`. */
  check: string;
  effective_policy_hash: string;
  /** The argv after placeholder expansion. */
  argv: string[];
}

export function contextHash(context: CheckContext): string {
  return canonicalHash(context);
}

export interface CheckRecordInput {
  id: string;
  change: string;
  check: { id: string; version: string; level: string };
  kind: string;
  status: EvidenceStatus;
  metrics?: Record<string, unknown> | undefined;
  limitations: string[];
  /** HEAD, or {@link NO_GIT_COMMIT}. */
  commit: string;
  baseCommit?: string | undefined;
  attestation: Attestation;
  effectivePolicyHash: string;
  argv: string[];
  artifacts: Artifact[];
  createdAt: string;
}

/** What `subject` of a record names (06a §2): the commit judged, its base, the spec tree or the tree of a merge. */
export interface SubjectInput {
  change: string;
  /** HEAD, or {@link NO_GIT_COMMIT}; the head of the PR for a record made on the result of a merge. */
  commit: string;
  baseCommit?: string | undefined;
  specTree?: string | undefined;
  /**
   * Id of the git tree of the result of the merge the record was made on
   * (ADR-0037 п. 2, REQ-VER-001): only `warrant ci` knows it; a local `check`
   * or `verify` leaves it out.
   */
  tree?: string | undefined;
}

/** `subject` of every evidence record: one owner of `spec_revision` (A-23). */
export function evidenceSubject(input: SubjectInput): Record<string, unknown> {
  const subject: Record<string, unknown> = {
    commit: input.commit,
    spec_revision: `openspec/changes/${input.change}@${input.commit}`,
    dataset_snapshot: null
  };
  if (input.baseCommit !== undefined) subject["base_commit"] = input.baseCommit;
  if (input.specTree !== undefined) subject["spec_tree"] = input.specTree;
  if (input.tree !== undefined) subject["tree"] = input.tree;
  return subject;
}

/** `subject` of a stored record as read (A-28): what the record is bound to — the commit, its base, the spec tree, the tree of a merge. */
export interface EvidenceSubject {
  commit: string;
  baseCommit?: string;
  specRevision?: string;
  specTree?: string;
  tree?: string;
}

/**
 * The `subject` of `record` (A-28), the one reader beside the writer
 * {@link evidenceSubject}; undefined when it is not an object naming a
 * `commit` (a malformed record is `validate`'s finding). Fields of another
 * type than the schema's are left out.
 */
export function subjectOf(record: Record<string, unknown>): EvidenceSubject | undefined {
  const subject = record["subject"];
  if (!isPlainObject(subject)) return undefined;
  const text = (key: string): string | undefined => {
    const value = subject[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const commit = text("commit");
  if (commit === undefined) return undefined;
  const out: EvidenceSubject = { commit };
  const baseCommit = text("base_commit");
  if (baseCommit !== undefined) out.baseCommit = baseCommit;
  const specRevision = text("spec_revision");
  if (specRevision !== undefined) out.specRevision = specRevision;
  const specTree = text("spec_tree");
  if (specTree !== undefined) out.specTree = specTree;
  const tree = text("tree");
  if (tree !== undefined) out.tree = tree;
  return out;
}

/** One evidence record, whoever produced it (A-23): the producer supplies its own fields. */
export interface EvidenceRecordInput {
  id: string;
  kind: string;
  level: string;
  status: EvidenceStatus;
  subject: Record<string, unknown>;
  /** `claim.text`; `claim.targets` stays empty (linking to REQ/SCN is later). */
  claim: string;
  producedBy: Record<string, unknown>;
  attestation: Readonly<Record<string, unknown>>;
  contextHash: string;
  effectivePolicyHash: string;
  createdAt: string;
  artifacts: Artifact[];
  limitations: string[];
  metrics?: Record<string, unknown> | undefined;
}

/** The record as it is stored, `warrant://evidence/1`. */
export function buildEvidenceRecord(input: EvidenceRecordInput): Record<string, unknown> {
  const record: Record<string, unknown> = {
    $schema: "warrant://evidence/1",
    id: input.id,
    claim: { text: input.claim, targets: [] },
    kind: input.kind,
    level: input.level,
    evidence_status: input.status,
    subject: input.subject,
    produced_by: input.producedBy,
    attestation: input.attestation,
    context_hash: input.contextHash,
    effective_policy_hash: input.effectivePolicyHash,
    created_at: input.createdAt,
    artifacts: input.artifacts,
    limitations: input.limitations
  };
  if (input.metrics !== undefined) record["metrics"] = input.metrics;
  return record;
}

/**
 * The record of a check. `claim.targets` stays empty: linking evidence to
 * REQ/SCN is `analyze`'s job (phase 4); `produced_by.run` is absent because
 * there is no Run yet (REQ-VER-001).
 */
export function buildCheckRecord(input: CheckRecordInput): Record<string, unknown> {
  return buildEvidenceRecord({
    id: input.id,
    kind: input.kind,
    level: input.check.level,
    status: input.status,
    subject: evidenceSubject({ change: input.change, commit: input.commit, baseCommit: input.baseCommit }),
    claim: `${input.check.id} passed for ${input.change}`,
    producedBy: { type: "check", id: input.check.id, version: input.check.version },
    attestation: input.attestation,
    contextHash: contextHash({
      change: input.change,
      commit: input.commit,
      check: `${input.check.id}@${input.check.version}`,
      effective_policy_hash: input.effectivePolicyHash,
      argv: input.argv
    }),
    effectivePolicyHash: input.effectivePolicyHash,
    createdAt: input.createdAt,
    artifacts: input.artifacts,
    limitations: input.limitations,
    metrics: input.metrics
  });
}

/** Every file under `{out}`, sorted, referenced by uri and content hash (REQ-VER-001). */
export function collectArtifacts(root: string, outDir: string): Artifact[] {
  return walkFiles(outDir).map((absolute) => ({
    uri: projectUri(root, absolute),
    sha256: bytesHash(readFileSync(absolute))
  }));
}
