/**
 * Building one evidence record of a check (REQ-VER-001, design §6, 06a §2).
 *
 * Everything the record says is computed by the CLI: the id is a ULID, the
 * hashes are SHA-256, the commit comes from git (06a section 3). The record
 * is assembled here as data; the command writes it with `writeJsonFile`.
 */
import { readFileSync } from "node:fs";

import { bytesHash, canonicalHash } from "../canon/hash.js";
import { walkFiles } from "../fs.js";
import type { Attestation } from "./attestation.js";
import { projectUri } from "./store.js";

export type EvidenceStatus = "PROVEN" | "NOT_PROVEN" | "INCONCLUSIVE" | "NOT_APPLICABLE";

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

/**
 * The record as it is stored. `claim.targets` stays empty: linking evidence to
 * REQ/SCN is `analyze`'s job (phase 4); `produced_by.run` is absent because
 * there is no Run yet (REQ-VER-001).
 */
export function buildCheckRecord(input: CheckRecordInput): Record<string, unknown> {
  const subject: Record<string, unknown> = {
    commit: input.commit,
    spec_revision: `openspec/changes/${input.change}@${input.commit}`,
    dataset_snapshot: null
  };
  if (input.baseCommit !== undefined) subject["base_commit"] = input.baseCommit;

  const record: Record<string, unknown> = {
    $schema: "warrant://evidence/1",
    id: input.id,
    claim: { text: `${input.check.id} passed for ${input.change}`, targets: [] },
    kind: input.kind,
    level: input.check.level,
    evidence_status: input.status,
    subject,
    produced_by: { type: "check", id: input.check.id, version: input.check.version },
    attestation: input.attestation,
    context_hash: contextHash({
      change: input.change,
      commit: input.commit,
      check: `${input.check.id}@${input.check.version}`,
      effective_policy_hash: input.effectivePolicyHash,
      argv: input.argv
    }),
    effective_policy_hash: input.effectivePolicyHash,
    created_at: input.createdAt,
    artifacts: input.artifacts,
    limitations: input.limitations
  };
  if (input.metrics !== undefined) record["metrics"] = input.metrics;
  return record;
}

/** Every file under `{out}`, sorted, referenced by uri and content hash (REQ-VER-001). */
export function collectArtifacts(root: string, outDir: string): Artifact[] {
  return walkFiles(outDir).map((absolute) => ({
    uri: projectUri(root, absolute),
    sha256: bytesHash(readFileSync(absolute))
  }));
}
