/**
 * What `warrant ci` judges (REQ-VER-011, design §4 of phase-4c): HEAD is the
 * result of a merge — the first parent the tip of the base, the second the
 * head of the pull request — the diff is `HEAD^1..HEAD`, the Change is the one
 * whose record the diff changes, and the kind of the pull request follows from
 * `change_state` of that record on HEAD (N33; not from the branch, ADR-0034
 * п. 13). States and transitions are read through their owner
 * `core/record/lifecycle.ts` (audit phase-4b §3.4).
 */
import type { Ctx } from "../ctx.js";
import { cliError, WarrantError, type CliError } from "../errors.js";
import { changedPaths, type DiffEntry } from "../git/facts.js";
import { isPlainObject } from "../json.js";
import { isChangeState, PR_KIND_OF_STATE, type PrKind } from "../record/lifecycle.js";
import type { ChangeRecord } from "../record/read.js";

/** HEAD and its two parents. */
export interface MergeHead {
  /** HEAD: the result of the merge. */
  merge: string;
  /** HEAD^1: the tip of the base. */
  base: string;
  /** HEAD^2: the head of the pull request. */
  head: string;
}

export interface CiSubject extends MergeHead {
  /** `HEAD^1..HEAD`, relative to the project, sorted by path. */
  diff: DiffEntry[];
  kind: PrKind;
  change?: string;
  /** The record of the Change on HEAD. */
  record?: ChangeRecord;
  /** The record of the Change on HEAD^1; absent for a Change the pull request creates. */
  baseRecord?: ChangeRecord;
  /** `TOPOLOGY_VIOLATION`, a deleted or unreadable record: nothing else is judged. */
  errors: CliError[];
}

const RECORD_RE = /^\.warrant\/changes\/([^/]+)\.json$/;

/** Path of the record of `change`, relative to the project. */
export function recordRel(change: string): string {
  return `.warrant/changes/${change}.json`;
}

/** How to make HEAD what `warrant ci` judges. */
const MERGE_HINT =
  "run warrant ci on the result of the merge: git checkout --detach <tip of the base> && git merge --no-ff <head of the pull request> && warrant ci";

/** HEAD and its parents; `USAGE` (exit 3) unless HEAD is a merge commit with exactly two parents. */
export async function readMergeHead(ctx: Pick<Ctx, "git">): Promise<MergeHead> {
  const merge = await ctx.git.head();
  if (merge === null) throw new WarrantError("USAGE", "warrant ci needs a git repository with a commit at HEAD", { hint: MERGE_HINT });
  const parents = await ctx.git.parents(merge);
  if (parents.length !== 2) {
    throw new WarrantError(
      "USAGE",
      `HEAD ${merge} has ${parents.length} parent${parents.length === 1 ? "" : "s"}: warrant ci judges the result of a merge — the tip of the base and the head of the pull request`,
      { hint: MERGE_HINT }
    );
  }
  return { merge, base: parents[0] as string, head: parents[1] as string };
}

/**
 * The parsed JSON of `rel` (relative to the project) at `rev`; undefined when
 * the file is absent there, null when it is not JSON.
 */
export async function jsonAt(ctx: Pick<Ctx, "git">, rev: string, rel: string): Promise<unknown> {
  const text = (await ctx.git.contents(rev, [`./${rel}`])).get(`./${rel}`);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Names of the Changes whose records the diff adds, changes, deletes or renames; `deleted` — records gone on HEAD. */
function changedRecords(diff: readonly DiffEntry[]): { names: string[]; deleted: string[] } {
  const names = new Set<string>();
  const deleted = new Set<string>();
  for (const entry of diff) {
    const to = RECORD_RE.exec(entry.path)?.[1];
    const from = entry.from === undefined ? undefined : RECORD_RE.exec(entry.from)?.[1];
    if (to !== undefined) {
      names.add(to);
      if (entry.status === "D") deleted.add(to);
    }
    if (from !== undefined) {
      names.add(from);
      if (from !== to) deleted.add(from);
    }
  }
  return { names: [...names].sort(), deleted: [...deleted].sort() };
}

/**
 * The subject of `warrant ci`: HEAD and its parents, the diff, the Change and
 * the kind. A pull request that changes the records of two Changes, or deletes
 * a record, is reported in `errors` with the kind `none`.
 */
export async function readCiSubject(ctx: Pick<Ctx, "git">): Promise<CiSubject> {
  const heads = await readMergeHead(ctx);
  const commonDir = await ctx.git.commonDir();
  const diff = await changedPaths(ctx, { commonDir, commit: heads.merge, baseCommit: heads.base, limitations: [] });
  if (!diff.ok) throw new WarrantError("USAGE", `the diff of the pull request is unknown: ${diff.reason}`);
  const subject: CiSubject = { ...heads, diff: diff.value, kind: "none", errors: [] };

  const { names, deleted } = changedRecords(diff.value);
  if (names.length === 0) return subject;
  if (names.length > 1) {
    subject.errors.push(
      cliError("TOPOLOGY_VIOLATION", `the pull request changes the records of ${names.length} Changes: ${names.join(", ")}`, {
        hint: "one pull request moves one Change: split it by Change"
      })
    );
    return subject;
  }
  const change = names[0] as string;
  subject.change = change;
  for (const name of deleted) {
    subject.errors.push(
      cliError("RECORD_MISMATCH", `the record of ${name} is deleted: a record never leaves the repository (ADR-0021)`, {
        path: recordRel(name),
        hint: `restore ${recordRel(name)}; a Change ends in ARCHIVED or ABANDONED`
      })
    );
  }
  if (subject.errors.length > 0) return subject;

  const record = await jsonAt(ctx, heads.merge, recordRel(change));
  const state = isPlainObject(record) ? record["change_state"] : undefined;
  if (!isPlainObject(record) || typeof state !== "string" || !isChangeState(state)) {
    subject.errors.push(
      cliError("RECORD_MISMATCH", `the record of ${change} on HEAD is not a change record with a known change_state`, {
        path: recordRel(change),
        hint: "run `warrant validate`"
      })
    );
    return subject;
  }
  subject.record = record;
  subject.kind = PR_KIND_OF_STATE[state];
  const base = await jsonAt(ctx, heads.base, recordRel(change));
  if (isPlainObject(base)) subject.baseRecord = base;
  return subject;
}
