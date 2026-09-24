/**
 * `FakeGit` (ADR-0025 п. 4, design §5): `GitPort` over snapshots of trees.
 * A commit is `{ parents, tree: Map<path, content> }`, paths from the top of
 * the repository; branches are refs to commits; `HEAD` names a branch or a
 * commit. `ProjectBuilder.commit()` takes the snapshot from the files on disk.
 * Answers are computed from the snapshots: `diffNames(base)` is the difference
 * of the trees of `merge-base(base, HEAD)` and `HEAD`, blob ids are git's own
 * (`sha1("blob <size>\0" + content)`), so `tree()` answers exactly what git
 * answers. The contract (`test/contract/git.contract.test.ts`) runs the same
 * scenarios against a real repository.
 *
 * Limits of the model (the contract covers what is inside them): a rename is
 * found only for identical content (git: ≥ 50 % similar); refs are `HEAD`,
 * branch names, full or abbreviated (≥ 4) commit ids, each with `^N`/`~N`
 * suffixes; `fail(method)` answers as when the git call fails.
 */
import { createHash } from "node:crypto";

import type { BlobTree, DiffEntry, GitAnswer, GitPort } from "../../../../src/core/ports/git.js";

export type Tree = Map<string, Buffer>;

export interface FakeCommit {
  sha: string;
  label: string;
  parents: string[];
  tree: Tree;
}

type Method = keyof GitPort;

/** Git's blob id of `content`. */
export function blobSha(content: Buffer): string {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

/** Byte order of paths: the order git lists them in. */
const byPath = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

const within = (file: string, spec: string): boolean => spec === "" || spec === "." || file === spec || file.startsWith(`${spec.replace(/\/+$/, "")}/`);

export class FakeGit implements GitPort {
  readonly commits = new Map<string, FakeCommit>();
  readonly branches = new Map<string, string>();
  /** The checked-out branch, or null when `HEAD` is detached at {@link detached}. */
  current: string | null = "main";
  detached: string | null = null;
  /** The calls made: method name and arguments. */
  readonly calls: string[] = [];

  private repo = false;
  private counter = 0;
  private readonly failing = new Set<Method>();

  /**
   * @param commonDirPath absolute `.git` directory of the repository
   * @param projectPrefix the project's path inside the repository, `""` at the top
   */
  constructor(
    private readonly commonDirPath: string,
    private readonly projectPrefix = ""
  ) {}

  // ---- model -------------------------------------------------------------

  /** `git init`: the project is inside a work tree from now on, on `branch`. */
  init(branch = "main"): this {
    this.repo = true;
    this.current = branch;
    return this;
  }

  get initialised(): boolean {
    return this.repo;
  }

  /** Path from the top of the repository of a project-relative path. */
  repoPath(rel: string): string {
    return this.projectPrefix === "" ? rel : `${this.projectPrefix}/${rel}`;
  }

  /** The commit `HEAD` points at, or null before the first commit. */
  headCommit(): FakeCommit | null {
    const sha = this.current === null ? this.detached : (this.branches.get(this.current) ?? null);
    return sha === null ? null : (this.commits.get(sha) ?? null);
  }

  /** Records a commit of `tree` on top of `HEAD` (and of `extraParents`, for a merge); moves the branch. */
  commit(tree: Tree, label: string, extraParents: string[] = []): string {
    if (!this.repo) this.init();
    const head = this.headCommit();
    const parents = [...(head === null ? [] : [head.sha]), ...extraParents];
    this.counter += 1;
    const sha = createHash("sha1").update(`fake-commit\0${this.counter}\0${label}\0${parents.join(",")}`).digest("hex");
    this.commits.set(sha, { sha, label, parents, tree: new Map(tree) });
    this.moveHead(sha);
    return sha;
  }

  /** `git checkout -b <name> [<from>]` without touching files (the builder does that). */
  createBranch(name: string, from = "HEAD"): void {
    const sha = this.resolve(from);
    if (sha === null) throw new Error(`FakeGit: cannot branch ${name} from ${from}`);
    this.branches.set(name, sha);
  }

  /** Points `HEAD` at the branch `name`. */
  switchTo(name: string): void {
    if (!this.branches.has(name)) throw new Error(`FakeGit: no branch ${name}`);
    this.current = name;
    this.detached = null;
  }

  /** Moves the checked-out branch (or the detached `HEAD`) to `sha`: commit, fast-forward. */
  moveHead(sha: string): void {
    if (this.current === null) this.detached = sha;
    else this.branches.set(this.current, sha);
  }

  /** The tree of `rev`, or null when it names no commit. */
  treeOf(rev: string): Tree | null {
    const sha = this.resolve(rev);
    return sha === null ? null : (this.commits.get(sha)?.tree ?? null);
  }

  /** From now on `method` answers as when the git call fails. */
  fail(method: Method): this {
    this.failing.add(method);
    return this;
  }

  recover(method: Method): this {
    this.failing.delete(method);
    return this;
  }

  /** The full id of the commit `rev` names, or null. */
  resolve(rev: string): string | null {
    const match = /^(.*?)((?:[~^]\d*)*)$/.exec(rev.trim());
    if (match === null) return null;
    let sha = this.resolveName(match[1] as string);
    for (const step of (match[2] as string).match(/[~^]\d*/g) ?? []) {
      if (sha === null) return null;
      const n = step.length > 1 ? Number.parseInt(step.slice(1), 10) : 1;
      if (step[0] === "^") {
        if (n === 0) continue;
        sha = this.commits.get(sha)?.parents[n - 1] ?? null;
      } else {
        for (let i = 0; i < n && sha !== null; i += 1) sha = this.commits.get(sha)?.parents[0] ?? null;
      }
    }
    return sha;
  }

  private resolveName(name: string): string | null {
    if (!this.repo) return null;
    if (name === "HEAD") return this.headCommit()?.sha ?? null;
    const branch = this.branches.get(name.replace(/^refs\/heads\//, ""));
    if (branch !== undefined) return branch;
    if (!/^[0-9a-f]{4,40}$/.test(name)) return null;
    const hits = [...this.commits.keys()].filter((sha) => sha.startsWith(name));
    return hits.length === 1 ? (hits[0] as string) : null;
  }

  /** Every ancestor of `sha`, itself included. */
  ancestorsOf(sha: string): Set<string> {
    const seen = new Set<string>();
    const stack = [sha];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(this.commits.get(next)?.parents ?? []));
    }
    return seen;
  }

  /** `git merge-base <a> <b>` over full ids. */
  bestCommonAncestor(a: string, b: string): string | null {
    const ofB = this.ancestorsOf(b);
    const common = [...this.ancestorsOf(a)].filter((sha) => ofB.has(sha));
    // Best: a common ancestor that no other common ancestor descends from.
    const best = common.filter((sha) => !common.some((other) => other !== sha && this.ancestorsOf(other).has(sha)));
    return best[0] ?? null;
  }

  /** `base...commit` as name-status entries, paths from the top; null when a rev or the merge base is unknown. */
  private diff(base: string, commit: string): DiffEntry[] | null {
    const b = this.resolve(base);
    const c = this.resolve(commit);
    if (b === null || c === null) return null;
    const mb = this.bestCommonAncestor(b, c);
    if (mb === null) return null;
    const from = this.commits.get(mb)?.tree ?? new Map<string, Buffer>();
    const to = this.commits.get(c)?.tree ?? new Map<string, Buffer>();
    const added = [...to.keys()].filter((p) => !from.has(p));
    const deleted = [...from.keys()].filter((p) => !to.has(p));
    const entries: DiffEntry[] = [];
    for (const p of to.keys()) {
      const before = from.get(p);
      if (before !== undefined && !before.equals(to.get(p) as Buffer)) entries.push({ status: "M", path: p });
    }
    const renamedFrom = new Set<string>();
    for (const p of added) {
      const source = deleted.find((d) => !renamedFrom.has(d) && (from.get(d) as Buffer).equals(to.get(p) as Buffer));
      if (source === undefined) entries.push({ status: "A", path: p });
      else {
        renamedFrom.add(source);
        entries.push({ status: "R", path: p, from: source });
      }
    }
    for (const p of deleted) if (!renamedFrom.has(p)) entries.push({ status: "D", path: p });
    return entries.sort((x, y) => byPath(x.path, y.path));
  }

  // ---- port --------------------------------------------------------------

  prefix(): Promise<string | null> {
    return this.answer("prefix", [], null, () => (this.repo ? this.projectPrefix : null));
  }

  commonDir(): Promise<string | null> {
    return this.answer("commonDir", [], null, () => (this.repo ? this.commonDirPath : null));
  }

  head(): Promise<string | null> {
    return this.answer("head", [], null, () => this.headCommit()?.sha ?? null);
  }

  resolveCommit(ref: string): Promise<string | null> {
    return this.answer("resolveCommit", [ref], null, () => this.resolve(ref));
  }

  branch(): Promise<string | null> {
    return this.answer("branch", [], null, () => (this.headCommit() === null ? null : (this.current ?? "HEAD")));
  }

  mergeBase(a: string, b: string): Promise<string | null> {
    return this.answer("mergeBase", [a, b], null, () => {
      const x = this.resolve(a);
      const y = this.resolve(b);
      return x === null || y === null ? null : this.bestCommonAncestor(x, y);
    });
  }

  isAncestor(commit: string, of: string): Promise<boolean> {
    return this.answer("isAncestor", [commit, of], false, () => {
      const c = this.resolve(commit);
      const o = this.resolve(of);
      return c !== null && o !== null && this.ancestorsOf(o).has(c);
    });
  }

  firstParents(of: string): Promise<string[] | null> {
    return this.answer("firstParents", [of], null, () => {
      let sha = this.resolve(of);
      if (sha === null) return null;
      const line: string[] = [];
      while (sha !== null) {
        line.push(sha);
        sha = this.commits.get(sha)?.parents[0] ?? null;
      }
      return line;
    });
  }

  parents(commit: string): Promise<string[]> {
    return this.answer("parents", [commit], [], () => {
      const sha = this.resolve(commit);
      return sha === null ? [] : [...(this.commits.get(sha)?.parents ?? [])];
    });
  }

  diffNameStatus(base: string, commit: string): Promise<GitAnswer<DiffEntry[]>> {
    const failed: GitAnswer<DiffEntry[]> = { ok: false, detail: `fatal: bad revision '${base}...${commit}'` };
    return this.answer("diffNameStatus", [base, commit], failed, () => {
      const entries = this.diff(base, commit);
      return entries === null ? failed : { ok: true, value: entries };
    });
  }

  diffNames(base: string): Promise<GitAnswer<string[]>> {
    const failed: GitAnswer<string[]> = { ok: false, detail: `fatal: bad revision '${base}...HEAD'` };
    return this.answer("diffNames", [base], failed, () => {
      const entries = this.diff(base, "HEAD");
      return entries === null ? failed : { ok: true, value: entries.map((e) => e.path) };
    });
  }

  tree(rev: string, paths: string[]): Promise<GitAnswer<BlobTree>> {
    const failed: GitAnswer<BlobTree> = { ok: false, detail: `fatal: Not a valid object name ${rev}` };
    return this.answer("tree", [rev, ...paths], failed, () => {
      const tree = this.treeOf(rev);
      if (tree === null) return failed;
      const out: BlobTree = {};
      const specs = paths.map((p) => this.repoPath(p));
      for (const file of [...tree.keys()].sort(byPath)) {
        if (!specs.some((spec) => within(file, spec))) continue;
        const rel = this.projectPrefix === "" ? file : file.slice(this.projectPrefix.length + 1);
        out[rel] = blobSha(tree.get(file) as Buffer);
      }
      return { ok: true, value: out };
    });
  }

  files(rev: string, paths: string[]): Promise<string[] | null> {
    return this.answer("files", [rev, ...paths], null, () => {
      const tree = this.treeOf(rev);
      if (tree === null) return null;
      const specs = paths.map((p) => this.repoPath(p));
      return [...tree.keys()].filter((file) => specs.some((spec) => within(file, spec))).sort(byPath);
    });
  }

  contents(rev: string, paths: string[]): Promise<Map<string, string>> {
    return this.answer("contents", [rev, ...paths], new Map(), () => {
      const out = new Map<string, string>();
      const tree = this.treeOf(rev);
      if (tree === null) return out;
      for (const p of paths) {
        const content = tree.get(p);
        if (content !== undefined) out.set(p, content.toString("utf8"));
      }
      return out;
    });
  }

  private answer<T>(method: Method, args: string[], failure: T, compute: () => T): Promise<T> {
    this.calls.push([method, ...args].join(" "));
    return Promise.resolve(this.failing.has(method) ? failure : compute());
  }
}
