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

import { testFiles, type WarrantConfig } from "../config.js";
import type { CliError } from "../errors.js";
import { reportPath } from "../fs.js";
import { findReferences, readSourceText } from "../ids/references.js";
import type { FoundId } from "../ids/scan.js";

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

/**
 * Check (13). `declared` are the ids scanned by check (5); only declarations
 * in `openspec/**` count (records carry UNK/ASM ids, never REQ/SCN). `only`
 * (absolute paths, under `validate --files`) replaces the walk of `tasks.md`
 * and `paths.tests`.
 */
export function checkDangling(
  root: string,
  config: WarrantConfig,
  declared: readonly FoundId[],
  only?: readonly string[]
): CliError[] {
  const known = new Set(declared.filter((f) => f.file.startsWith("openspec/")).map((f) => f.id));
  const errors: CliError[] = [];
  const tasks = activeTaskFiles(root);
  const files = only ?? [...new Set([...tasks, ...testFiles(root, config)])];
  for (const absolute of files) {
    // A tasks.md is always read; only test files may be skipped as not text.
    const text = tasks.includes(absolute) ? readFileSync(absolute, "utf8") : readSourceText(absolute);
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
