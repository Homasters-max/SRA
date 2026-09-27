/**
 * Contract of `GitPort` (ADR-0025 п. 5, design §7, task 4.3): the same
 * scenarios run against `GitCli` over a real repository and against
 * `FakeGit` over `ProjectBuilder` snapshots, with the project at the top of
 * the repository and in a subdirectory, and both must give the same answers.
 * Commits are named by labels: the ids differ between the sides, blob ids and
 * everything else do not.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { GitCli } from "../../src/adapters/git-cli.js";
import type { GitPort } from "../../src/core/ports/git.js";
import { blobSha, treeSha, type Tree } from "../app/helpers/fakes/git.js";
import { useProjectBuilder, type ProjectBuilder } from "../app/helpers/project-builder.js";

const project = useProjectBuilder();

/** Operations on a repository, done by real git or by `ProjectBuilder` + `FakeGit`. */
interface Repo {
  readonly builder: ProjectBuilder;
  readonly port: GitPort;
  init(): void;
  commit(label: string, paths?: string[]): void;
  branch(name: string, from?: string): void;
  checkout(name: string): void;
  merge(name: string, label: string, ff: "no" | "only"): void;
  /**
   * `origin/<remote>` becomes the upstream of the local `branch`; the
   * remote-tracking branch is made at `at`, or left missing without it.
   */
  upstream(branch: string, remote: string, at?: string): void;
  /** The commit id recorded under `label`. */
  sha(label: string): string;
}

class RealRepo implements Repo {
  readonly port: GitPort;
  private readonly shas = new Map<string, string>();
  private initialised = false;

  constructor(readonly builder: ProjectBuilder) {
    this.port = new GitCli(builder.root);
  }

  private git(...args: string[]): string {
    const run = spawnSync(
      "git",
      ["-c", "user.name=warrant-test", "-c", "user.email=test@example.invalid", "-c", "core.autocrlf=false", ...args],
      { cwd: this.builder.root, encoding: "utf8" }
    );
    if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
    return run.stdout.trim();
  }

  init(): void {
    const run = spawnSync("git", ["-c", "init.defaultBranch=main", "init", "--quiet", this.builder.top], { encoding: "utf8" });
    if (run.status !== 0) throw new Error(`git init failed: ${run.stderr}`);
    this.initialised = true;
  }

  commit(label: string, paths?: string[]): void {
    if (!this.initialised) this.init();
    this.git("add", ...(paths === undefined ? ["-A"] : ["--", ...paths]));
    this.git("commit", "--quiet", "-m", label);
    this.shas.set(label, this.git("rev-parse", "HEAD"));
  }

  branch(name: string, from?: string): void {
    this.git("checkout", "--quiet", "-b", name, ...(from === undefined ? [] : [from]));
  }

  checkout(name: string): void {
    this.git("checkout", "--quiet", name);
  }

  merge(name: string, label: string, ff: "no" | "only"): void {
    this.git("merge", "--quiet", ff === "no" ? "--no-ff" : "--ff-only", ...(ff === "no" ? ["-m", label] : []), name);
    this.shas.set(label, this.git("rev-parse", "HEAD"));
  }

  upstream(branch: string, remote: string, at?: string): void {
    this.git("config", "remote.origin.url", "https://example.invalid/origin.git");
    this.git("config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*");
    this.git("config", `branch.${branch}.remote`, "origin");
    this.git("config", `branch.${branch}.merge`, `refs/heads/${remote}`);
    if (at !== undefined) this.git("update-ref", `refs/remotes/origin/${remote}`, at);
  }

  sha(label: string): string {
    const sha = this.shas.get(label);
    if (sha === undefined) throw new Error(`no commit ${label}`);
    return sha;
  }
}

class FakeRepo implements Repo {
  readonly port: GitPort;
  private readonly shas = new Map<string, string>();

  constructor(readonly builder: ProjectBuilder) {
    this.port = builder.git;
  }

  init(): void {
    this.builder.gitInit();
  }

  commit(label: string, paths?: string[]): void {
    this.shas.set(label, this.builder.commit(label, paths === undefined ? {} : { paths }));
  }

  branch(name: string, from?: string): void {
    this.builder.branch(name, from);
  }

  checkout(name: string): void {
    this.builder.checkout(name);
  }

  merge(name: string, label: string, ff: "no" | "only"): void {
    this.shas.set(label, this.builder.merge(name, { label, ff }));
  }

  upstream(branch: string, remote: string, at?: string): void {
    this.builder.git.setUpstream(branch, `origin/${remote}`);
    if (at !== undefined) this.builder.git.setRemoteBranch(`origin/${remote}`, at);
  }

  sha(label: string): string {
    const sha = this.shas.get(label);
    if (sha === undefined) throw new Error(`no commit ${label}`);
    return sha;
  }
}

/** The files of the work tree of `top` without `.git`, keyed by their path from the top: what a commit of all of them holds. */
function diskTree(top: string): Tree {
  const tree: Tree = new Map();
  const visit = (rel: string): void => {
    for (const entry of readdirSync(path.join(top, rel), { withFileTypes: true })) {
      if (rel === "" && entry.name === ".git") continue;
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else tree.set(child, readFileSync(path.join(top, child)));
    }
  };
  visit("");
  return tree;
}

const SIDES = [
  { side: "GitCli (real git)", make: (b: ProjectBuilder): Repo => new RealRepo(b) },
  { side: "FakeGit", make: (b: ProjectBuilder): Repo => new FakeRepo(b) }
];
const CASES = SIDES.flatMap((s) => [
  { ...s, prefix: "" },
  { ...s, prefix: "sub/project" }
]);

describe.each(CASES)("GitPort contract: $side, project prefix '$prefix'", ({ make, prefix }) => {
  const top = (rel: string): string => (prefix === "" ? rel : `${prefix}/${rel}`);
  const repo = (): Repo => make(project({ prefix }));

  it("outside a repository every answer says so", async () => {
    const { port } = repo();
    expect(await port.prefix()).toBeNull();
    expect(await port.commonDir()).toBeNull();
    expect(await port.head()).toBeNull();
    expect(await port.branch()).toBeNull();
    expect(await port.resolveCommit("HEAD")).toBeNull();
    expect(await port.mergeBase("HEAD", "main")).toBeNull();
    expect(await port.isAncestor("HEAD", "HEAD")).toBe(false);
    expect(await port.firstParents("HEAD")).toBeNull();
    expect(await port.parents("HEAD")).toEqual([]);
    expect(await port.treeId("HEAD")).toBeNull();
    expect((await port.diffNames("main")).ok).toBe(false);
    expect((await port.tree("HEAD", ["openspec"])).ok).toBe(false);
    expect(await port.files("HEAD", ["openspec"])).toBeNull();
    expect(await port.contents("HEAD", [top(".warrant/warrant.json")])).toEqual(new Map());
    expect((await port.worktreeAt("HEAD")).ok).toBe(false);
  });

  it("a repository without commits: prefix and common dir, no HEAD", async () => {
    const r = repo();
    r.init();
    expect(await r.port.prefix()).toBe(prefix);
    const commonDir = await r.port.commonDir();
    expect(commonDir === null ? null : path.relative(r.builder.top, commonDir)).toBe(".git");
    expect(await r.port.head()).toBeNull();
    expect(await r.port.branch()).toBeNull();
    expect(await r.port.resolveCommit("HEAD")).toBeNull();
    expect(await r.port.files("HEAD", ["openspec"])).toBeNull();
  });

  it("history with a branch and a merge commit: refs, parents, ancestry, merge base", async () => {
    const r = repo();
    r.builder.write("a.txt", "a\n");
    r.commit("base");
    r.branch("topic");
    r.builder.write("a.txt", "a2\n");
    r.commit("work");
    r.checkout("main");
    r.builder.write("m.txt", "m\n");
    r.commit("main-2");
    r.merge("topic", "merge", "no");
    const [base, work, main2, merge] = ["base", "work", "main-2", "merge"].map((l) => r.sha(l)) as [string, string, string, string];
    const { port } = r;

    expect(await port.head()).toBe(merge);
    expect(await port.branch()).toBe("main");
    expect(await port.resolveCommit("topic")).toBe(work);
    expect(await port.resolveCommit(`${merge}^1`)).toBe(main2);
    expect(await port.resolveCommit(`${merge}^2`)).toBe(work);
    expect(await port.resolveCommit("HEAD~2")).toBe(base);
    expect(await port.resolveCommit(work.slice(0, 10))).toBe(work);
    expect(await port.resolveCommit("no-such-ref")).toBeNull();
    expect(await port.parents(merge)).toEqual([main2, work]);
    expect(await port.parents(base)).toEqual([]);
    expect(await port.firstParents("HEAD")).toEqual([merge, main2, base]);
    expect(await port.isAncestor(work, "HEAD")).toBe(true);
    expect(await port.isAncestor(merge, work)).toBe(false);
    expect(await port.mergeBase(main2, "topic")).toBe(base);
    expect(r.builder.read("a.txt")).toBe("a2\n");
  });

  it("diffs from the merge base: added, modified, deleted, renamed; paths from the top", async () => {
    const r = repo();
    r.builder.write("keep.txt", "k\n").write("mod.txt", "1\n").write("del.txt", "d\n").write("a-src.txt", "moved one\n");
    r.commit("base");
    r.branch("topic");
    r.builder.write("mod.txt", "2\n").write("new/add.txt", "n\n").remove("del.txt").remove("a-src.txt").write("z-dst.txt", "moved one\n");
    r.commit("work");
    r.checkout("main");
    r.builder.write("main-only.txt", "m\n");
    r.commit("main-2");
    r.checkout("topic");

    expect(await r.port.diffNameStatus(r.sha("base"), r.sha("work"))).toEqual({
      ok: true,
      value: [
        { status: "D", path: top("del.txt") },
        { status: "M", path: top("mod.txt") },
        { status: "A", path: top("new/add.txt") },
        { status: "R", path: top("z-dst.txt"), from: top("a-src.txt") }
      ]
    });
    // `main...HEAD`: the commit on main after the fork is not in it.
    expect(await r.port.diffNames("main")).toEqual({
      ok: true,
      value: [top("del.txt"), top("mod.txt"), top("new/add.txt"), top("z-dst.txt")]
    });
    expect((await r.port.diffNameStatus("no-such-ref", "HEAD")).ok).toBe(false);
  });

  it("upstream of a base: commits of the upstream not in the base; null without an upstream or its branch (I-192)", async () => {
    const r = repo();
    expect(await r.port.upstreamAhead("main")).toBeNull();
    r.builder.write("a.txt", "a\n");
    r.commit("base");
    r.branch("fetched");
    r.builder.write("b.txt", "b\n");
    r.commit("up-1");
    r.builder.write("c.txt", "c\n");
    r.commit("up-2");
    r.checkout("main");

    expect(await r.port.upstreamAhead("main")).toBeNull();
    r.upstream("main", "main", r.sha("up-2"));
    expect(await r.port.upstreamAhead("main")).toEqual({ upstream: "origin/main", ahead: 2 });
    expect(await r.port.upstreamAhead("HEAD")).toEqual({ upstream: "origin/main", ahead: 2 });
    // A remote-tracking branch has no upstream of its own.
    expect(await r.port.upstreamAhead("origin/main")).toBeNull();
    // Up to date: the upstream has nothing the base lacks.
    r.upstream("fetched", "main");
    expect(await r.port.upstreamAhead("fetched")).toEqual({ upstream: "origin/main", ahead: 0 });
    // The upstream is set, but its remote-tracking branch is missing.
    r.upstream("fetched", "gone");
    expect(await r.port.upstreamAhead("fetched")).toBeNull();
    expect(await r.port.upstreamAhead("no-such-branch")).toBeNull();
  });

  it("trees, file lists and contents at a revision; a commit of some paths only", async () => {
    const r = repo();
    r.builder.write("openspec/changes/c/proposal.md", "# P\n").write("openspec/changes/c/specs/s/spec.md", "# S\n");
    r.commit("base");
    r.builder.write("openspec/changes/c/proposal.md", "# P2\n").write("src/stray.ts", "export {};\n");
    r.commit("stray only", ["src/stray.ts"]);

    expect(await r.port.tree("HEAD", ["openspec/changes/c/proposal.md", "openspec/changes/c/specs"])).toEqual({
      ok: true,
      value: {
        "openspec/changes/c/proposal.md": blobSha(Buffer.from("# P\n")),
        "openspec/changes/c/specs/s/spec.md": blobSha(Buffer.from("# S\n"))
      }
    });
    expect(await r.port.files("HEAD", ["openspec/changes", "src"])).toEqual([
      top("openspec/changes/archive/.gitkeep"),
      top("openspec/changes/c/proposal.md"),
      top("openspec/changes/c/specs/s/spec.md"),
      top("src/stray.ts")
    ]);
    expect(await r.port.contents("HEAD", [top("openspec/changes/c/proposal.md"), top("missing.md")])).toEqual(
      new Map([[top("openspec/changes/c/proposal.md"), "# P\n"]])
    );
    expect(await r.port.contents(r.sha("base"), [top("src/stray.ts")])).toEqual(new Map());
    // `./` — relative to the project, without the prefix (validate --files, I-159).
    expect(await r.port.contents("HEAD", ["./openspec/changes/c/proposal.md", "./missing.md"])).toEqual(
      new Map([["./openspec/changes/c/proposal.md", "# P\n"]])
    );
  });

  it("dirty files under paths: a changed, a new and a deleted file, not a clean one; paths from the top", async () => {
    const r = repo();
    const dir = "openspec/changes/c";
    r.builder
      .write(`${dir}/proposal.md`, "# P\n")
      .write(`${dir}/specs/s/spec.md`, "# S\n")
      .write(`${dir}/specs/t/spec.md`, "# T\n")
      .write(`${dir}/design.md`, "# D\n");
    r.commit("base");
    expect(await r.port.dirty([`${dir}/proposal.md`, `${dir}/specs`])).toEqual({ ok: true, value: [] });

    r.builder
      .write(`${dir}/specs/s/spec.md`, "# S2\n")
      .write(`${dir}/specs/u/new/spec.md`, "# U\n")
      .remove(`${dir}/specs/t/spec.md`)
      .write(`${dir}/design.md`, "# D2\n");
    expect(await r.port.dirty([`${dir}/proposal.md`, `${dir}/specs`])).toEqual({
      ok: true,
      value: [top(`${dir}/specs/s/spec.md`), top(`${dir}/specs/t/spec.md`), top(`${dir}/specs/u/new/spec.md`)]
    });
    // Before the first commit every file is new; outside a repository git cannot say.
    const fresh = repo();
    fresh.init();
    fresh.builder.write(`${dir}/proposal.md`, "# P\n");
    expect(await fresh.port.dirty([`${dir}/proposal.md`])).toEqual({ ok: true, value: [top(`${dir}/proposal.md`)] });
    expect((await repo().port.dirty([dir])).ok).toBe(false);
  });

  it("tree ids: git's own, equal for equal content whatever the history (phase-4c, subject.tree)", async () => {
    const r = repo();
    r.builder.write("a.txt", "a\n").write("dir/b.txt", "b\n");
    r.commit("base");
    r.branch("topic");
    r.builder.write("a.txt", "a2\n");
    r.commit("work");
    r.checkout("main");
    r.builder.write("m.txt", "m\n");
    r.commit("main-2");
    r.merge("topic", "merge", "no");
    const { port } = r;
    const merged = await port.treeId(r.sha("merge"));
    expect(merged).toBe(treeSha(diskTree(r.builder.top)));
    expect(await port.treeId("HEAD")).toBe(merged);
    expect(await port.treeId(r.sha("work"))).not.toBe(merged);
    expect(await port.treeId(`${r.sha("merge")}^1`)).toBe(await port.treeId(r.sha("main-2")));

    // The same files committed on another line: the same tree as the merge.
    r.branch("again", r.sha("main-2"));
    r.builder.write("a.txt", "a2\n");
    r.commit("same content");
    expect(await port.treeId("HEAD")).toBe(merged);
    expect(await port.treeId("no-such-ref")).toBeNull();
  });

  it("a checkout of a commit: its files under the project root, the work tree untouched; dispose removes it (I-171)", async () => {
    const r = repo();
    r.builder.write(".warrant/warrant.json", '{"v":1}\n').write("docs/a.md", "# A\n");
    r.commit("base");
    r.builder.write(".warrant/warrant.json", '{"v":2}\n').remove("docs/a.md");
    r.commit("next");
    const { port } = r;

    const checkout = await port.worktreeAt(r.sha("base"));
    expect(checkout.ok).toBe(true);
    if (!checkout.ok) return;
    const { root, dispose } = checkout.value;
    try {
      expect(path.relative(r.builder.root, root).startsWith("..")).toBe(true);
      expect(readFileSync(path.join(root, ".warrant", "warrant.json"), "utf8")).toBe('{"v":1}\n');
      expect(readFileSync(path.join(root, "docs", "a.md"), "utf8")).toBe("# A\n");
      expect(r.builder.read(".warrant/warrant.json")).toBe('{"v":2}\n');
      expect(existsSync(path.join(r.builder.root, "docs", "a.md"))).toBe(false);
    } finally {
      await dispose();
    }
    expect(existsSync(root)).toBe(false);
    await dispose();
    // The repository keeps no trace of the checkout: HEAD and the branch are where they were.
    expect(await port.head()).toBe(r.sha("next"));
    expect(await port.branch()).toBe("main");
    expect((await port.worktreeAt("no-such-ref")).ok).toBe(false);
  });

  it("a fast-forward merge moves the branch without a merge commit", async () => {
    const r = repo();
    r.builder.write("a.txt", "a\n");
    r.commit("base");
    r.branch("ff");
    r.builder.write("b.txt", "b\n");
    r.commit("ahead");
    r.checkout("main");
    r.merge("ff", "ff-merge", "only");
    expect(r.sha("ff-merge")).toBe(r.sha("ahead"));
    expect(await r.port.head()).toBe(r.sha("ahead"));
    expect(await r.port.parents("HEAD")).toEqual([r.sha("base")]);
    expect(await r.port.firstParents("HEAD")).toEqual([r.sha("ahead"), r.sha("base")]);
  });
});
