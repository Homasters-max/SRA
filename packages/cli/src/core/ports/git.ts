/**
 * Port to git (ADR-0025 п. 3, design §2): the calls the commands make —
 * prefix, `HEAD`, commits and ancestry, trees and contents at a revision,
 * changed paths from a base. The adapter (`adapters/git-cli.ts`) runs `git` in
 * the project root and never throws; what git could not answer is `null`, an
 * empty list, or `{ ok: false, detail }` with the first line git printed.
 */

/** Status letters kept by `--diff-filter=ACDMR` (design §9). */
export type DiffStatus = "A" | "C" | "D" | "M" | "R";

/** One changed path; a rename or copy also names the path it came `from`. */
export interface DiffEntry {
  status: DiffStatus;
  path: string;
  from?: string;
}

/** Path → blob sha of the files of one tree, paths relative to the project. */
export type BlobTree = Record<string, string>;

/** A git answer, or the first line of what git printed when it failed. */
export type GitAnswer<T> = { ok: true; value: T } | { ok: false; detail: string };

export interface GitPort {
  /**
   * The project's path inside its repository as git sees it (`git rev-parse
   * --show-prefix`): `""` at the top, else `a/b` without a trailing slash;
   * null outside a work tree (I-100).
   */
  prefix(): Promise<string | null>;
  /** Absolute `git rev-parse --git-common-dir`, or null outside git. */
  commonDir(): Promise<string | null>;
  /** `HEAD` as a full sha, or null outside git or before the first commit. */
  head(): Promise<string | null>;
  /** The full sha of `ref^{commit}`, or null when it names no commit. */
  resolveCommit(ref: string): Promise<string | null>;
  /** `git rev-parse --abbrev-ref HEAD`: the branch, `HEAD` when detached; null when git cannot say. */
  branch(): Promise<string | null>;
  /** `git merge-base <a> <b>`, or null when there is none. */
  mergeBase(a: string, b: string): Promise<string | null>;
  /** `git merge-base --is-ancestor <commit> <of>`. */
  isAncestor(commit: string, of: string): Promise<boolean>;
  /** `git rev-list --first-parent <of>`, newest first; null when git cannot list it. */
  firstParents(of: string): Promise<string[] | null>;
  /** Parents of `commit`, the first parent first; empty when git cannot say. */
  parents(commit: string): Promise<string[]>;
  /**
   * `git diff --name-status -z -M --diff-filter=ACDMR <base>...<commit>`,
   * paths from the top of the repository.
   */
  diffNameStatus(base: string, commit: string): Promise<GitAnswer<DiffEntry[]>>;
  /** `git diff --name-only <base>...HEAD`: changed paths from the top of the repository. */
  diffNames(base: string): Promise<GitAnswer<string[]>>;
  /** Blobs of `git ls-tree -r <rev> -- <paths>`, paths relative to the project. */
  tree(rev: string, paths: string[]): Promise<GitAnswer<BlobTree>>;
  /** `git ls-tree -r --name-only --full-name <rev> -- <paths>`: file paths from the top of the repository; null on failure. */
  files(rev: string, paths: string[]): Promise<string[] | null>;
  /**
   * Contents of `<rev>:<path>` for each path from the top of the repository,
   * or `./<path>` relative to the project (git's own `<rev>:./<path>`, no
   * prefix needed — `validate --files`, I-159); keys are the paths as given, a
   * path missing at `rev` is absent from the map.
   */
  contents(rev: string, paths: string[]): Promise<Map<string, string>>;
}
