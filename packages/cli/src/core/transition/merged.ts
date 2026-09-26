/**
 * The rules of `MERGED` about the evidence of CI (A-29, REQ-VER-007, R-1,
 * R-6): which commit `MERGED` is judged on — the head of the merged impl-PR —
 * and that the verdicts rest on the records of one CI run. One place for
 * `transition MERGED`, and later `warrant ci` and `ci fetch` (design §2 of
 * phase-4c).
 */
import type { Ctx } from "../ctx.js";
import { WarrantError } from "../errors.js";
import { subjectOf } from "../evidence/record.js";
import { evidenceDir, readRecords } from "../evidence/store.js";
import { isAncestor, notMergedHeadReason, resolveCommit } from "../git/facts.js";
import type { EvidenceInput } from "../gates/types.js";
import { freshest } from "../gates/verdict.js";
import { isPlainObject } from "../json.js";
import type { Evaluation } from "./gates.js";
import { evidenceOf } from "./outcome.js";

/** `COMMIT_NOT_MERGED` unless `sha` is the head of a merged impl-PR (review of phase 3, R-1). */
async function assertMergedHead(ctx: Ctx, sha: string, source: string): Promise<void> {
  const refused = await notMergedHeadReason(ctx, sha);
  if (refused === null) return;
  throw new WarrantError("COMMIT_NOT_MERGED", `${source}: ${refused.reason}`, refused.hint === undefined ? {} : { hint: refused.hint });
}

/**
 * The commit of `MERGED` (design §9 of phase 3): `requested` (`--commit`),
 * else the commit of the freshest record of the Change; it must be an
 * ancestor of HEAD and the head of the impl-PR that brought it in (R-1).
 */
export async function mergedCommit(
  ctx: Ctx,
  change: string,
  requested: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  if (requested !== undefined) {
    const sha = await resolveCommit(ctx, requested);
    if (sha === null) throw new WarrantError("USAGE", `--commit ${JSON.stringify(requested)} does not name a commit of this repository`);
    if (!(await isAncestor(ctx, sha, "HEAD"))) {
      throw new WarrantError("COMMIT_NOT_MERGED", `commit ${sha} is not an ancestor of HEAD: merge the impl-PR first`);
    }
    await assertMergedHead(ctx, sha, "--commit");
    return sha;
  }
  const records = readRecords(evidenceDir(ctx.root, change, env)).map((r) => ({ id: r.id, json: r.json }));
  const latest = freshest(records);
  const commit = latest === undefined ? undefined : subjectOf(latest.json)?.commit;
  if (latest === undefined || commit === undefined) {
    throw new WarrantError("USAGE", `no evidence of "${change}" names a commit`, { hint: "pass --commit <sha>" });
  }
  const sha = await resolveCommit(ctx, commit);
  if (sha === null || !(await isAncestor(ctx, sha, "HEAD"))) {
    throw new WarrantError(
      "COMMIT_NOT_MERGED",
      `commit ${commit} of the freshest record ${latest.id} is not an ancestor of HEAD: merge the impl-PR first or pass --commit`
    );
  }
  await assertMergedHead(ctx, sha, `freshest record ${latest.id}`);
  return sha;
}

/** A ref without one trailing `/`: `…/runs/1/` and `…/runs/1` name the same run. */
function normalRef(ref: string): string {
  return ref.endsWith("/") ? ref.slice(0, -1) : ref;
}

/** The records attested by CI (`attestation.type: "ci"`) with their `attestation.ref`, normalised; a missing ref is null. */
function ciRefs(records: readonly EvidenceInput[]): { id: string; ref: string | null }[] {
  const out: { id: string; ref: string | null }[] = [];
  for (const record of records) {
    const attestation = isPlainObject(record.json["attestation"]) ? record.json["attestation"] : {};
    if (attestation["type"] !== "ci") continue;
    const ref = attestation["ref"];
    out.push({ id: record.id, ref: typeof ref === "string" ? normalRef(ref) : null });
  }
  return out;
}

/**
 * The CI run of `records` (R-6): the one `attestation.ref` every CI record
 * names — null when there is no CI record — or, when they name more than one
 * run or a record names none, the ids of every CI record, sorted.
 */
export function ciRunOf(records: readonly EvidenceInput[]): { ref: string | null } | { mismatched: string[] } {
  const refs = ciRefs(records);
  const first = refs[0];
  if (first === undefined) return { ref: null };
  const run = first.ref;
  if (run !== null && refs.every((r) => r.ref === run)) return { ref: run };
  return { mismatched: refs.map((r) => r.id).sort() };
}

/**
 * `REF_MISMATCH` unless every CI record the verdicts of `MERGED` rest on names
 * the run of `ref` (`--ref`, R-6): evidence of two runs is no evidence of one.
 */
export function assertOneRun(root: string, change: string, env: NodeJS.ProcessEnv, evaluation: Evaluation, ref: string): void {
  const used = new Set(evidenceOf(evaluation));
  const records = readRecords(evidenceDir(root, change, env)).filter((r) => used.has(r.id));
  const mismatched = ciRefs(records)
    .filter((r) => r.ref !== normalRef(ref))
    .map((r) => r.id);
  if (mismatched.length === 0) return;
  mismatched.sort();
  throw new WarrantError(
    "REF_MISMATCH",
    `--ref ${ref} is not the CI run of ${mismatched.join(", ")}: MERGED takes the evidence of one CI run, the one --ref names`
  );
}
