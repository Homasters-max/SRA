/**
 * The base of requirements of `warrant ci` (REQ-VER-011, ADR-0038 п. 1, I-171):
 * everything `warrant ci` derives requirements to a pull request from — policy
 * paths, `paths.*`, `roles`, `approvals[]`, the effective policy and the
 * classification by the paths of the diff — is read from one context: the
 * packs and `warrant.json` of the checkout of HEAD^1, not from the pull request.
 * The pull request presents only what is judged: the record, evidence, code.
 *
 * A bundled pack comes with the CLI, which the job installs from the checkout
 * of the pull request, so it cannot be read from the tree of HEAD^1 (I-179):
 * the pack of the base is recognised by its `hash` in the lock of HEAD^1. A
 * bundled pack the lock of the base does not hold is the law changed by the
 * pull request itself.
 */
import path from "node:path";
import { classify } from "../classify/index.js";
import { collectFloors, collectProfileMatches } from "../classify/packs.js";
import type { Ctx } from "../ctx.js";
import { WarrantError, type CliError } from "../errors.js";
import { readJson } from "../fs.js";
import { MERGE_TRANSITION } from "../gates/types.js";
import { isPlainObject, strings } from "../json.js";
import { LOCK_REL, packContentHash } from "../packs/hash.js";
import { loadPacks } from "../packs/loader.js";
import { policyPaths } from "../packs/objects.js";
import type { LoadResult } from "../packs/types.js";
import type { ChangeRecord } from "../record/read.js";
import type { Classification } from "../resolve/index.js";
import { requiresHuman } from "../roles.js";
import { resolveRecord, type Resolved } from "../transition/policy.js";

export interface BaseContext {
  /** The project root in the checkout of HEAD^1. */
  root: string;
  /** Packs, local layer and `warrant.json` of the base; `loaded.errors` — a broken base (exit 3). */
  loaded: LoadResult;
}

/**
 * Checks out `commit` (HEAD^1), loads its packs and `warrant.json` and gives
 * them to `use`; the checkout is removed in `finally`, whatever `use` does.
 * `USAGE` (exit 3) when git cannot check the base out.
 */
export async function withBase<T>(ctx: Pick<Ctx, "git">, commit: string, use: (base: BaseContext) => Promise<T>): Promise<T> {
  const checkout = await ctx.git.worktreeAt(commit);
  if (!checkout.ok) {
    throw new WarrantError("USAGE", `git could not check out the base ${commit} of the pull request: ${checkout.detail}`, {
      hint: "fetch the history of the base: git fetch --unshallow (or actions/checkout with fetch-depth: 0)"
    });
  }
  try {
    const loaded = loadPacks(checkout.value.root);
    return await use({ root: checkout.value.root, loaded });
  } finally {
    await checkout.value.dispose();
  }
}

/** The `classification` of a record, or undefined. */
export function classificationOf(record: ChangeRecord | undefined): Classification | undefined {
  const value = record?.["classification"];
  return isPlainObject(value) ? (value as Classification) : undefined;
}

/** The effective policy of `record` by the packs of the base. */
export function basePolicy(base: BaseContext, change: string, record: ChangeRecord): Resolved {
  return resolveRecord(base.loaded, change, record);
}

/**
 * Whether an object of the policy of the base — packs and `.warrant/local/**` —
 * puts gate `human-approval` on `VERIFYING->MERGED` (design D8 of agent-merge):
 * without one no path limits a merge of an impl-PR by an agent.
 */
export function humanAcceptance(base: BaseContext): boolean {
  return base.loaded.objects.some((object) => {
    const gates = isPlainObject(object.json) && isPlainObject(object.json["gates"]) ? object.json["gates"] : {};
    return requiresHuman({ gates: { [MERGE_TRANSITION]: strings(gates[MERGE_TRANSITION]) } }, MERGE_TRANSITION);
  });
}

/** `match.paths` of `factory-change` of the base: the policy paths (D-15). */
export function basePolicyPaths(base: BaseContext): string[] {
  return policyPaths(base.loaded);
}

/**
 * Ids of the bundled packs whose content is not the one the lock of the base
 * holds (I-179): the pull request changes the law it is judged by. No lock in
 * the base, or no entry for the pack, counts as changed.
 */
export function changedBundledPacks(base: BaseContext): string[] {
  const errors: CliError[] = [];
  const lock = readJson(path.join(base.root, ...LOCK_REL.split("/")), LOCK_REL, errors);
  const locked = isPlainObject(lock) && isPlainObject(lock["packs"]) ? lock["packs"] : {};
  return base.loaded.packs
    .filter((pack) => pack.source === "bundled")
    .filter((pack) => {
      const entry = locked[pack.id];
      return !isPlainObject(entry) || entry["hash"] !== packContentHash(pack.dir);
    })
    .map((pack) => pack.id)
    .sort();
}

/**
 * The profiles the record on HEAD must hold (SCN-VER-107): those of the record
 * of the base and those `classify` with the packs of the base derives from the
 * paths of the diff; the own state of the Change takes no part (N27).
 */
export function requiredProfiles(
  base: BaseContext,
  changed: readonly string[],
  own: (p: string) => boolean,
  baseRecord: ChangeRecord | undefined
): string[] {
  const previous = classificationOf(baseRecord);
  const result = classify({
    changed: [...changed],
    own,
    floors: collectFloors(base.loaded.objects),
    profiles: collectProfileMatches(base.loaded.objects),
    ...(previous === undefined ? {} : { previous: { profiles: previous.profiles ?? [] } })
  });
  return result.classification.profiles ?? [];
}
