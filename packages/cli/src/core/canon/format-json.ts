/**
 * The single JSON writer of the CLI (design D-3).
 *
 * Every command that produces a JSON file goes through {@link writeJsonFile}
 * so the bytes on disk are the ones `warrant fmt --check` and check (7) of
 * `validate` expect: two-space indent, LF, one trailing newline, UTF-8 without
 * BOM, keys in canonical order.
 */
import { writeFileSync } from "node:fs";

import { getSchema, type Json } from "../schemas/loader.js";
import { parseSchemaUri } from "../schemas/registry.js";
import { orderKeys, type JsonObject } from "./order-keys.js";

/**
 * Serialises a value in the canonical style.
 *
 * `JSON.stringify` never emits CR, so the result is LF-only by construction;
 * the trailing newline makes the files line-oriented for diffs and POSIX tools.
 */
export function formatJson(value: Json): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** The schema a document declares, or `undefined` when it names none we know. */
export function schemaFor(json: Json): JsonObject | undefined {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return undefined;
  const ref = parseSchemaUri((json as JsonObject)["$schema"]);
  if (ref === null) return undefined;
  return getSchema(ref.name, ref.major);
}

/** Canonical text of a document, plus whether its `$schema` was recognised. */
export interface CanonicalText {
  text: string;
  /** False when the file has no `$schema` or names one the CLI does not ship: keys are then alphabetical only. */
  schemaKnown: boolean;
}

/**
 * Canonical bytes of a parsed document, as `fmt` would write them.
 * Callers warn on `schemaKnown === false` (REQ-KRN-022).
 */
export function canonicalText(json: Json): CanonicalText {
  const schema = schemaFor(json);
  return { text: formatJson(orderKeys(json, schema)), schemaKnown: schema !== undefined };
}

/**
 * Writes a JSON value to disk in canonical form.
 * `schema` may be passed when the caller already has it; otherwise it is taken
 * from the document's own `$schema`.
 */
export function writeJsonFile(absolutePath: string, value: Json, schema?: JsonObject | undefined): void {
  const chosen = schema ?? schemaFor(value);
  // `utf8` in Node never writes a BOM, which is what the contract requires.
  writeFileSync(absolutePath, formatJson(orderKeys(value, chosen)), "utf8");
}
