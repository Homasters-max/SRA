/**
 * Where a Change lives under `openspec/changes/` (A-8).
 *
 * One place answers "which directory is this Change": `init change` (a name
 * conflict), `status` (a stale record), `transition`, `archive` and the
 * immutable-id check all ask it.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { posix, walkFiles } from "../fs.js";

/**
 * Directory of a Change under `openspec/changes/`, as a POSIX path relative to
 * the project root, or null when there is none.
 *
 * `active` is `openspec/changes/<name>`; `archive` is the archived copy, whose
 * directory is `<YYYY-MM-DD>-<name>` (or plain `<name>` when it was moved by
 * hand).
 */
export interface ChangeDirLocation {
  where: "active" | "archive";
  path: string;
}

const ARCHIVE_DATE_RE = /^\d{4}-\d{2}-\d{2}-/;

export function findChangeDir(root: string, name: string): ChangeDirLocation | null {
  const active = path.join(root, "openspec", "changes", name);
  if (existsSync(active)) return { where: "active", path: `openspec/changes/${name}` };
  const archive = path.join(root, "openspec", "changes", "archive");
  let entries: string[];
  try {
    entries = readdirSync(archive, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return null;
  }
  // Exactly `<name>` or `<YYYY-MM-DD>-<name>`: a bare suffix match would make
  // `auth` collide with an archived `add-auth`.
  const found = entries.find((entry) => entry === name || (ARCHIVE_DATE_RE.test(entry) && entry.slice(11) === name));
  return found === undefined ? null : { where: "archive", path: `openspec/changes/archive/${found}` };
}

/**
 * What `openspec archive <name>` changes (REQ-KRN-034, `archive --dry-run`):
 * the active directory moves to `openspec/changes/archive/<today>-<name>`, and
 * every delta spec `specs/<capability>/spec.md` of the Change is merged into
 * `openspec/specs/<capability>/spec.md`.
 */
export function archivePlan(root: string, name: string, today: string): { archive: string; targets: string[] } {
  const active = `openspec/changes/${name}`;
  const archive = `openspec/changes/archive/${today}-${name}`;
  const specsDir = path.join(root, "openspec", "changes", name, "specs");
  const specs = walkFiles(specsDir)
    .filter((file) => path.basename(file) === "spec.md")
    .map((file) => `openspec/specs/${posix(path.relative(specsDir, file))}`);
  return { archive, targets: [active, archive, ...specs] };
}
