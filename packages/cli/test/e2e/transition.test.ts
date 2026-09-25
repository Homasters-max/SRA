// e2e: argv
/**
 * `warrant transition` through the binary in a temporary git repository:
 * `<change> <state>`, `--ref`, `--by` and `--commit` of argv reach the command,
 * and the exit codes — 0 on a recorded transition, 2 when its gates refuse,
 * 3 on an error. The transitions themselves (REQ-VER-007; SCN-VER-029–035,
 * 046, 050–052) are tested in the test process:
 * `test/app/commands/transition.test.ts` (ADR-0025, task 5.1).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCli, type CliRun } from "../helpers/cli.js";
import { git } from "../helpers/git.js";
import { PACKS, record, useSyncedProject, write } from "../helpers/synced.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const project = useSyncedProject();
const REVIEW = "https://github.com/o/r/pull/7#pullrequestreview-1";

describe.skipIf(!hasGit)("warrant transition (argv)", () => {
  it("maps <state>, --ref, --by and --commit; exit 0 when recorded, 2 when the gates refuse, 3 on an error", async () => {
    const root = project();
    const recordFile = path.join(root, ".warrant", "changes", "add-search.json");
    write(root, ".warrant/changes/add-search.json", record("add-search", "VERIFYING", { classification: { profiles: ["feature"] } }));
    git(root, "-c", "init.defaultBranch=main", "init", "--quiet");
    git(root, "config", "user.name", "warrant-test");
    git(root, "config", "user.email", "test@example.invalid");
    git(root, "checkout", "--quiet", "-B", "main");
    git(root, "add", "-A");
    git(root, "commit", "--quiet", "-m", "base");
    const transition = (...args: string[]): Promise<CliRun> =>
      runCli(["transition", "add-search", ...args], root, { WARRANT_PACKS_DIR: PACKS, GITHUB_ACTIONS: "" });

    // Backward moves have no gates: recorded, exit 0.
    const back = await transition("IMPLEMENTING");
    expect(back.json?.errors).toEqual([]);
    expect(back.json?.data.transition).toBe("VERIFYING->IMPLEMENTING");
    expect(back.status).toBe(0);
    expect((await transition("SPECIFIED")).status).toBe(0);
    expect(JSON.parse(readFileSync(recordFile, "utf8")).change_state).toBe("SPECIFIED");

    // --commit, --ref and --by reach the command.
    const commitOutside = await transition("APPROVED", "--ref", REVIEW, "--by", "kat", "--commit", "HEAD");
    expect(commitOutside.json?.errors[0].code).toBe("USAGE");
    expect(commitOutside.json?.errors[0].message).toContain("--commit");
    expect(commitOutside.status).toBe(3);
    const noRef = await transition("APPROVED", "--by", "kat");
    expect(noRef.json?.errors[0].code).toBe("USAGE");
    expect(noRef.status).toBe(3);
    const bob = await transition("APPROVED", "--ref", REVIEW, "--by", "bob");
    expect(bob.json?.errors[0].code).toBe("ROLE_REQUIRED");
    expect(bob.status).toBe(3);

    // No spec-report: the approval of --ref/--by is written, the gates refuse, exit 2.
    const refused = await transition("APPROVED", "--ref", REVIEW, "--by", "kat");
    expect(refused.json?.errors[0].code).toBe("GATES_NOT_PASSED");
    expect(refused.json?.data.gates["human-approval"]).toBe("PASS");
    expect(refused.status).toBe(2);
    expect(JSON.parse(readFileSync(recordFile, "utf8")).change_state).toBe("SPECIFIED");
  }, 60_000);
});
