/**
 * Check (9) of `validate`: a stable id declared in `HEAD` is neither changed
 * nor removed in the working tree (REQ-KRN-021, D-18, ADR-0019 point 1c,
 * design §14).
 *
 * Scope: every Markdown file of `openspec/specs/**`, and of
 * `openspec/changes/<change>/**` while the record of `<change>` is in
 * `APPROVED` or later. Before `APPROVED` renumbering and removal are
 * legitimate. `ABANDONED` is out of scope: abandoning deletes the change
 * directory by design (design §10), and that deletion is not an edit of ids.
 *
 * The comparison is per file: the ids `scanMarkdown` finds in the `HEAD`
 * version must all be found in the working-tree version. A file absent from
 * `HEAD` is new and skipped; a file deleted from the tree has lost all its ids.
 * A change directory moved to `openspec/changes/archive/` is compared with its
 * archived copy — archiving moves ids, it does not remove them.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import spawnCjs from "cross-spawn";

import type { CliError } from "../errors.js";
import { findChangeDir } from "../init/scaffold.js";
import { stateOf, type RecordFile } from "../record/read.js";
import { scanMarkdown } from "./scan.js";

const spawn = spawnCjs as unknown as typeof import("cross-spawn");

/** Record states from which the ids of a change are frozen (02 section 2, 04 section 2). */
export const IDS_FROZEN_FROM: ReadonlySet<string> = new Set([
  "APPROVED",
  "IMPLEMENTING",
  "VERIFYING",
  "MERGED",
  "ARCHIVED"
]);

interface GitRun {
  ok: boolean;
  stdout: Buffer;
}

function git(args: string[], cwd: string, input?: string): GitRun {
  const proc = spawn.sync("git", args, input === undefined ? { cwd } : { cwd, input });
  return { ok: proc.error == null && proc.status === 0, stdout: proc.stdout ?? Buffer.alloc(0) };
}

/**
 * Contents of `HEAD:<path>` for many paths in one `git cat-file --batch` call.
 * Output per object: `<oid> blob <size>\n<bytes>\n`, or `<name> missing\n`.
 */
function headContents(root: string, gitPaths: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (gitPaths.length === 0) return out;
  const run = git(["cat-file", "--batch"], root, gitPaths.map((p) => `HEAD:${p}`).join("\n") + "\n");
  if (!run.ok) return out;
  const buf = run.stdout;
  let offset = 0;
  for (const p of gitPaths) {
    const eol = buf.indexOf(0x0a, offset);
    if (eol === -1) break;
    const header = buf.subarray(offset, eol).toString("utf8");
    offset = eol + 1;
    const m = /^\S+ (\S+) (\d+)$/.exec(header);
    if (m === null) continue; // `missing`
    const size = Number.parseInt(m[2] as string, 10);
    if (m[1] === "blob") out.set(p, buf.subarray(offset, offset + size).toString("utf8"));
    offset += size + 1;
  }
  return out;
}

export interface ImmutableCheck {
  errors: CliError[];
  /** Why the check could not run (no git, no commit); undefined when it ran. */
  skipped: string | undefined;
}

export function checkImmutableIds(root: string, records: ReadonlyMap<string, RecordFile>): ImmutableCheck {
  const prefixRun = git(["rev-parse", "--show-prefix"], root);
  if (!prefixRun.ok) return { errors: [], skipped: "not a git work tree" };
  if (!git(["rev-parse", "--verify", "--quiet", "HEAD"], root).ok) {
    return { errors: [], skipped: "the repository has no HEAD commit" };
  }
  const prefix = prefixRun.stdout.toString("utf8").trim();

  const listing = git(["ls-tree", "-r", "-z", "--name-only", "--full-name", "HEAD", "--", "openspec/specs", "openspec/changes"], root);
  if (!listing.ok) return { errors: [], skipped: "`git ls-tree HEAD` failed" };

  /** Project-relative path in HEAD → project-relative path of its working-tree counterpart. */
  const counterpart = new Map<string, string>();
  for (const full of listing.stdout.toString("utf8").split("\0")) {
    if (full === "" || !full.startsWith(prefix) || !full.toLowerCase().endsWith(".md")) continue;
    const rel = full.slice(prefix.length);
    if (rel.startsWith("openspec/specs/")) {
      counterpart.set(rel, rel);
      continue;
    }
    const m = /^openspec\/changes\/([^/]+)\/(.+)$/.exec(rel);
    if (m === null || m[1] === "archive") continue;
    const change = m[1] as string;
    if (!IDS_FROZEN_FROM.has(stateOf(records.get(change)) ?? "")) continue;
    let target = rel;
    if (!existsSync(path.join(root, "openspec", "changes", change))) {
      const location = findChangeDir(root, change);
      if (location?.where === "archive") target = `${location.path}/${m[2] as string}`;
    }
    counterpart.set(rel, target);
  }

  const heads = headContents(root, [...counterpart.keys()].map((rel) => `${prefix}${rel}`));
  const errors: CliError[] = [];
  for (const [rel, target] of counterpart) {
    const before = heads.get(`${prefix}${rel}`);
    if (before === undefined) continue;
    const absolute = path.join(root, ...target.split("/"));
    const after = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
    const now = new Set(scanMarkdown(after, target).map((f) => f.id));
    const gone = [...new Set(scanMarkdown(before, rel).map((f) => f.id))].filter((id) => !now.has(id)).sort();
    for (const id of gone) {
      errors.push({
        code: "ID_IMMUTABLE",
        message: `${id} is declared in HEAD:${rel} and is changed or removed in the working tree; stable ids are immutable (ADR-0019 point 1c)`,
        path: target
      });
    }
  }
  return { errors, skipped: undefined };
}
