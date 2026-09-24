/**
 * Form of the test levels (ADR-0025 п. 1, 7): every test file lies in one of
 * the four level directories, each directory is exactly one vitest project,
 * only `src/adapters/**` of the CLI names a process module (п. 3, design §8),
 * and the `unit` level cannot start a process (п. 7a; the same guard for `app`
 * is `test/app/meta/spawn-guard.test.ts`).
 */
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import crossSpawn from "cross-spawn";
import { describe, expect, it } from "vitest";

import config, { LEVELS } from "../../../vitest.config.js";
import { CLI_ROOT, makeTempDir, removeDir, runCli } from "../../helpers/cli.js";

const TEST_ROOT = path.join(CLI_ROOT, "test");

/** Every `*.test.ts` under `test/`, as a POSIX path relative to it. */
function testFiles(dir = TEST_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(full));
    else if (entry.name.endsWith(".test.ts")) out.push(path.relative(TEST_ROOT, full).split(path.sep).join("/"));
  }
  return out;
}

describe("test levels: layout (ADR-0025 п. 1, 7c)", () => {
  it("every test file lies in a level directory", () => {
    const outside = testFiles().filter((file) => !(LEVELS as readonly string[]).includes(file.split("/")[0] ?? ""));
    expect(outside, "test files outside test/{unit,app,contract,e2e}/ run in no project").toEqual([]);
  });

  it("each level is one vitest project over its own directory", () => {
    const projects = (config.test?.projects ?? []) as { test: { name: string; include: string[] } }[];
    expect(projects.map((p) => [p.test.name, p.test.include])).toEqual(LEVELS.map((level) => [level, [`test/${level}/**/*.test.ts`]]));
  });
});

const SRC_ROOT = path.join(CLI_ROOT, "src");

/** Every `*.ts` under `src/`, as a POSIX path relative to it. */
function sourceFiles(dir = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(path.relative(SRC_ROOT, full).split(path.sep).join("/"));
  }
  return out;
}

/** A module that starts processes, named as a string: `import`, `import type`, `import()`, `require()`. */
const PROCESS_MODULE = /["'](?:node:)?child_process["']|["']cross-spawn["']/;

describe("processes only in src/adapters (ADR-0025 п. 3, design §2, §8)", () => {
  it("no file outside src/adapters/ names node:child_process or cross-spawn", () => {
    const files = sourceFiles();
    expect(files.filter((file) => file.startsWith("adapters/")).length).toBeGreaterThan(0);
    const offending = files.filter(
      (file) => !file.startsWith("adapters/") && PROCESS_MODULE.test(readFileSync(path.join(SRC_ROOT, ...file.split("/")), "utf8"))
    );
    expect(offending, "processes are started only by the adapters of the ports").toEqual([]);
  });

  it("the pattern catches every form of naming the modules", () => {
    for (const line of [
      `import { spawnSync } from "node:child_process";`,
      `import type { ChildProcess } from 'child_process';`,
      `import spawnCjs from "cross-spawn";`,
      `const cp = require("child_process");`,
      `type S = typeof import("cross-spawn");`
    ]) {
      expect(PROCESS_MODULE.test(line), line).toBe(true);
    }
    expect(PROCESS_MODULE.test("// `cross-spawn` resolves `.cmd` shims")).toBe(false);
  });
});

describe("test levels: no processes in unit (ADR-0025 п. 7a)", () => {
  const FORBIDDEN = /SPAWN_FORBIDDEN_AT_LEVEL/;

  it("node:child_process throws SPAWN_FORBIDDEN_AT_LEVEL", () => {
    expect(() => spawnSync(process.execPath, ["--version"])).toThrow(FORBIDDEN);
    expect(() => spawn(process.execPath, ["--version"])).toThrow(FORBIDDEN);
  });

  it("cross-spawn throws SPAWN_FORBIDDEN_AT_LEVEL", () => {
    expect(() => crossSpawn.sync("git", ["--version"])).toThrow(FORBIDDEN);
    expect(() => crossSpawn("git", ["--version"])).toThrow(FORBIDDEN);
  });

  it("a process started by an imported module is caught too", async () => {
    const dir = makeTempDir("warrant-unit-levels-");
    try {
      await expect(runCli(["--version"], dir)).rejects.toThrow(FORBIDDEN);
    } finally {
      removeDir(dir);
    }
  });
});
