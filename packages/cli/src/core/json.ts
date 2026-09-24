/**
 * Shared guards for untyped JSON (ADR-0030 point 4, A-5): the one owner of
 * `isPlainObject` and `strings`. A local copy of either is an error of
 * `test/unit/meta/architecture.test.ts` (`helper` rule).
 */

/** A non-null, non-array object (JSON object after `JSON.parse`). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The string members of an array, in order; anything else yields `[]`. */
export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
