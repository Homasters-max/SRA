/**
 * What `warrant ci` judges (REQ-VER-011, task 4.1 of phase-4c): HEAD is the
 * result of a merge with exactly two parents — SCN-VER-083 — the Change and
 * the kind come from the one record the diff changes — SCN-VER-077 — and the
 * base of requirements is a checkout of HEAD^1, removed whatever happens (I-171).
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { withBase } from "../../../src/core/ci/base.js";
import { readCiSubject, readMergeHead } from "../../../src/core/ci/kind.js";
import { WarrantError } from "../../../src/core/errors.js";
import { FakeGit, type Tree } from "../../app/helpers/fakes/git.js";

const tree = (files: Record<string, string>): Tree => new Map(Object.entries(files).map(([p, c]) => [p, Buffer.from(c)]));
const record = (change: string, state: string): string =>
  JSON.stringify({ $schema: "warrant://change-record/1", change, change_state: state, transitions: [{ to: "PROPOSED", at: "2026-09-22T09:00:00Z", by: "cli:local" }] });

/** main with `base`, a branch `pr` with `head` merged into it by a merge commit with the files of `merged`. */
function merged(base: Record<string, string>, head: Record<string, string>): FakeGit {
  const git = new FakeGit("/repo/.git").init();
  git.commit(tree(base), "base");
  git.createBranch("pr");
  git.switchTo("pr");
  const pr = git.commit(tree(head), "head");
  git.switchTo("main");
  git.commit(tree(head), "merge", [pr]);
  return git;
}

async function thrown(call: () => Promise<unknown>): Promise<WarrantError> {
  try {
    await call();
  } catch (error) {
    if (error instanceof WarrantError) return error;
    throw error;
  }
  throw new Error("expected a WarrantError");
}

describe("warrant ci: HEAD is the result of a merge", () => {
  it("names the tip of the base and the head of the PR as the parents of HEAD", async () => {
    const git = merged({ "a.md": "a" }, { "a.md": "b" });
    const heads = await readMergeHead({ git });
    expect(heads).toEqual({
      merge: await git.head(),
      base: await git.resolveCommit("HEAD^1"),
      head: await git.resolveCommit("pr")
    });
  });

  it("refuses HEAD with one parent or with three: USAGE with a hint on the merge (SCN-VER-083)", async () => {
    const single = new FakeGit("/repo/.git").init();
    single.commit(tree({ "a.md": "a" }), "base");
    single.commit(tree({ "a.md": "b" }), "next");
    const one = await thrown(() => readMergeHead({ git: single }));
    expect(one.code).toBe("USAGE");
    expect(one.exitCode).toBe(3);
    expect(one.hint).toContain("git merge --no-ff");

    const octopus = new FakeGit("/repo/.git").init();
    octopus.commit(tree({ "a.md": "a" }), "base");
    octopus.createBranch("x");
    octopus.createBranch("y");
    octopus.switchTo("x");
    const x = octopus.commit(tree({ "x.md": "x" }), "x");
    octopus.switchTo("y");
    const y = octopus.commit(tree({ "y.md": "y" }), "y");
    octopus.switchTo("main");
    octopus.commit(tree({ "a.md": "a", "x.md": "x", "y.md": "y" }), "octopus", [x, y]);
    const three = await thrown(() => readCiSubject({ git: octopus }));
    expect(three.code).toBe("USAGE");
    expect(three.message).toContain("3 parents");
    expect(three.hint).toContain("git merge --no-ff");
  });
});

describe("warrant ci: the Change and the kind from the records in the diff", () => {
  it("records of two Changes: TOPOLOGY_VIOLATION naming both, nothing else judged (SCN-VER-077)", async () => {
    const git = merged(
      { "docs/a.md": "a" },
      { "docs/a.md": "a", ".warrant/changes/add-search.json": record("add-search", "PROPOSED"), ".warrant/changes/fix-login.json": record("fix-login", "PROPOSED") }
    );
    const subject = await readCiSubject({ git });
    expect(subject.errors).toHaveLength(1);
    expect(subject.errors[0]?.code).toBe("TOPOLOGY_VIOLATION");
    expect(subject.errors[0]?.message).toContain("add-search, fix-login");
    expect(subject.errors[0]?.hint).toBeDefined();
    expect(subject.kind).toBe("none");
    expect(subject.change).toBeUndefined();
  });

  it("kind by change_state on HEAD; none without a record; a deleted record is RECORD_MISMATCH", async () => {
    const cases: [string, string][] = [
      ["PROPOSED", "spec"],
      ["SPECIFIED", "spec"],
      ["APPROVED", "impl"],
      ["IMPLEMENTING", "impl"],
      ["VERIFYING", "impl"],
      ["MERGED", "archive"],
      ["ARCHIVED", "archive"],
      ["ABANDONED", "abandon"]
    ];
    for (const [state, kind] of cases) {
      const git = merged({ "docs/a.md": "a" }, { "docs/a.md": "a", ".warrant/changes/add-search.json": record("add-search", state) });
      const subject = await readCiSubject({ git });
      expect(subject.errors).toEqual([]);
      expect([subject.change, subject.kind]).toEqual(["add-search", kind]);
      expect(subject.baseRecord).toBeUndefined();
    }

    const none = await readCiSubject({ git: merged({ "docs/a.md": "a" }, { "docs/a.md": "b" }) });
    expect([none.kind, none.change, none.errors]).toEqual(["none", undefined, []]);
    expect(none.diff).toEqual([{ status: "M", path: "docs/a.md" }]);

    const deleted = await readCiSubject({
      git: merged({ ".warrant/changes/add-search.json": record("add-search", "PROPOSED") }, { "docs/a.md": "a" })
    });
    expect(deleted.errors.map((e) => [e.code, e.path])).toEqual([["RECORD_MISMATCH", ".warrant/changes/add-search.json"]]);
  });
});

describe("warrant ci: the base of requirements (I-171)", () => {
  it("disposes the checkout of HEAD^1 when loading or judging throws", async () => {
    const git = merged({ "docs/a.md": "a" }, { "docs/a.md": "b" });
    const noConfig = await thrown(() => withBase({ git }, "HEAD^1", () => Promise.resolve("never")));
    expect(noConfig.code).toBe("CONFIG_MISSING");
    expect(git.checkouts).toHaveLength(1);
    expect(git.checkouts[0]?.disposed).toBe(true);
    expect(existsSync(git.checkouts[0]?.dir as string)).toBe(false);

    const unknown = await thrown(() => withBase({ git }, "no-such-ref", () => Promise.resolve("never")));
    expect(unknown.code).toBe("USAGE");
    expect(git.checkouts).toHaveLength(1);
  });
});
