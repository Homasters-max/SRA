/**
 * Writing the Change record: the freeze of `ARCHIVED` / `ABANDONED` and
 * appending one transition (REQ-VER-007, design §10, ADR-0021); the
 * transition matrix of 04 section 2 is data in `lifecycle.ts`.
 *
 * {@link appendTransition} is the one place a
 * transition reaches the disk, always through `ctx.writes` and `writeJsonFile`,
 * and never without the record validating against `warrant://change-record/1` first.
 */
import path from "node:path";

import { writeJsonFile } from "../canon/format-json.js";
import type { Ctx } from "../ctx.js";
import { WarrantError, type CliError } from "../errors.js";
import type { Json } from "../schemas/loader.js";
import { validateFile } from "../schemas/semantic.js";
import { isFrozen } from "./lifecycle.js";
import type { ChangeRecord } from "./read.js";

/** `change_state` of a record as stored. */
export function stateOfRecord(record: ChangeRecord): string {
  return String(record["change_state"]);
}

/** Throws `RECORD_FROZEN` (exit 3) when the record is `ARCHIVED` or `ABANDONED`. */
export function assertNotFrozen(record: ChangeRecord, change: string): void {
  const state = stateOfRecord(record);
  if (isFrozen(state)) {
    throw new WarrantError("RECORD_FROZEN", `record of "${change}" is ${state} and can no longer change (ADR-0021)`, {
      path: recordPath(change)
    });
  }
}

/** POSIX path of the record relative to the project root. */
export function recordPath(change: string): string {
  return `.warrant/changes/${change}.json`;
}

/** One entry of `transitions[]` (04 section 9, REQ-KRN-011). */
export interface TransitionEntry {
  to: string;
  /** RFC 3339. */
  at: string;
  by: string;
  effective_policy_hash?: string;
  gates?: Record<string, string>;
  evidence?: string[];
  ref?: string;
}

/** The record with one more transition and `change_state` set to its target; nothing is written. */
export function withTransition(record: ChangeRecord, entry: TransitionEntry): ChangeRecord {
  const previous = Array.isArray(record["transitions"]) ? record["transitions"] : [];
  const clean: Record<string, unknown> = { to: entry.to, at: entry.at, by: entry.by };
  if (entry.effective_policy_hash !== undefined) clean["effective_policy_hash"] = entry.effective_policy_hash;
  if (entry.gates !== undefined) clean["gates"] = entry.gates;
  if (entry.evidence !== undefined) clean["evidence"] = entry.evidence;
  if (entry.ref !== undefined) clean["ref"] = entry.ref;
  return { ...record, change_state: entry.to, transitions: [...previous, clean] };
}

/**
 * Appends `entry` to the record of `change` and writes it. The matrix is the
 * caller's to check (the command reports it before evaluating gates); here
 * only the freeze is re-asserted, so no path can write past `ARCHIVED` or
 * `ABANDONED`, and the result must match the schema.
 */
export function appendTransition(
  ctx: Pick<Ctx, "root" | "writes">,
  change: string,
  record: ChangeRecord,
  entry: TransitionEntry
): ChangeRecord {
  assertNotFrozen(record, change);
  return writeRecord(ctx, change, record, withTransition(record, entry));
}

/**
 * Writes `updated` as the record of `change`, whose stored version is
 * `current`: never past `ARCHIVED` / `ABANDONED` (checked on `current`) and
 * never a record that does not match `warrant://change-record/1`. The one
 * writer of records other than `classify` (`transition`, `link`).
 */
export function writeRecord(
  ctx: Pick<Ctx, "root" | "writes">,
  change: string,
  current: ChangeRecord,
  updated: ChangeRecord
): ChangeRecord {
  assertNotFrozen(current, change);
  const checked = validateFile(updated, recordPath(change));
  if (!checked.ok) {
    const first = checked.errors[0] as CliError;
    throw new WarrantError("INTERNAL", `the record of "${change}" would not match its schema: ${first.message}`, {
      path: first.path ?? recordPath(change)
    });
  }
  ctx.writes.write(recordPath(change), () => writeJsonFile(path.join(ctx.root, ".warrant", "changes", `${change}.json`), updated as Json));
  return updated;
}
