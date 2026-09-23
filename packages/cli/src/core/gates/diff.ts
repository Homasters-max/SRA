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
 * The project's path inside its repository (`""` at the top, else `a/b` without
 * a trailing slash), as git itself sees it. Deriving it from `--show-toplevel`
 * and the project path breaks whenever the two spell the same directory
 * differently: a symlinked temp dir, or an 8.3 short name on Windows (I-100).
 */
export function projectPrefix(root: string): string | null {
  const run = git(["rev-parse", "--show-prefix"], root);
  if (!run.ok) return null;
  return run.stdout.trim().replace(/\/+$/, "");
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
  const prefix = projectPrefix(root);
  if (prefix === null) return { ok: false, reason: "git rev-parse --show-prefix failed" };
  const diff = git(["diff", "--name-status", "-z", "-M", "--diff-filter=ACDMR", `${facts.baseCommit}...${facts.commit}`], root);
  if (!diff.ok) {
    const detail = (diff.stderr || diff.stdout).trim().split("\n")[0] ?? "";
    return { ok: false, reason: `git diff ${facts.baseCommit}...${facts.commit} failed${detail === "" ? "" : `: ${detail}`}` };
  }
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

/** The full sha of `ref` when it names a commit of this repository, else null. */
export function resolveCommit(root: string, ref: string): string | null {
  const run = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], root);
  const sha = run.stdout.trim();
  return run.ok && sha !== "" ? sha : null;
}

/**
 * The commit that brought `commit` into the first-parent line of `of`: the
 * oldest commit on that line that contains it — the merge commit of its
 * impl-PR, or `commit` itself when it lies on the line. Null when the line is
 * unknown or does not contain `commit`.
 */
export function mergeCommitOf(root: string, commit: string, of = "HEAD"): string | null {
  const chain = git(["rev-list", "--first-parent", of], root);
  if (!chain.ok) return null;
  const line = chain.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (line.length === 0 || !isAncestor(root, commit, line[0] as string)) return null;
  // Containment is monotonic along the first-parent line (newest first): binary
  // search for the oldest commit that still contains `commit`.
  let lo = 0;
  let hi = line.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (isAncestor(root, commit, line[mid] as string)) lo = mid;
    else hi = mid - 1;
  }
  return line[lo] as string;
}

/** Parents of `commit`, the first parent first; empty when git cannot say. */
export function parentsOf(root: string, commit: string): string[] {
  const run = git(["rev-list", "--parents", "-n", "1", commit], root);
  return run.ok ? run.stdout.trim().split(/\s+/).slice(1) : [];
}

/**
 * Why `commit` is not the head of a merged impl-PR, or null when it is
 * (review of phase 3, R-1). The gates of `MERGED` judge `base...commit` only,
 * so the commit must be the last one of the impl-PR: a parent other than the
 * first of the merge commit that brought it into the first-parent line of
 * `of`. An older commit of the PR would leave the commits after it unjudged;
 * a commit on the line itself (fast-forward, a commit of the base branch)
 * has no PR boundary at all.
 */
export function notMergedHeadReason(root: string, commit: string, of = "HEAD"): string | null {
  const merge = mergeCommitOf(root, commit, of);
  if (merge === null) return `commit ${commit} is not on the first-parent line of ${of}`;
  if (merge === commit) {
    return `commit ${commit} lies on the first-parent line of ${of} itself (a fast-forward or a commit of the base branch), not on a merged impl-PR: merge the impl-PR with a merge commit`;
  }
  const heads = parentsOf(root, merge).slice(1);
  if (heads.includes(commit)) return null;
  return `commit ${commit} is not the head of the impl-PR merged by ${merge} (head ${heads.join(", ") || "unknown"}): the commits after it would go unjudged; take the evidence of the CI run on the head and pass --commit <head>`;
}

/**
 * Base of a merged commit (design §9: `merge-base(main, <commit>)` as it was
 * before `<commit>` was merged). Once `<commit>` is merged, `main` contains it
 * and the literal merge-base is `<commit>` itself — an empty diff, and every
 * record's `base_commit` stale. So the base is taken against the state of the
 * base line just before the merge: `M` is {@link mergeCommitOf} `<commit>`
 * (the merge commit that brought it in), and the base is
 * `merge-base(M^1, <commit>)`, the fork point the impl-PR was checked against.
 * When `<commit>` itself lies on that line (fast-forward), `M^1` is its parent.
 * Null when no base can be found.
 */
export function forkPointOf(root: string, commit: string, of = "HEAD"): string | null {
  const merge = mergeCommitOf(root, commit, of);
  if (merge === null) {
    const base = git(["merge-base", of, commit], root);
    return base.ok && base.stdout.trim() !== "" ? base.stdout.trim() : null;
  }
  const parent = git(["rev-parse", "--verify", "--quiet", `${merge}^1`], root);
  if (!parent.ok || parent.stdout.trim() === "") return null;
  const base = git(["merge-base", parent.stdout.trim(), commit], root);
  return base.ok && base.stdout.trim() !== "" ? base.stdout.trim() : null;
}

/**
 * Git facts of a `MERGED` transition (design §9, REQ-VER-007): the evaluated
 * commit is `<commit>`, not HEAD, and the base is {@link forkPointOf} it on the
 * first-parent line of HEAD. `commit` must already be a full sha.
 */
export function mergedCommitFacts(root: string, commit: string): GitFacts {
  const common = git(["rev-parse", "--git-common-dir"], root);
  const commonDir = common.ok && common.stdout.trim() !== "" ? path.resolve(root, common.stdout.trim()) : null;
  const facts: GitFacts = { commonDir, commit, limitations: [] };
  const base = forkPointOf(root, commit);
  if (base !== null) facts.baseCommit = base;
  else facts.limitations.push(`no base: fork point of ${commit} unknown`);
  return facts;
}

/** Path → blob sha of the files of one tree, paths relative to the project. */
export type BlobTree = Record<string, string>;

/**
 * The contract of a Change at `commit` (design §6, ADR-0024):
 * `git ls-tree -r <commit> -- openspec/changes/<change>/proposal.md openspec/changes/<change>/specs`
 * as path → blob sha. Run in the project root, so git takes and prints the
 * paths relative to the project. A commit git does not know is unavailable;
 * an existing commit without those files is an empty tree.
 */
export function contractTree(root: string, commit: string, change: string): Availability<BlobTree> {
  if (resolveCommit(root, commit) === null) return { ok: false, reason: `commit ${commit} is unknown to git` };
  const dir = `openspec/changes/${change}`;
  const run = git(["ls-tree", "-r", "-z", commit, "--", `${dir}/proposal.md`, `${dir}/specs`], root);
  if (!run.ok) {
    const detail = (run.stderr || run.stdout).trim().split("\n")[0] ?? "";
    return { ok: false, reason: `git ls-tree ${commit} failed${detail === "" ? "" : `: ${detail}`}` };
  }
  const tree: BlobTree = {};
  for (const line of run.stdout.split("\0")) {
    // `<mode> SP <type> SP <sha> TAB <path>`
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const [, type, sha] = line.slice(0, tab).split(" ");
    if (type === "blob" && sha !== undefined) tree[line.slice(tab + 1)] = sha;
  }
  return { ok: true, value: tree };
}
