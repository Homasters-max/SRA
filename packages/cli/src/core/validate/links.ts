/**
 * Links between Changes (`amends[]`, `supersedes[]`, ADR-0021): check (10) of
 * `validate` and the back-links of `status` (REQ-KRN-021, REQ-KRN-027).
 */
import type { CliError } from "../errors.js";
import { stateOf, type RecordFile } from "../record/read.js";

/** States a link target must be in, per field (ADR-0021 point 5). */
const TARGET_STATES = {
  amends: ["MERGED", "ARCHIVED"],
  supersedes: ["ABANDONED"]
} as const;

export type LinkField = keyof typeof TARGET_STATES;

export const LINK_FIELDS: readonly LinkField[] = ["amends", "supersedes"];

/**
 * Why `target` may not stand in `field` of a record, or null when it may: the
 * one predicate of check (10) and of `warrant link` (design §8).
 */
export function linkTargetProblem(field: LinkField, target: string, records: ReadonlyMap<string, RecordFile>): string | null {
  const allowed: readonly string[] = TARGET_STATES[field];
  const state = stateOf(records.get(target));
  if (state !== undefined && allowed.includes(state)) return null;
  const why = state === undefined ? `there is no record for "${target}"` : `"${target}" is ${state}`;
  return `${field} target must be a Change in ${allowed.join(" or ")}: ${why}`;
}

function targetsOf(record: RecordFile, field: LinkField): string[] {
  const value = record.json[field];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Check (10): every `amends[]` target is a Change in `MERGED` or `ARCHIVED`,
 * every `supersedes[]` target one in `ABANDONED`.
 */
export function checkLinkTargets(records: ReadonlyMap<string, RecordFile>): CliError[] {
  const errors: CliError[] = [];
  for (const record of records.values()) {
    for (const field of LINK_FIELDS) {
      const value = record.json[field];
      if (!Array.isArray(value)) continue;
      value.forEach((target, i) => {
        if (typeof target !== "string") return;
        const problem = linkTargetProblem(field, target, records);
        if (problem === null) return;
        errors.push({ code: "LINK_TARGET_INVALID", message: problem, path: `${record.path}#/${field}/${i}` });
      });
    }
  }
  return errors;
}

/**
 * `amended_by[]` and `superseded_by[]` of one Change: the records that name it
 * in `amends` / `supersedes`, sorted. Computed, never stored (ADR-0021 point 5).
 */
export function backLinks(
  change: string,
  records: ReadonlyMap<string, RecordFile>
): { amended_by: string[]; superseded_by: string[] } {
  const amendedBy: string[] = [];
  const supersededBy: string[] = [];
  for (const record of records.values()) {
    if (targetsOf(record, "amends").includes(change)) amendedBy.push(record.change);
    if (targetsOf(record, "supersedes").includes(change)) supersededBy.push(record.change);
  }
  const sort = (list: string[]): string[] => [...new Set(list)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { amended_by: sort(amendedBy), superseded_by: sort(supersededBy) };
}
