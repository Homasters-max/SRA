// e2e: argv
/**
 * `warrant classify` through the binary in a temporary git repository:
 * `<change>`, `--base`, `--paths`, `--propose`, repeatable `--set`, `--by` and
 * `--ref` of argv reach the command, the changed paths come from the diff of
 * the real `git` (SCN-KRN-073), and the exit code is 0 on success and 3 on a
 * refusal. The classification itself (REQ-KRN-027, REQ-KRN-028; SCN-KRN-073..077,
 * 105..107, 116, 117) is tested in the test process:
 * `test/app/commands/classify.test.ts` (ADR-0025, task 5.4).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { CORE_SDD_RANGE, makeTempDir, removeDir, runCli } from "../helpers/cli.js";
import { git } from "../helpers/git.js";
import { write } from "../helpers/synced.js";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

const hasGit = spawnSync("git", ["--version"]).status === 0;

describe.skipIf(!hasGit)("warrant classify (argv)", () => {
  it("maps <change>, --base, --paths, --propose, repeatable --set, --by and --ref; exit 0, and 3 on a refusal (SCN-KRN-073, SCN-KRN-105)", async () => {
    const root = makeTempDir("warrant-classify-");
    tempDirs.push(root);
    write(root, ".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { "core-sdd": { version: CORE_SDD_RANGE } },
      roles: { maintainer: ["kat"] }
    });
    write(root, ".warrant/changes/add-search.json", {
      $schema: "warrant://change-record/1",
      change: "add-search",
      change_state: "PROPOSED",
      transitions: [{ to: "PROPOSED", at: "2026-09-22T00:00:00.000Z", by: "cli:test" }]
    });
    git(root, "init");
    git(root, "symbolic-ref", "HEAD", "refs/heads/main");
    git(root, "config", "user.email", "test@example.invalid");
    git(root, "config", "user.name", "test");
    git(root, "config", "commit.gpgsign", "false");
    git(root, "add", "-A");
    git(root, "commit", "-m", "base");
    git(root, "checkout", "-b", "work");
    write(root, ".warrant/local/areas.json", { $schema: "warrant://areas/1", KRN: { capability: "kernel" } });
    git(root, "add", "-A");
    git(root, "commit", "-m", "areas");

    // --base: the diff of the real git against main.
    const fromGit = await runCli(["classify", "add-search", "--base", "main"], root);
    expect(fromGit.json?.errors).toEqual([]);
    expect(fromGit.status).toBe(0);
    expect(fromGit.json?.change).toBe("add-search");
    expect(fromGit.json?.data.changed).toEqual([".warrant/local/areas.json"]);
    expect(fromGit.json?.data.classification.risk.blast_radius).toEqual({ value: "SYSTEM", from: "floor:core-sdd:2" });

    // --paths, --propose, --set twice, --by.
    write(root, "changed.txt", "src/search.ts\n");
    const human = await runCli(
      [
        "classify",
        "add-search",
        "--paths",
        "changed.txt",
        "--propose",
        '{"risk":{"data_loss":"LOW"}}',
        "--set",
        "security_impact=HIGH",
        "--set",
        "profile=feature",
        "--by",
        "kat"
      ],
      root
    );
    expect(human.json?.errors).toEqual([]);
    expect(human.status).toBe(0);
    expect(human.json?.data.changed).toEqual(["src/search.ts"]);
    // factory-change of the first run stays, from "record" (monotonic, SCN-KRN-075).
    expect(human.json?.data.profiles).toEqual([
      { id: "factory-change", from: "record" },
      { id: "feature", from: "human:kat" }
    ]);
    const stored = JSON.parse(readFileSync(path.join(root, ".warrant", "changes", "add-search.json"), "utf8"));
    expect(stored.classification.risk.security_impact).toEqual({ value: "HIGH", from: "human:kat" });
    expect(stored.classification.risk.data_loss).toEqual({ value: "LOW", from: "proposer" });

    // --ref that is not a URL: a refusal, exit 3.
    const notUrl = await runCli(
      ["classify", "add-search", "--paths", "changed.txt", "--set", "blast_radius=LOCAL", "--by", "kat", "--ref", "PR 7"],
      root
    );
    expect(notUrl.json?.errors[0].code).toBe("USAGE");
    expect(notUrl.status).toBe(3);
  }, 60_000);
});
