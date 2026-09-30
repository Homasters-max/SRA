/**
 * The merge a confirmed transition names and the law of its base (REQ-VER-011
 * «Ref», design D3, D4 of agent-merge). M of a new `MERGED` is the merge
 * commit on the first-parent line of HEAD^1 whose second parent is the common
 * `subject.commit` of the CI records of the transition, or — without such
 * records — the merge commit of the pull request of the ref that brought
 * `VERIFYING`; M of a new `APPROVED` — the merge commit of the spec-PR that
 * brought `SPECIFIED`. The ref of `MERGED` is judged by M^1, the base of the
 * impl-PR, not by the base of the archive-PR: an impl-PR merged by an agent
 * neither lifts the acceptance from itself nor writes itself a role.
 */
import type { WarrantConfig } from "../config.js";
import type { Ctx } from "../ctx.js";
import { attestationOf } from "../evidence/attestation.js";
import { subjectOf } from "../evidence/record.js";
import { changedPaths, mergeOfHead } from "../git/facts.js";
import { isPlainObject, strings } from "../json.js";
import type { DiffEntry } from "../ports/git.js";
import type { PullRequest } from "../ports/forge.js";
import { confirmationOf, FORWARD_CHAIN, type Confirmation } from "../record/lifecycle.js";
import type { ChangeRecord } from "../record/read.js";
import { recordPath } from "../record/write.js";
import type { EffectivePolicy } from "../resolve/index.js";
import { ownState } from "../run/state.js";
import { resolveRecord } from "../transition/policy.js";
import { changedBundledPacks, classificationOf, requiredProfiles, withBase } from "./base.js";
import { jsonAt, type CiSubject } from "./kind.js";
import type { NewTransition } from "./record.js";

/** M of a transition and its parents: M^1 — the base, M^2 — the head of the pull request. */
export interface MergeCommit {
  m: string;
  first: string;
  second: string;
}

export type LocatedMerge = { ok: true; merge: MergeCommit } | { ok: false; reason: "merge_commit" | "change"; detail: string };

/** Records of `evidence[]` of the transition that HEAD holds. */
export function transitionRecords(t: NewTransition, evidence: ReadonlyMap<string, Record<string, unknown>>): Record<string, unknown>[] {
  return strings(t.entry["evidence"]).flatMap((id) => {
    const json = evidence.get(id);
    return json === undefined ? [] : [json];
  });
}

/** Distinct `subject.commit` of the records with `attestation.type: "ci"`. */
export function ciHeads(records: readonly Record<string, unknown>[]): string[] {
  const ci = records.filter((json) => attestationOf(json).type === "ci");
  return [...new Set(ci.map((json) => subjectOf(json)?.commit ?? ""))];
}

/** Targets of the transitions `rev` adds to the record of `change` against its first parent. */
async function broughtTransitions(ctx: Pick<Ctx, "git">, rev: string, change: string): Promise<string[]> {
  const parent = (await ctx.git.parents(rev))[0];
  const after = await jsonAt(ctx, rev, recordPath(change));
  const before = parent === undefined ? undefined : await jsonAt(ctx, parent, recordPath(change));
  const list = (r: unknown): unknown[] => (isPlainObject(r) && Array.isArray(r["transitions"]) ? r["transitions"] : []);
  return list(after)
    .slice(list(before).length)
    .flatMap((t) => (isPlainObject(t) && typeof t["to"] === "string" ? [t["to"]] : []));
}

async function withParents(ctx: Pick<Ctx, "git">, m: string): Promise<MergeCommit> {
  const parents = await ctx.git.parents(m);
  return { m, first: parents[0] ?? "", second: parents[1] ?? "" };
}

/**
 * M of the confirmed transition `t` (REQ-VER-011 «Ref»). `pr` — the merged
 * pull request of its ref; undefined — not asked of the forge: then only the
 * CI records of a `MERGED` locate M.
 */
export async function locateMerge(
  ctx: Pick<Ctx, "git">,
  subject: CiSubject,
  t: NewTransition,
  records: readonly Record<string, unknown>[],
  pr: PullRequest | undefined
): Promise<LocatedMerge> {
  const change = subject.change as string;
  const heads = ciHeads(records);
  if (t.to === "MERGED" && heads.length > 0) {
    if (heads.length > 1) return { ok: false, reason: "merge_commit", detail: `the CI records of the transition name ${heads.length} commits: ${heads.join(", ")}` };
    const m = await mergeOfHead(ctx, heads[0] as string, subject.base);
    if (m === null) {
      return {
        ok: false,
        reason: "merge_commit",
        detail: `no merge commit on the first-parent line of the base has ${heads[0] as string}, the commit of the CI records, as its head`
      };
    }
    const merge = await withParents(ctx, m);
    if (pr !== undefined && (pr.mergeCommit !== m || pr.headSha !== merge.second)) {
      return {
        ok: false,
        reason: "merge_commit",
        detail: `pull request ${pr.number} was merged by ${String(pr.mergeCommit)} with head ${pr.headSha}, not by M ${m} with head ${merge.second}`
      };
    }
    return { ok: true, merge };
  }
  if (pr === undefined || pr.mergeCommit === null) return { ok: false, reason: "merge_commit", detail: "no merged pull request of the ref" };
  const line = new Set((await ctx.git.firstParents(subject.base)) ?? []);
  if (!line.has(pr.mergeCommit)) {
    return { ok: false, reason: "merge_commit", detail: `merge commit ${pr.mergeCommit} of pull request ${pr.number} is not on the first-parent line of the base` };
  }
  const brought = (confirmationOf(t.to) as Confirmation).broughtBy;
  if (!(await broughtTransitions(ctx, pr.mergeCommit, change)).includes(brought)) {
    return {
      ok: false,
      reason: "change",
      detail: `merge commit ${pr.mergeCommit} of pull request ${pr.number} does not bring the transition ${brought} into the record of ${change}`
    };
  }
  return { ok: true, merge: await withParents(ctx, pr.mergeCommit) };
}

/** `merge-base(M^1, M^2)..M^2`, relative to the project: the diff of the impl-PR; undefined when git cannot give it. */
export async function mergeDiff(ctx: Pick<Ctx, "git">, merge: MergeCommit): Promise<DiffEntry[] | undefined> {
  const diff = await changedPaths(ctx, { commonDir: await ctx.git.commonDir(), commit: merge.second, baseCommit: merge.first, limitations: [] });
  return diff.ok ? diff.value : undefined;
}

/** What the ref of `MERGED` is judged by: `warrant.json` and the policy of M^1 (design D3). */
export interface MergeLaw {
  /** `warrant.json` of M^1: `roles`, `identities.agents`. */
  config: WarrantConfig;
  /** The effective policy by M^1, or why the current CLI does not compute it. */
  policy: { ok: true; value: EffectivePolicy } | { ok: false; reason: string };
  /** `change_state` of the record of the Change on M^1; undefined — no record there. */
  stateAtBase: string | undefined;
}

/**
 * The law of M^1 for the ref of `MERGED` (design D3): the checkout of M^1, as
 * the base of `warrant ci` (`withBase`); the classification — the record of
 * the Change on M with the profiles `classify` by the packs of M^1 derives
 * from the diff of the impl-PR. The policy is not computed when the packs of
 * M^1 do not load under this CLI (`kernel`, a broken pack), a bundled pack
 * differs from the lock of M^1, the diff is unknown or the classification
 * names a profile neither the packs nor `.warrant/local/**` of M^1 declare.
 */
export async function mergeLaw(ctx: Pick<Ctx, "git" | "root">, change: string, merge: MergeCommit, env: NodeJS.ProcessEnv): Promise<MergeLaw> {
  const atM = await jsonAt(ctx, merge.m, recordPath(change));
  const atBase = await jsonAt(ctx, merge.first, recordPath(change));
  const stateAtBase = isPlainObject(atBase) && typeof atBase["change_state"] === "string" ? atBase["change_state"] : undefined;
  const diff = await mergeDiff(ctx, merge);
  return withBase(ctx, merge.first, async (base) => {
    const law = (reason: string): MergeLaw => ({ config: base.loaded.config, policy: { ok: false, reason }, stateAtBase });
    if (base.loaded.errors.length > 0) return law(`the packs of M^1 do not load: ${base.loaded.errors.map((e) => e.message).join("; ")}`);
    const changed = changedBundledPacks(base);
    if (changed.length > 0) return law(`bundled pack ${changed.join(", ")} of this CLI is not the one the lock of M^1 holds`);
    if (!isPlainObject(atM)) return law(`no record of ${change} on M ${merge.m}`);
    if (diff === undefined) return law(`the diff of the impl-PR ${merge.first}...${merge.second} is unknown`);
    const record = atM as ChangeRecord;
    const held = classificationOf(record)?.profiles ?? [];
    const paths = diff.flatMap((e) => (e.from === undefined ? [e.path] : [e.path, e.from]));
    const derived = requiredProfiles(base, paths, ownState(ctx.root, change, env), record);
    const profiles = [...new Set([...held, ...derived])].sort();
    const resolved = resolveRecord(base.loaded, change, { ...record, classification: { ...classificationOf(record), profiles } });
    if (!resolved.ok) return law(resolved.conflict ? resolved.error.message : resolved.errors.map((e) => e.message).join("; "));
    return { config: base.loaded.config, policy: { ok: true, value: resolved.policy }, stateAtBase };
  });
}

/** Whether `state` lies past `SPECIFIED`: the implementation reached the base before M (design D3). */
export function pastSpecified(state: string | undefined): boolean {
  if (state === undefined) return false;
  const index = (FORWARD_CHAIN as readonly string[]).indexOf(state);
  return index < 0 || index > FORWARD_CHAIN.indexOf("SPECIFIED");
}
