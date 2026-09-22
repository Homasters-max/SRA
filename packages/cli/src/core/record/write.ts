/**
 * Writing the Change record: the transition matrix of 04 section 2, the
 * freeze of `ARCHIVED` / `ABANDONED` and appending one transition
 * (REQ-VER-007, design §10, ADR-0021).
 *
 * The matrix is pure data; {@link appendTransition} is the one place a
 * transition reaches the disk, always through `writeJsonFile`, and never
 * without the record validating against `warrant://change-record/1` first.
 */
import path from "node:path";

import { writeJsonFile } from "../canon/format-json.js";
import { WarrantError, type CliError } from "../errors.js";
import type { Json } from "../schemas/loader.js";
import { validateFile } from "../schemas/semantic.js";
import type { ChangeRecord } from "./read.js";

/** The forward chain of 04 section 2. */
export const FORWARD_CHAIN = ["PROPOSED", "SPECIFIED", "APPROVED", "IMPLEMENTING", "VERIFYING", "MERGED", "ARCHIVED"] as const;

/** Every `change_state` (02 section 2). */
export const CHANGE_STATES = [...FORWARD_CHAIN, "ABANDONED"] as const;

export type ChangeState = (typeof CHANGE_STATES)[number];

/** States after which the record never changes again (ADR-0021). */
export const FROZEN_STATES: readonly ChangeState[] = ["ARCHIVED", "ABANDONED"];

/** The two backward moves 04 section 2 allows; they carry no gates. */
export const BACKWARD_TRANSITIONS: readonly string[] = ["VERIFYING->IMPLEMENTING", "IMPLEMENTING->SPECIFIED"];

/** States from which `ABANDONED` may be entered: any before `MERGED`. */
export const ABANDONABLE: readonly ChangeState[] = ["PROPOSED", "SPECIFIED", "APPROVED", "IMPLEMENTING", "VERIFYING"];

export type TransitionKind = "forward" | "backward" | "abandon";

export function isChangeState(value: string): value is ChangeState {
  return (CHANGE_STATES as readonly string[]).includes(value);
}

export function isFrozen(state: string): boolean {
  return (FROZEN_STATES as readonly string[]).includes(state);
}

/**
 * How `from -> to` is allowed by 04 section 2, or null when it is not:
 * forward only to the next state of the chain, backward only the two listed
 * moves, `ABANDONED` from any state before `MERGED`. Nothing leaves a frozen
 * state and nothing re-enters `PROPOSED`.
 */
export function transitionKind(from: string, to: string): TransitionKind | null {
  if (isFrozen(from)) return null;
  if (to === "ABANDONED") return (ABANDONABLE as readonly string[]).includes(from) ? "abandon" : null;
  const index = (FORWARD_CHAIN as readonly string[]).indexOf(from);
  if (index >= 0 && FORWARD_CHAIN[index + 1] === to) return "forward";
  if (BACKWARD_TRANSITIONS.includes(`${from}->${to}`)) return "backward";
  return null;
}

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
export function appendTransition(root: string, change: string, record: ChangeRecord, entry: TransitionEntry): ChangeRecord {
  assertNotFrozen(record, change);
  const updated = withTransition(record, entry);
  const checked = validateFile(updated, recordPath(change));
  if (!checked.ok) {
    const first = checked.errors[0] as CliError;
    throw new WarrantError("INTERNAL", `the record of "${change}" would not match its schema: ${first.message}`, {
      path: first.path ?? recordPath(change)
    });
  }
  writeJsonFile(path.join(root, ".warrant", "changes", `${change}.json`), updated as Json);
  return updated;
}
