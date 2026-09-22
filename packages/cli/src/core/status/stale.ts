/**
 * Derived signals of `warrant status`: where the record disagrees with the
 * file system (REQ-KRN-027, [04 section 9](../../../../../docs/04-lifecycle.md)).
 *
 * The record is the act of a transition; these checks say whether the act still
 * matches reality. They never fail the command — a stale entry is a report, not
 * an error — so this module is a pure function over an already-located
 * directory and the recorded state.
 */
import type { ChangeDirLocation } from "../init/scaffold.js";

/** Codes of `data.stale[]`. They are not `errors[].code`: staleness is a report, not a failure. */
export const STALE_CODES = ["CHANGE_DIR_MISSING", "ARCHIVED_WITHOUT_TRANSITION"] as const;

export type StaleCode = (typeof STALE_CODES)[number];

/** One entry of `stale[]`; `path` is the directory that was looked for or found. */
export interface StaleEntry {
  code: StaleCode;
  message: string;
  path: string;
}

export function computeStale(
  change: string,
  location: ChangeDirLocation | null,
  changeState: string
): StaleEntry[] {
  if (location === null) {
    return [
      {
        code: "CHANGE_DIR_MISSING",
        message: `record exists but there is no change directory and no archived copy of "${change}"`,
        path: `openspec/changes/${change}`
      }
    ];
  }
  if (location.where === "archive" && changeState !== "ARCHIVED") {
    return [
      {
        code: "ARCHIVED_WITHOUT_TRANSITION",
        message: `change directory is archived but the record is in ${changeState}, not ARCHIVED`,
        path: location.path
      }
    ];
  }
  return [];
}
