/**
 * `GitPort` over the `git` binary (design §2, §9, ADR-0025 п. 3), run in the
 * project root. Asynchronous (I-64); nothing here throws — what git could not
 * answer is `null`, an empty list, or `{ ok: false, detail }` with the first
 * line git printed.
 */
import path from "node:path";

import { parseNameStatus } from "../core/gates/diff.js";
import type { BlobTree, DiffEntry, GitAnswer, GitPort } from "../core/ports/git.js";
import { exec } from "./exec.js";

interface GitRun {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** First line of what a failed git call printed. */
function detailOf(run: GitRun): string {
  return (run.stderr || run.stdout).trim().split("\n")[0] ?? "";
}

/** Trimmed stdout of a successful call, or null when it failed or printed nothing. */
function answer(run: GitRun): string | null {
  const value = run.stdout.trim();
  return run.ok && value !== "" ? value : null;
}

export class GitCli implements GitPort {
  constructor(private readonly root: string) {}

  private async git(args: string[]): Promise<GitRun> {
    const proc = await exec("git", args, this.root);
    return { ok: proc.ok, stdout: proc.stdout.toString("utf8"), stderr: proc.stderr.toString("utf8") };
  }

  async prefix(): Promise<string | null> {
    const run = await this.git(["rev-parse", "--show-prefix"]);
    if (!run.ok) return null;
    return run.stdout.trim().replace(/\/+$/, "");
  }

  async commonDir(): Promise<string | null> {
    const dir = answer(await this.git(["rev-parse", "--git-common-dir"]));
    return dir === null ? null : path.resolve(this.root, dir);
  }

  async head(): Promise<string | null> {
    return answer(await this.git(["rev-parse", "--verify", "--quiet", "HEAD"]));
  }

  async resolveCommit(ref: string): Promise<string | null> {
    return answer(await this.git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]));
  }

  async branch(): Promise<string | null> {
    return answer(await this.git(["rev-parse", "--abbrev-ref", "HEAD"]));
  }

  async mergeBase(a: string, b: string): Promise<string | null> {
    return answer(await this.git(["merge-base", a, b]));
  }

  async isAncestor(commit: string, of: string): Promise<boolean> {
    return (await this.git(["merge-base", "--is-ancestor", commit, of])).ok;
  }

  async firstParents(of: string): Promise<string[] | null> {
    const run = await this.git(["rev-list", "--first-parent", of]);
    if (!run.ok) return null;
    return run.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  }

  async parents(commit: string): Promise<string[]> {
    const run = await this.git(["rev-list", "--parents", "-n", "1", commit]);
    return run.ok ? run.stdout.trim().split(/\s+/).slice(1) : [];
  }

  async diffNameStatus(base: string, commit: string): Promise<GitAnswer<DiffEntry[]>> {
    const run = await this.git(["diff", "--name-status", "-z", "-M", "--diff-filter=ACDMR", `${base}...${commit}`]);
    if (!run.ok) return { ok: false, detail: detailOf(run) };
    return { ok: true, value: parseNameStatus(run.stdout) };
  }

  async diffNames(base: string): Promise<GitAnswer<string[]>> {
    const run = await this.git(["diff", "--name-only", `${base}...HEAD`]);
    if (!run.ok) return { ok: false, detail: detailOf(run) };
    return { ok: true, value: run.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "") };
  }

  async tree(rev: string, paths: string[]): Promise<GitAnswer<BlobTree>> {
    const run = await this.git(["ls-tree", "-r", "-z", rev, "--", ...paths]);
    if (!run.ok) return { ok: false, detail: detailOf(run) };
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

  async files(rev: string, paths: string[]): Promise<string[] | null> {
    const run = await this.git(["ls-tree", "-r", "-z", "--name-only", "--full-name", rev, "--", ...paths]);
    if (!run.ok) return null;
    return run.stdout.split("\0").filter((p) => p !== "");
  }

  /**
   * One `git cat-file --batch` call for all paths. Output per object:
   * `<oid> blob <size>\n<bytes>\n`, or `<name> missing\n`.
   */
  async contents(rev: string, paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (paths.length === 0) return out;
    const proc = await exec("git", ["cat-file", "--batch"], this.root, paths.map((p) => `${rev}:${p}`).join("\n") + "\n");
    if (!proc.ok) return out;
    const buf = proc.stdout;
    let offset = 0;
    for (const p of paths) {
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
}
