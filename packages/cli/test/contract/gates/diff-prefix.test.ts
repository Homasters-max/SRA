/**
 * I-100: the project prefix comes from git, not from comparing paths. A project
 * reached through a symlink (or, on Windows CI, an 8.3 short temp path) spells
 * its directory differently from `git rev-parse --show-toplevel`; the diff must
 * still keep every path of the project.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { GitCli } from "../../../src/adapters/git-cli.js";
import { changedPaths, projectPrefix, readGitFacts } from "../../../src/core/gates/diff.js";
import { makeTempDir, removeDir } from "../../helpers/cli.js";

const temp: string[] = [];
afterAll(() => temp.forEach(removeDir));

function git(cwd: string, ...args: string[]): void {
  const run = spawnSync("git", ["-c", "user.name=warrant-test", "-c", "user.email=test@example.invalid", ...args], {
    cwd,
    encoding: "utf8"
  });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text, "utf8");
}

const hasGit = spawnSync("git", ["--version"]).status === 0;

describe.skipIf(!hasGit)("project prefix and diff through a differently spelled path (I-100)", () => {
  it("keeps the changed paths of a project reached through a link", async () => {
    const repo = makeTempDir("warrant-prefix-");
    temp.push(repo);
    write(repo, "proj/a.txt", "a\n");
    git(repo, "-c", "init.defaultBranch=main", "init", "--quiet");
    git(repo, "checkout", "--quiet", "-B", "main");
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "base");
    git(repo, "checkout", "--quiet", "-b", "work");
    write(repo, "proj/src/b.ts", "export {};\n");
    write(repo, "outside.txt", "x\n");
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "work");

    const linkParent = makeTempDir("warrant-prefix-link-");
    temp.push(linkParent);
    const link = path.join(linkParent, "linked-proj");
    // A junction needs no privilege on Windows; elsewhere the type is ignored.
    symlinkSync(path.join(repo, "proj"), link, "junction");

    const ctx = { git: new GitCli(link) };
    expect(await projectPrefix(ctx)).toBe("proj");
    const diff = await changedPaths(ctx, await readGitFacts(ctx, undefined));
    expect(diff).toEqual({ ok: true, value: [{ status: "A", path: "src/b.ts" }] });
  });
});
