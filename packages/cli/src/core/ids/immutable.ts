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
 *
 * I-77 (design §11): `openspec archive` applies a delta's
 * `## REMOVED Requirements` to the main spec, so in the archive commit the ids
 * of a removed requirement vanish from `openspec/specs/**`. They are exempt
 * when the archive directory whose delta removes that requirement (by its
 * heading) is new in the working tree — absent from `HEAD`. The exempt ids are
 * those of the requirement block in the `HEAD` version of the main spec: the
 * requirement's own id and the ids of its scenarios. Nothing else is exempt.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { Ctx } from "../ctx.js";
import type { CliError } from "../errors.js";
import { toProjectPaths } from "../git/paths.js";
import { findChangeDir } from "../openspec/changes.js";
import { IDS_FROZEN_FROM } from "../record/lifecycle.js";
import { stateOf, type RecordFile } from "../record/read.js";
import { scanMarkdown } from "./scan.js";

const ARCHIVE_REL = "openspec/changes/archive";

/** A requirement heading, compared whitespace-insensitively (I-77). */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

const REQUIREMENT_HEADING_RE = /^###\s+Requirement:\s*(.*?)\s*$/;

/** Names of the requirements listed under `## REMOVED Requirements` of one delta spec. */
export function removedRequirementNames(text: string): string[] {
  const names: string[] = [];
  let inRemoved = false;
  for (const line of text.split(/\r?\n/)) {
    const section = /^##\s+(.*?)\s*$/.exec(line);
    if (section !== null && !line.startsWith("###")) {
      inRemoved = normalizeName(section[1] as string) === "REMOVED Requirements";
      continue;
    }
    if (!inRemoved) continue;
    const heading = REQUIREMENT_HEADING_RE.exec(line);
    if (heading !== null) names.push(normalizeName(heading[1] as string));
  }
  return names;
}

/**
 * Ids declared inside the block of each named requirement of a main spec: from
 * its `### Requirement:` heading up to the next heading of level 1–3, so the
 * ids of its `#### Scenario:` blocks are included.
 */
export function requirementBlockIds(text: string, file: string, names: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>();
  const blocks: string[][] = [];
  let current: string[] | undefined;
  for (const line of text.split("\n")) {
    if (/^#{1,3}\s/.test(line)) {
      current = undefined;
      const heading = REQUIREMENT_HEADING_RE.exec(line.replace(/\r$/, ""));
      if (heading !== null && names.has(normalizeName(heading[1] as string))) {
        current = [];
        blocks.push(current);
      }
    }
    current?.push(line);
  }
  for (const block of blocks) {
    for (const found of scanMarkdown(block.join("\n"), file)) ids.add(found.id);
  }
  return ids;
}

/** Delta spec files `specs/<cap>/spec.md` under one archive directory, keyed by `<cap>`. */
function deltaSpecs(archiveDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const specsDir = path.join(archiveDir, "specs");
  const visit = (dir: string, rel: string[]): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const absolute = path.join(dir, name);
      let stat;
      try {
        stat = statSync(absolute);
      } catch {
        continue;
      }
      if (stat.isDirectory()) visit(absolute, [...rel, name]);
      else if (stat.isFile() && name === "spec.md" && rel.length > 0) out.set(rel.join("/"), absolute);
    }
  };
  visit(specsDir, []);
  return out;
}

/**
 * Main spec path → requirement names removed by the deltas of archive
 * directories present in the working tree but not in `HEAD` (I-77).
 */
function removedByNewArchives(root: string, headArchiveDirs: ReadonlySet<string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  let dirs: string[];
  try {
    dirs = readdirSync(path.join(root, ...ARCHIVE_REL.split("/"))).sort();
  } catch {
    return out;
  }
  for (const dir of dirs) {
    if (headArchiveDirs.has(dir)) continue;
    const absolute = path.join(root, ...ARCHIVE_REL.split("/"), dir);
    try {
      if (!statSync(absolute).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const [cap, file] of deltaSpecs(absolute)) {
      const names = removedRequirementNames(readFileSync(file, "utf8"));
      if (names.length === 0) continue;
      const main = `openspec/specs/${cap}/spec.md`;
      const set = out.get(main) ?? new Set<string>();
      for (const name of names) set.add(name);
      out.set(main, set);
    }
  }
  return out;
}

export interface ImmutableCheck {
  errors: CliError[];
  /** Why the check could not run (no git, no commit); undefined when it ran. */
  skipped: string | undefined;
}

export async function checkImmutableIds(ctx: Ctx, records: ReadonlyMap<string, RecordFile>): Promise<ImmutableCheck> {
  const { root } = ctx;
  const project = await ctx.git.prefix();
  if (project === null) return { errors: [], skipped: "not a git work tree" };
  if ((await ctx.git.head()) === null) {
    return { errors: [], skipped: "the repository has no HEAD commit" };
  }
  /** Repository path of a project path, as `git show` expects it. */
  const repoPath = (rel: string): string => (project === "" ? rel : `${project}/${rel}`);

  const listing = await ctx.git.files("HEAD", ["openspec/specs", "openspec/changes"]);
  if (listing === null) return { errors: [], skipped: "`git ls-tree HEAD` failed" };

  /** Project-relative path in HEAD → project-relative path of its working-tree counterpart. */
  const counterpart = new Map<string, string>();
  /** Names of the archive directories committed in `HEAD` (I-77). */
  const headArchiveDirs = new Set<string>();
  for (const rel of toProjectPaths(project, listing)) {
    const archived = /^openspec\/changes\/archive\/([^/]+)\//.exec(rel);
    if (archived !== null) headArchiveDirs.add(archived[1] as string);
    if (!rel.toLowerCase().endsWith(".md")) continue;
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

  const heads = await ctx.git.contents("HEAD", [...counterpart.keys()].map(repoPath));
  const removed = removedByNewArchives(root, headArchiveDirs);
  const errors: CliError[] = [];
  for (const [rel, target] of counterpart) {
    const before = heads.get(repoPath(rel));
    if (before !== undefined) errors.push(...goneIds(root, rel, target, before, removed));
  }
  return { errors, skipped: undefined };
}

/** `ID_IMMUTABLE` for each id of `before` (`HEAD:<rel>`) missing from the working-tree file `target`. */
function goneIds(
  root: string,
  rel: string,
  target: string,
  before: string,
  removed: ReadonlyMap<string, Set<string>>
): CliError[] {
  const absolute = path.join(root, ...target.split("/"));
  const after = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
  const now = new Set(scanMarkdown(after, target).map((f) => f.id));
  const names = removed.get(rel);
  const exempt = names === undefined ? new Set<string>() : requirementBlockIds(before, rel, names);
  return [...new Set(scanMarkdown(before, rel).map((f) => f.id))]
    .filter((id) => !now.has(id) && !exempt.has(id))
    .sort()
    .map((id) => ({
      code: "ID_IMMUTABLE",
      message: `${id} is declared in HEAD:${rel} and is changed or removed in the working tree; stable ids are immutable (ADR-0019 point 1c)`,
      path: target
    }));
}

/**
 * Check (9) under `validate --files` (REQ-KRN-032): the project paths `files`
 * in the scope of the check, each against its own `HEAD` version. The one
 * child process is the `contents` call — `HEAD:./<path>`, relative to the
 * project, so neither the prefix nor `ls-tree` is asked (ADR-0019 point 6).
 * Without the `HEAD` listing the new archive directories are not known:
 * every archive directory counts for the exemption of I-77 (I-159). Outside
 * git or before the first commit `contents` answers nothing — no finding.
 */
export async function checkImmutableFiles(
  ctx: Pick<Ctx, "root" | "git">,
  records: ReadonlyMap<string, RecordFile>,
  files: readonly string[]
): Promise<CliError[]> {
  const inScope = files.filter((rel) => {
    if (rel.startsWith("openspec/specs/")) return true;
    const m = /^openspec\/changes\/([^/]+)\//.exec(rel);
    return m !== null && m[1] !== "archive" && IDS_FROZEN_FROM.has(stateOf(records.get(m[1] as string)) ?? "");
  });
  if (inScope.length === 0) return [];
  const heads = await ctx.git.contents("HEAD", inScope.map((rel) => `./${rel}`));
  const removed = inScope.some((rel) => rel.startsWith("openspec/specs/"))
    ? removedByNewArchives(ctx.root, new Set())
    : new Map<string, Set<string>>();
  const errors: CliError[] = [];
  for (const rel of inScope) {
    const before = heads.get(`./${rel}`);
    if (before !== undefined) errors.push(...goneIds(ctx.root, rel, rel, before, removed));
  }
  return errors;
}
