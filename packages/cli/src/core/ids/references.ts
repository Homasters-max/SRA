/**
 * References to requirements and scenarios in text: the `REQ-AREA-NNN` /
 * `SCN-AREA-NNN` tokens of a `tasks.md` or a test file. Shared by check (13)
 * of `validate` (dangling references, REQ-KRN-021) and `warrant analyze`
 * (REQ-VER-010), so both read the same tokens.
 */
import { readFileSync, statSync } from "node:fs";

/** Largest test file read as text. */
export const MAX_TEXT_BYTES = 1024 * 1024;

/**
 * A reference token. Ids contain `-`, so the boundaries are lookarounds over
 * the id alphabet rather than `\b` (same rule as `warrant id renumber`).
 */
const REFERENCE_RE = /(?<![A-Za-z0-9-])(?:REQ|SCN)-[A-Z]{2,5}-\d{3}(?![A-Za-z0-9-])/g;

export interface Reference {
  id: string;
  /** 1-based line number. */
  line: number;
}

/** REQ/SCN references in one text, in order of appearance. */
export function findReferences(text: string): Reference[] {
  const out: Reference[] = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(REFERENCE_RE)) out.push({ id: m[0], line: i + 1 });
  });
  return out;
}

/**
 * Text of a source file, or undefined for one that is not a source file: over
 * {@link MAX_TEXT_BYTES}, containing a NUL byte, or unreadable.
 */
export function readSourceText(absolute: string): string | undefined {
  let buffer: Buffer;
  try {
    if (statSync(absolute).size > MAX_TEXT_BYTES) return undefined;
    buffer = readFileSync(absolute);
  } catch {
    return undefined;
  }
  if (buffer.includes(0)) return undefined;
  return buffer.toString("utf8");
}
