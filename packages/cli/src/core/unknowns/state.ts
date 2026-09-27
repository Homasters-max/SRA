/**
 * What the `unknowns[]` of a Change record say (02 section 1, REQ-KRN-011):
 * which UNKNOWNs are open and which blocking ones are closed without the
 * maintainer's decision. Pure: no disk.
 *
 * Owner of the question "is this UNKNOWN closed" (ADR-0030 п. 1, R2): the gate
 * `blocking-unknowns-resolved`, the controller inputs and `warrant unknown`
 * ask it here, moved from `core/gates/l0/blocking-unknowns-resolved.ts`.
 */
import { isPlainObject } from "../json.js";

/** `resolved_as` of an UNKNOWN element (REQ-KRN-011): the kind of the answer. */
export const RESOLUTION_KINDS = ["decision", "fact", "assumption"] as const;

export type ResolutionKind = (typeof RESOLUTION_KINDS)[number];

export function isResolutionKind(value: string): value is ResolutionKind {
  return (RESOLUTION_KINDS as readonly string[]).includes(value);
}

/** `unknowns[]` of a record, as stored; `[]` without one. */
export function unknownsOf(record: Record<string, unknown>): unknown[] {
  const list = record["unknowns"];
  return Array.isArray(list) ? list : [];
}

/** Whether an UNKNOWN element is closed: its `resolution` is non-empty (REQ-KRN-035). */
export function isClosed(entry: Record<string, unknown>): boolean {
  const resolution = entry["resolution"];
  return typeof resolution === "string" && resolution.trim() !== "";
}

function idOf(entry: Record<string, unknown>): string {
  return typeof entry["id"] === "string" ? entry["id"] : "(no id)";
}

/** Ids of the open UNKNOWNs of a record, blocking or not, in record order. */
export function openUnknowns(unknowns: readonly unknown[]): string[] {
  return unknowns.filter((e): e is Record<string, unknown> => isPlainObject(e) && !isClosed(e)).map(idOf);
}

/** Ids of the open blocking UNKNOWNs of a record, in record order. */
export function openBlockingUnknowns(unknowns: readonly unknown[]): string[] {
  return unknowns
    .filter((e): e is Record<string, unknown> => isPlainObject(e) && e["blocking"] === true && !isClosed(e))
    .map(idOf);
}

/**
 * Ids of the blocking UNKNOWNs closed by anything but the maintainer's
 * decision with a ref: a non-empty `resolution` without `resolved_as:
 * "decision"` and `ref` (REQ-VER-004, SCN-VER-110). Non-blocking ones are not
 * judged.
 */
export function decisionsWithoutRef(unknowns: readonly unknown[]): string[] {
  return unknowns
    .filter((e): e is Record<string, unknown> => isPlainObject(e) && e["blocking"] === true && isClosed(e))
    .filter((e) => e["resolved_as"] !== "decision" || typeof e["ref"] !== "string" || e["ref"] === "")
    .map(idOf);
}
