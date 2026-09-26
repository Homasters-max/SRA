// e2e: argv
/**
 * `warrant gate` through the binary in a temporary git repository: gate ids and
 * `--transition` of argv reach the command, and the exit code follows the
 * controller — 0 on CONTINUE, 2 on WAIT, 3 on a usage error. The gates
 * themselves (REQ-VER-003, REQ-VER-004, REQ-VER-005; SCN-VER-013, 014, 019–024,
 * 039, 046–049) are tested in the test process: `test/app/commands/gate.test.ts`
 * (ADR-0025, task 5.1).
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { runCli, type CliRun } from "../helpers/cli.js";
import { git } from "../helpers/git.js";
import { PACKS, recordDoc, useSyncedProject, write } from "../helpers/synced.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const project = useSyncedProject();

describe.skipIf(!hasGit)("warrant gate (argv)", () => {
  it("maps gate ids and --transition; exit 2 on WAIT, 0 on CONTINUE, 3 on a usage error", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", recordDoc("add-search", "APPROVED", { classification: { profiles: ["feature"] } }));
    git(root, "-c", "init.defaultBranch=main", "init", "--quiet");
    git(root, "config", "user.name", "warrant-test");
    git(root, "config", "user.email", "test@example.invalid");
    git(root, "checkout", "--quiet", "-B", "main");
    git(root, "add", "-A");
    git(root, "commit", "--quiet", "-m", "base");
    const gate = (...args: string[]): Promise<CliRun> =>
      runCli(["gate", "add-search", ...args], root, { WARRANT_PACKS_DIR: PACKS, GITHUB_ACTIONS: "" });

    const onMain = await gate("--transition", "APPROVED->IMPLEMENTING");
    expect(onMain.json?.data).toMatchObject({ transition: "APPROVED->IMPLEMENTING", gates: { "branch-isolated": "FAIL" } });
    expect(onMain.json?.data.controller_action).toBe("WAIT");
    expect(onMain.status).toBe(2);

    git(root, "checkout", "--quiet", "-b", "worktree/add-search");
    const onBranch = await gate("branch-isolated");
    expect(onBranch.json?.errors).toEqual([]);
    expect(onBranch.json?.data.gates).toEqual({ "branch-isolated": "PASS" });
    expect(onBranch.status).toBe(0);

    const outside = await gate("scope-valid");
    expect(outside.json?.errors[0].code).toBe("USAGE");
    expect(outside.status).toBe(3);
    const bad = await gate("--transition", "APPROVED->MERGED");
    expect(bad.json?.errors[0].code).toBe("USAGE");
    expect(bad.status).toBe(3);
  }, 60_000);
});
