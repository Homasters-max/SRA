/**
 * `FakeGit` (ADR-0025 п. 4, design §5, task 4.1): answers from snapshots of
 * trees — refs, ancestry, diffs, trees and contents — journal and injected
 * failures. Conformity with real git: `test/contract/git.contract.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { blobSha, FakeGit, type Tree } from "../../app/helpers/fakes/git.js";

const tree = (files: Record<string, string>): Tree => new Map(Object.entries(files).map(([p, c]) => [p, Buffer.from(c)]));

describe("FakeGit: model", () => {
  it("outside a repository and before the first commit", async () => {
    const git = new FakeGit("/repo/.git");
    expect(await git.prefix()).toBeNull();
    expect(await git.commonDir()).toBeNull();
    git.init();
    expect(await git.prefix()).toBe("");
    expect(await git.commonDir()).toBe("/repo/.git");
    expect(await git.head()).toBeNull();
    expect(await git.branch()).toBeNull();
    expect(await git.resolveCommit("HEAD")).toBeNull();
  });

  it("commits, branches, merges: refs, parents, ancestry, merge base", async () => {
    const git = new FakeGit("/repo/.git").init();
    const base = git.commit(tree({ "a.txt": "a" }), "base");
    git.createBranch("topic");
    git.switchTo("topic");
    const impl = git.commit(tree({ "a.txt": "a", "b.txt": "b" }), "impl");
    git.switchTo("main");
    const merge = git.commit(tree({ "a.txt": "a", "b.txt": "b" }), "merge", [impl]);

    expect(await git.head()).toBe(merge);
    expect(await git.branch()).toBe("main");
    expect(await git.resolveCommit("topic")).toBe(impl);
    expect(await git.resolveCommit(`${merge}^1`)).toBe(base);
    expect(await git.resolveCommit(`${merge}^2`)).toBe(impl);
    expect(await git.resolveCommit("HEAD~1")).toBe(base);
    expect(await git.resolveCommit(impl.slice(0, 7))).toBe(impl);
    expect(await git.resolveCommit("nope")).toBeNull();
    expect(await git.parents(merge)).toEqual([base, impl]);
    expect(await git.firstParents("HEAD")).toEqual([merge, base]);
    expect(await git.isAncestor(impl, "main")).toBe(true);
    expect(await git.isAncestor("main", impl)).toBe(false);
    expect(await git.mergeBase("topic", base)).toBe(base);
  });

  it("diff base...commit from the merge base: added, modified, deleted, renamed by identical content", async () => {
    const git = new FakeGit("/repo/.git").init();
    const base = git.commit(tree({ "keep.txt": "k", "mod.txt": "1", "del.txt": "d", "old.txt": "moved" }), "base");
    git.createBranch("topic");
    git.switchTo("topic");
    git.commit(tree({ "keep.txt": "k", "mod.txt": "2", "new/add.txt": "n", "new/place.txt": "moved" }), "work");
    git.switchTo("main");
    git.commit(tree({ "keep.txt": "k", "mod.txt": "1", "del.txt": "d", "old.txt": "moved", "main-only.txt": "m" }), "main moves");

    expect(await git.diffNameStatus(base, "topic")).toEqual({
      ok: true,
      value: [
        { status: "D", path: "del.txt" },
        { status: "M", path: "mod.txt" },
        { status: "A", path: "new/add.txt" },
        { status: "R", path: "new/place.txt", from: "old.txt" }
      ]
    });
    // `main...topic`: from the merge base, so the commit on main is not in it.
    git.switchTo("topic");
    const names = await git.diffNames("main");
    expect(names).toEqual({ ok: true, value: ["del.txt", "mod.txt", "new/add.txt", "new/place.txt"] });
    expect((await git.diffNameStatus("nope", "HEAD")).ok).toBe(false);
  });

  it("tree, files and contents with the project in a subdirectory", async () => {
    const git = new FakeGit("/repo/.git", "sub/project").init();
    const files = tree({ "sub/project/openspec/changes/c/proposal.md": "p", "sub/project/openspec/changes/c/specs/s/spec.md": "s", "other.txt": "o" });
    git.commit(files, "base");

    expect(await git.prefix()).toBe("sub/project");
    expect(await git.tree("HEAD", ["openspec/changes/c/proposal.md", "openspec/changes/c/specs"])).toEqual({
      ok: true,
      value: {
        "openspec/changes/c/proposal.md": blobSha(Buffer.from("p")),
        "openspec/changes/c/specs/s/spec.md": blobSha(Buffer.from("s"))
      }
    });
    expect(await git.files("HEAD", ["openspec/changes"])).toEqual([
      "sub/project/openspec/changes/c/proposal.md",
      "sub/project/openspec/changes/c/specs/s/spec.md"
    ]);
    expect(await git.contents("HEAD", ["sub/project/openspec/changes/c/proposal.md", "missing.md"])).toEqual(
      new Map([["sub/project/openspec/changes/c/proposal.md", "p"]])
    );
    expect(await git.files("nope", ["openspec"])).toBeNull();
    expect((await git.tree("nope", ["openspec"])).ok).toBe(false);
  });

  it("blob ids are git's: the empty blob", () => {
    expect(blobSha(Buffer.alloc(0))).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
});

describe("FakeGit: journal and failures", () => {
  it("journals calls and answers a failed method as git failing", async () => {
    const git = new FakeGit("/repo/.git").init();
    git.commit(tree({ "a.txt": "a" }), "base");
    git.fail("head").fail("diffNames").fail("isAncestor");
    expect(await git.head()).toBeNull();
    expect((await git.diffNames("main")).ok).toBe(false);
    expect(await git.isAncestor("HEAD", "HEAD")).toBe(false);
    git.recover("head");
    expect(await git.head()).not.toBeNull();
    expect(git.calls).toEqual(["head", "diffNames main", "isAncestor HEAD HEAD", "head"]);
  });
});
