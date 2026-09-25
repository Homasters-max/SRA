/**
 * Which files the canonical form applies to, and how to check them.
 *
 * Shared by `warrant fmt` (REQ-KRN-022) and check (7) of `warrant validate`
 * (REQ-KRN-021) so the two can never disagree about the file set.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { cliError, FMT_HINT, type CliError } from "../errors.js";
import { reportPath, walkFiles } from "../fs.js";
import { canonicalText } from "./format-json.js";

export const WARRANT_DIR = ".warrant";

/**
 * `.warrant/schemas/` holds copies of the kernel JSON-Schema files. They are
 * JSON Schema documents, not WARRANT documents, and their key order is that of
 * the shipped originals, which `sync` verifies by hash — so the canonical form
 * does not apply to them (decision I-4).
 */
export const SCHEMA_COPIES_PREFIX = `${WARRANT_DIR}/schemas/`;

/**
 * Raw check output `.warrant/evidence/**\/raw/**` (`{out}` of a check) is not
 * part of any record: it is whatever the tool wrote, JSON without `$schema`
 * included, so checks (1), (6) and (7) of `validate` and `fmt` leave it alone
 * (I-76, REQ-KRN-021, REQ-VER-001).
 */
export function isRawEvidencePath(reported: string): boolean {
  return /^\.warrant\/evidence\/(?:[^/]+\/)*raw\//.test(reported);
}

function isJson(absolute: string): boolean {
  return absolute.toLowerCase().endsWith(".json");
}

/** Every `*.json` under `.warrant/**` that the canonical form governs, as absolute paths. */
export function canonicalTargets(root: string): string[] {
  return walkFiles(path.join(root, WARRANT_DIR)).filter((absolute) => {
    if (!isJson(absolute)) return false;
    const reported = reportPath(absolute, root);
    return !reported.startsWith(SCHEMA_COPIES_PREFIX) && !isRawEvidencePath(reported);
  });
}

/** Outcome of comparing one file with its canonical form. */
export type CanonicalCheck =
  | { status: "canonical"; schemaKnown: boolean }
  | { status: "differs"; text: string; schemaKnown: boolean }
  | { status: "unreadable"; message: string };

/** Compares the bytes of one file with the canonical text of its content. */
export function checkFile(absolute: string): CanonicalCheck {
  let current: string;
  try {
    current = readFileSync(absolute, "utf8");
  } catch (cause) {
    return { status: "unreadable", message: `cannot read file: ${(cause as Error).message}` };
  }
  let json: unknown;
  try {
    json = JSON.parse(current);
  } catch (cause) {
    return { status: "unreadable", message: `invalid JSON: ${(cause as Error).message}` };
  }
  const canonical = canonicalText(json);
  if (canonical.text === current) return { status: "canonical", schemaKnown: canonical.schemaKnown };
  return { status: "differs", text: canonical.text, schemaKnown: canonical.schemaKnown };
}

/**
 * Check (7) of `validate`: every `*.json` under `.warrant/**` is canonical.
 *
 * Unreadable or malformed files are left to check (1), which already reports
 * them; reporting them twice would only duplicate findings.
 */
export function checkCanonical(root: string): CliError[] {
  const errors: CliError[] = [];
  for (const absolute of canonicalTargets(root)) {
    const result = checkFile(absolute);
    if (result.status !== "differs") continue;
    errors.push(cliError("NOT_CANONICAL", "file is not in canonical form", { path: reportPath(absolute, root), hint: FMT_HINT }));
  }
  return errors;
}
