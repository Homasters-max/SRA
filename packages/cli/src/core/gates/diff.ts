/**
 * Git facts of a gate evaluation (design §9, REQ-VER-003, REQ-VER-004):
 * the evaluated commit, the base, the changed paths `base...commit` and the
 * current branch. This module and `commands/*` are the only places the gate
 * engine touches git; everything under `core/gates/` besides it is pure.
 *
 * Every call is one short `spawnSync` (I-64). Nothing here throws for a
 * missing input: outside git the facts say "unknown" and the gates that need
 * them are `BLOCKED` with `NO_INPUT` (P-7). Only an explicit `--base` that
 * names no commit is a usage error.
 */
import path from "node:path";

import spawnCjs from "cross-spawn";

import { WarrantError } from "../errors.js";
import { NO_GIT_COMMIT, NO_GIT_LIMITATION } from "../evidence/record.js";

// `cross-spawn` is CommonJS with `export =`; the same spawner as `classify` for git.
const spawn = spawnCjs as unknown as typeof import("cross-spawn");

/** Base branch of the default base (design §9: a constant until a failure mode says otherwise). */
export const BASE_BRANCH = "main";

export interface GitRun {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** One short git command in `cwd`; never throws. */
export function git(args: string[], cwd: string): GitRun {
  const proc = spawn.sync("git", args, { cwd, encoding: "utf8" });
  return { ok: proc.error == null && proc.status === 0, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

/** A value that could be read, or the reason it could not. */
export type Availability<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface GitFacts {
  /** Absolute `git rev-parse --git-common-dir`, or null outside git. */
  commonDir: string | null;
  /** HEAD, or {@link NO_GIT_COMMIT} outside git or before the first commit. */
  commit: string;
  /** Base commit: `--base`, else `merge-base(HEAD, main)`; absent when unknown. */
  baseCommit?: string;
  /** What a record written on these facts must admit (`no git`, `no base`). */
  limitations: string[];
}

/**
 * HEAD and the base of the working tree (design §6, §9). `--base` that does not
 * resolve to a commit is `USAGE`; a missing `main` only leaves the base unknown.
 */
export function readGitFacts(root: string, baseRef: string | undefined): GitFacts {
  const common = git(["rev-parse", "--git-common-dir"], root);
  const head = common.ok ? git(["rev-parse", "--verify", "--quiet", "HEAD"], root) : { ok: false, stdout: "", stderr: "" };
  const commonDir = common.ok && common.stdout.trim() !== "" ? path.resolve(root, common.stdout.trim()) : null;
  const commit = head.ok && head.stdout.trim() !== "" ? head.stdout.trim() : NO_GIT_COMMIT;
  const facts: GitFacts = { commonDir, commit, limitations: [] };
  if (commit === NO_GIT_COMMIT) facts.limitations.push(NO_GIT_LIMITATION);

  if (baseRef !== undefined) {
    const base = commonDir === null ? { ok: false, stdout: "" } : git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`], root);
    if (!base.ok || base.stdout.trim() === "") {
      throw new WarrantError("USAGE", `--base ${JSON.stringify(baseRef)} does not name a commit of this repository`);
    }
    facts.baseCommit = base.stdout.trim();
  } else if (commit !== NO_GIT_COMMIT) {
    const base = git(["merge-base", "HEAD", BASE_BRANCH], root);
    if (base.ok && base.stdout.trim() !== "") facts.baseCommit = base.stdout.trim();
    else facts.limitations.push(`no base: merge-base(HEAD, ${BASE_BRANCH}) unknown`);
  }
  return facts;
}

/** Status letters kept by `--diff-filter=ACDMR` (design §9). */
export type DiffStatus = "A" | "C" | "D" | "M" | "R";

/** One changed path; a rename or copy also names the path it came `from`. */
export interface DiffEntry {
  status: DiffStatus;
  path: string;
  from?: string;
}

/**
 * Parses `git diff --name-status -z` output. With `-z` every field ends in NUL
 * and paths are never quoted; a rename or copy (`R100`, `C75`) carries two
 * paths, source first.
 */
export function parseNameStatus(output: string): DiffEntry[] {
  const fields = output.split("\0");
  const out: DiffEntry[] = [];
  let i = 0;
  while (i < fields.length) {
    const code = fields[i] ?? "";
    if (code === "") {
      i += 1;
      continue;
    }
    const status = code[0] as DiffStatus;
    if (status === "R" || status === "C") {
      const from = fields[i + 1] ?? "";
      const to = fields[i + 2] ?? "";
      out.push({ status, path: to, from });
      i += 3;
    } else {
      out.push({ status, path: fields[i + 1] ?? "" });
      i += 2;
    }
  }
  return out;
}

/**
 * Keeps the entries inside the project and makes their paths relative to it:
 * git prints paths from the top of the repository, the policy speaks of the
 * project. An entry whose paths all lie outside the project is dropped.
 */
export function relativeToProject(entries: DiffEntry[], prefix: string): DiffEntry[] {
  if (prefix === "") return entries;
  const inside = (p: string): string | undefined => (p.startsWith(`${prefix}/`) ? p.slice(prefix.length + 1) : undefined);
  const out: DiffEntry[] = [];
  for (const entry of entries) {
    const to = inside(entry.path);
    const from = entry.from === undefined ? undefined : inside(entry.from);
    if (to === undefined && from === undefined) continue;
    if (to === undefined) {
      // Moved out of the project: from here it is a deletion.
      out.push({ status: "D", path: from as string });
    } else if (entry.from !== undefined && from === undefined) {
      out.push({ status: "A", path: to });
    } else {
      out.push(from === undefined ? { status: entry.status, path: to } : { status: entry.status, path: to, from });
    }
  }
  return out;
}

/**
 * Changed paths of `git diff --name-status --diff-filter=ACDMR <base>...<commit>`
 * (design §9), relative to the project root, sorted by path.
 */
export function changedPaths(root: string, facts: GitFacts): Availability<DiffEntry[]> {
  if (facts.commonDir === null || facts.commit === NO_GIT_COMMIT) {
    return { ok: false, reason: "the project is not a git repository with a commit" };
  }
  if (facts.baseCommit === undefined) {
    return { ok: false, reason: `no base: merge-base(HEAD, ${BASE_BRANCH}) unknown; pass --base` };
  }
  const top = git(["rev-parse", "--show-toplevel"], root);
  if (!top.ok) return { ok: false, reason: "git rev-parse --show-toplevel failed" };
  const diff = git(["diff", "--name-status", "-z", "-M", "--diff-filter=ACDMR", `${facts.baseCommit}...${facts.commit}`], root);
  if (!diff.ok) {
    const detail = (diff.stderr || diff.stdout).trim().split("\n")[0] ?? "";
    return { ok: false, reason: `git diff ${facts.baseCommit}...${facts.commit} failed${detail === "" ? "" : `: ${detail}`}` };
  }
  const prefix = path.relative(path.resolve(top.stdout.trim()), path.resolve(root)).split(path.sep).join("/");
  const entries = relativeToProject(parseNameStatus(diff.stdout), prefix);
  return { ok: true, value: entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
}

/**
 * The checked-out branch: its short name, `HEAD` when detached; unavailable
 * outside git or before the first commit.
 */
export function currentBranch(root: string, facts: GitFacts): Availability<string> {
  if (facts.commonDir === null || facts.commit === NO_GIT_COMMIT) {
    return { ok: false, reason: "the project is not a git repository with a commit" };
  }
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], root);
  if (!branch.ok || branch.stdout.trim() === "") return { ok: false, reason: "git rev-parse --abbrev-ref HEAD failed" };
  return { ok: true, value: branch.stdout.trim() };
}

/** Whether `commit` is an ancestor of (or equal to) `of` — `git merge-base --is-ancestor` (design §9). */
export function isAncestor(root: string, commit: string, of = "HEAD"): boolean {
  return git(["merge-base", "--is-ancestor", commit, of], root).ok;
}
