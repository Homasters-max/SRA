// e2e: platform-spawn
/**
 * `warrant check` through the binary: a check that outlives `timeout_s` is
 * stopped with its whole process tree — the child and the grandchild it
 * spawned — and the exclusive lock is freed (SCN-VER-009). Only real processes
 * of the platform show the kill of the tree. The rest of the check
 * (REQ-VER-001, REQ-VER-002; SCN-VER-001, 003–008, 010, 011, 040–042) is tested
 * in the test process: `test/app/commands/check.test.ts` (ADR-0025, task 5.3).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { makeTempDir, removeDir, runCli } from "../helpers/cli.js";
import { git } from "../helpers/git.js";
import { PACKS, record, useSyncedProject, write } from "../helpers/synced.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const project = useSyncedProject();

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

const NODE = process.execPath;
const EVIDENCE = ".warrant/evidence/add-search";

function recordFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.startsWith("EVID-"));
  } catch {
    return [];
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitDead(pid: number, ms = 10_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !alive(pid);
}

describe.skipIf(!hasGit)("warrant check (platform)", () => {
  it("stops a check at its timeout, kills its process tree and frees the lock (SCN-VER-009)", async () => {
    const code = [
      "const cp = require('child_process');",
      "const g = cp.spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' });",
      "require('fs').writeFileSync(process.env.FAKE_PIDS, JSON.stringify([process.pid, g.pid]));",
      "setTimeout(()=>{}, 60000);"
    ].join(" ");
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "PROPOSED"));
    write(root, ".warrant/local/checks/tests-passed.json", {
      $schema: "warrant://check/1",
      id: "tests-passed",
      version: "1.0.0",
      overrides: "core-sdd:tests-passed",
      level: "L1",
      run: { command: [NODE, "-e", code] },
      execution: { exclusive: true, timeout_s: 1 }
    });
    git(root, "init", "--quiet");
    git(root, "checkout", "--quiet", "-b", "main");
    git(root, "add", "-A");
    git(root, "commit", "--quiet", "-m", "fixture");
    const pidsDir = makeTempDir("warrant-check-pids-");
    tempDirs.push(pidsDir);
    const pids = path.join(pidsDir, "pids.json");

    const started = Date.now();
    const run = await runCli(["check", "add-search", "tests-passed"], root, {
      WARRANT_PACKS_DIR: PACKS,
      GITHUB_ACTIONS: "",
      FAKE_PIDS: pids
    });
    expect(run.status).toBe(3);
    expect(run.json.errors[0].code).toBe("CHECK_TIMEOUT");
    expect(Date.now() - started).toBeLessThan(30_000);

    expect(existsSync(path.join(root, ".git", "warrant", "check.lock"))).toBe(false);
    expect(recordFiles(path.join(root, EVIDENCE))).toEqual([]);
    expect(existsSync(path.join(root, EVIDENCE, "manifest.json"))).toBe(false);
    const [child, grandchild] = JSON.parse(readFileSync(pids, "utf8")) as [number, number];
    expect(await waitDead(child)).toBe(true);
    expect(await waitDead(grandchild)).toBe(true);
  }, 60_000);
});
