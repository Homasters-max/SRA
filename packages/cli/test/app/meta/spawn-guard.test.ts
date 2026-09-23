/**
 * The `app` level cannot start a process (ADR-0025 п. 7a): commands run in the
 * test process with fake ports; a test that reaches a real `openspec`, `git` or
 * child process fails with SPAWN_FORBIDDEN_AT_LEVEL.
 */
import { spawnSync } from "node:child_process";
import crossSpawn from "cross-spawn";
import { describe, expect, it } from "vitest";

describe("test levels: no processes in app (ADR-0025 п. 7a)", () => {
  it("node:child_process and cross-spawn throw SPAWN_FORBIDDEN_AT_LEVEL", () => {
    expect(() => spawnSync(process.execPath, ["--version"])).toThrow(/SPAWN_FORBIDDEN_AT_LEVEL/);
    expect(() => crossSpawn.sync("git", ["--version"])).toThrow(/SPAWN_FORBIDDEN_AT_LEVEL/);
  });
});
