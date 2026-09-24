/**
 * Check (13) of `validate`: dangling references to requirements and scenarios
 * (REQ-KRN-021, ADR-0019 point 1d, design §11).
 *
 * Every `REQ-AREA-NNN` / `SCN-AREA-NNN` token in the `tasks.md` of an active
 * Change (`openspec/changes/<change>/tasks.md`, archive excluded) and in the
 * files under `paths.tests` of `warrant.json` (only when it is set) must be
 * declared by an id comment somewhere in `openspec/specs/**` or
 * `openspec/changes/**`, archive included. The declarations are the ones check
 * (5) has already scanned; nothing here runs `openspec`.
 *
 * Test files are read as text: a file over 1 MiB or containing a NUL byte is
 * skipped as not a source file.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { CliError } from "../errors.js";
import { reportPath, walkFiles } from "../fs.js";
import type { FoundId } from "../ids/scan.js";

/** Largest test file read by check (13). */
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

/** `tasks.md` of every active Change: `openspec/changes/<change>/tasks.md`, archive excluded. */
function activeTaskFiles(root: string): string[] {
  const changesDir = path.join(root, "openspec", "changes");
  let entries: string[];
  try {
    entries = readdirSync(changesDir).sort();
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    if (name === "archive") continue;
    const tasks = path.join(changesDir, name, "tasks.md");
    try {
      if (statSync(tasks).isFile()) out.push(tasks);
    } catch {
      // no tasks.md in this change
    }
  }
  return out;
}

/** Files under `paths.tests`, or none when it is not set. */
function testFiles(root: string, config: Record<string, unknown>): string[] {
  const paths = config["paths"];
  const tests =
    typeof paths === "object" && paths !== null && !Array.isArray(paths)
      ? (paths as Record<string, unknown>)["tests"]
      : undefined;
  if (typeof tests !== "string" || tests.length === 0) return [];
  const absolute = path.join(root, ...tests.split("/"));
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    return [];
  }
  if (stat.isFile()) return [absolute];
  return stat.isDirectory() ? walkFiles(absolute) : [];
}

/** Text of a test file, or undefined for a large or binary one. */
function readText(absolute: string): string | undefined {
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

/**
 * Check (13). `declared` are the ids scanned by check (5); only declarations
 * in `openspec/**` count (records carry UNK/ASM ids, never REQ/SCN).
 */
export function checkDangling(root: string, config: Record<string, unknown>, declared: readonly FoundId[]): CliError[] {
  const known = new Set(declared.filter((f) => f.file.startsWith("openspec/")).map((f) => f.id));
  const errors: CliError[] = [];
  const tasks = activeTaskFiles(root);
  const files = [...new Set([...tasks, ...testFiles(root, config)])];
  for (const absolute of files) {
    // A tasks.md is always read; only test files may be skipped as not text.
    const text = tasks.includes(absolute) ? readFileSync(absolute, "utf8") : readText(absolute);
    if (text === undefined) continue;
    const reported = reportPath(absolute, root);
    for (const ref of findReferences(text)) {
      if (known.has(ref.id)) continue;
      errors.push({
        code: "ID_DANGLING",
        message: `${ref.id} (line ${ref.line}) is not declared in openspec/specs/** or openspec/changes/** (ADR-0019 point 1d)`,
        path: reported
      });
    }
  }
  return errors;
}
