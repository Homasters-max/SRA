// e2e: argv
/**
 * `warrant verify` through the binary in a temporary git repository: `<change>`
 * and `--transition` of argv reach the command, and the exit code follows the
 * controller — 0 on CONTINUE, 2 on WAIT, 3 on a usage error. The verification
 * itself (REQ-VER-006, REQ-KRN-027; SCN-VER-027, 028, SCN-KRN-101) is tested in
 * the test process: `test/app/commands/verify.test.ts` (ADR-0025, task 5.3).
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { runCli, type CliRun } from "../helpers/cli.js";
import { PACKS, record, useSyncedProject, write } from "../helpers/synced.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const project = useSyncedProject();

function git(cwd: string, ...args: string[]): void {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
}

describe.skipIf(!hasGit)("warrant verify (argv)", () => {
  it("maps <change> and --transition; exit 2 on WAIT, 0 on CONTINUE, 3 on a usage error", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "APPROVED", { classification: { profiles: ["feature"] } }));
    git(root, "-c", "init.defaultBranch=main", "init", "--quiet");
    git(root, "config", "user.name", "warrant-test");
    git(root, "config", "user.email", "test@example.invalid");
    git(root, "checkout", "--quiet", "-B", "main");
    git(root, "add", "-A");
    git(root, "commit", "--quiet", "-m", "base");
    const verify = (...args: string[]): Promise<CliRun> =>
      runCli(["verify", "add-search", ...args], root, { WARRANT_PACKS_DIR: PACKS, GITHUB_ACTIONS: "" });

    // APPROVED->IMPLEMENTING has no check to run, only branch-isolated.
    const onMain = await verify();
    expect(onMain.json?.data).toMatchObject({ transition: "APPROVED->IMPLEMENTING", gates: { "branch-isolated": "FAIL" } });
    expect(onMain.json?.data.controller_action).toBe("WAIT");
    expect(onMain.status).toBe(2);

    git(root, "checkout", "--quiet", "-b", "worktree/add-search");
    const onBranch = await verify("--transition", "APPROVED->IMPLEMENTING");
    expect(onBranch.json?.errors).toEqual([]);
    expect(onBranch.json?.data.gates).toEqual({ "branch-isolated": "PASS" });
    expect(onBranch.json?.data.controller_action).toBe("CONTINUE");
    expect(onBranch.status).toBe(0);

    const bad = await verify("--transition", "APPROVED->MERGED");
    expect(bad.json?.errors[0].code).toBe("USAGE");
    expect(bad.status).toBe(3);
  }, 60_000);
});
