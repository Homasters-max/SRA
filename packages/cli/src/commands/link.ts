/**
 * `warrant link <change> (--amends <target> | --supersedes <target>) [--remove]`
 * (REQ-KRN-030, ADR-0021 points 4 and 9, design §8).
 *
 * Adds `target` to `amends[]` or `supersedes[]` of the record of `change`
 * (no duplicates, order kept) or, with `--remove`, takes it out. Links are
 * metadata of the proposal: they change only in `PROPOSED` / `SPECIFIED`;
 * from `APPROVED` on it is `STATE_INVALID` (a new approval revision would be
 * needed), a frozen record is `RECORD_FROZEN`. A target is judged by the same
 * predicate as check (10) of `validate` (`linkTargetProblem`), so a record
 * `link` wrote always passes that check. `--remove` does not judge the target:
 * taking out a link that has become invalid must stay possible.
 */
import type { Ctx } from "../core/ctx.js";
import { WarrantError } from "../core/errors.js";
import { LINKABLE_STATES } from "../core/record/lifecycle.js";
import { readAllRecords, readChangeRecord } from "../core/record/read.js";
import { assertNotFrozen, recordPath, stateOfRecord, writeRecord } from "../core/record/write.js";
import { linkTargetProblem, type LinkField } from "../core/validate/links.js";
import { success, type CommandResult } from "../io/output.js";
import { requireConfigPath } from "./context.js";

export interface LinkOptions {
  amends?: string | undefined;
  supersedes?: string | undefined;
  remove?: boolean | undefined;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function runLink(ctx: Ctx, change: string, opts: LinkOptions = {}): CommandResult {
  const { root } = ctx;
  requireConfigPath(root);

  const given = (["amends", "supersedes"] as const).filter((f) => opts[f] !== undefined);
  if (given.length !== 1) {
    throw new WarrantError("USAGE", "warrant link needs exactly one of --amends <target>, --supersedes <target>");
  }
  const field: LinkField = given[0] as LinkField;
  const target = opts[field] as string;
  if (target === "") throw new WarrantError("USAGE", `--${field} needs the name of a Change`);

  const record = readChangeRecord(root, change);
  assertNotFrozen(record, change);
  const state = stateOfRecord(record);
  if (!(LINKABLE_STATES as readonly string[]).includes(state)) {
    throw new WarrantError(
      "STATE_INVALID",
      `record of "${change}" is ${state}: amends/supersedes change only in PROPOSED or SPECIFIED, before approval`,
      { path: recordPath(change) }
    );
  }

  const current = stringsOf(record[field]);
  const remove = opts.remove === true;
  let next: string[];
  if (remove) {
    next = current.filter((t) => t !== target);
  } else {
    if (target === change) {
      throw new WarrantError("LINK_TARGET_INVALID", `${change} cannot ${field === "amends" ? "amend" : "supersede"} itself`, {
        path: `${recordPath(change)}#/${field}`
      });
    }
    const problem = linkTargetProblem(field, target, readAllRecords(root));
    if (problem !== null) throw new WarrantError("LINK_TARGET_INVALID", problem, { path: `${recordPath(change)}#/${field}` });
    next = current.includes(target) ? current : [...current, target];
  }

  const changed = next.length !== current.length;
  if (changed) {
    const updated: Record<string, unknown> = { ...record };
    // An emptied list is dropped: the field is optional and `[]` says nothing more.
    if (next.length === 0) delete updated[field];
    else updated[field] = next;
    writeRecord(ctx, change, record, updated);
  }

  const written = changed ? next : current;
  return success(
    {
      field,
      target,
      action: remove ? "remove" : "add",
      changed,
      [field]: written
    },
    change
  );
}
