/**
 * Form of the test levels (ADR-0025 п. 1, 7): every test file lies in one of
 * the four level directories, each directory is exactly one vitest project,
 * `unit`/`app` run before `contract`/`e2e` (I-138), every e2e file names its reason on the first line (п. 7b), only `src/adapters/**` of the CLI names a process module (п. 3, design §8),
 * the `unit` level cannot start a process (п. 7a; the same guard for `app`
 * is `test/app/meta/spawn-guard.test.ts`), and `contract`/`e2e` fail rather
 * than skip without openspec 1.13.1 (п. 5).
 */
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import crossSpawn from "cross-spawn";
import { describe, expect, it } from "vitest";

import config, { LEVELS } from "../../../vitest.config.js";
import { CLI_ROOT, makeTempDir, removeDir, runCli } from "../../helpers/cli.js";
import { OPENSPEC_VERSION } from "../../helpers/openspec.js";
import { openspecVersionProblem } from "../../helpers/require-openspec.js";

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

  it("unit and app run before contract and e2e, not under their processes (I-138)", () => {
    const projects = (config.test?.projects ?? []) as { test: { name: string; sequence?: { groupOrder?: number } } }[];
    const order = new Map(projects.map((p) => [p.test.name, p.test.sequence?.groupOrder ?? 0]));
    const light = Math.max(order.get("unit") ?? 0, order.get("app") ?? 0);
    const heavy = Math.min(order.get("contract") ?? 0, order.get("e2e") ?? 0);
    expect(heavy, "a heavy level in the group of unit/app runs its processes next to tests with a 5 s limit").toBeGreaterThan(light);
  });
});

/** The closed list of reasons a test stays in e2e (ADR-0025 п. 7b). */
const E2E_REASONS = ["argv", "exit-codes", "output", "platform-spawn", "golden", "package", "lifecycle"] as const;
const E2E_HEADER = new RegExp(`^// e2e: (?:${E2E_REASONS.join("|")})\\r?$`);

describe("test levels: every e2e file names its reason (ADR-0025 п. 7b)", () => {
  it("each file of test/e2e/ starts with `// e2e: <reason>` from the closed list", () => {
    const e2e = testFiles().filter((file) => file.startsWith("e2e/"));
    expect(e2e.length).toBeGreaterThan(0);
    const missing = e2e.filter(
      (file) => !E2E_HEADER.test(readFileSync(path.join(TEST_ROOT, ...file.split("/")), "utf8").split("\n", 1)[0] ?? "")
    );
    expect(missing, `first line // e2e: <${E2E_REASONS.join(" | ")}>`).toEqual([]);
  });

  it("the header pattern admits only a listed reason on the first line", () => {
    for (const reason of E2E_REASONS) expect(E2E_HEADER.test(`// e2e: ${reason}`), reason).toBe(true);
    for (const line of ["// e2e: slow", "// e2e:argv", "// e2e: argv, output", "/** e2e: argv */", " // e2e: argv"]) {
      expect(E2E_HEADER.test(line), line).toBe(false);
    }
  });
});

describe("contract and e2e need openspec 1.13.1, they are not skipped without it (ADR-0025 п. 5)", () => {
  it("contract and e2e, and only they, check the version in globalSetup", () => {
    const projects = (config.test?.projects ?? []) as { test: { name: string; globalSetup?: string[] } }[];
    expect(projects.map((p) => [p.test.name, p.test.globalSetup ?? []])).toEqual([
      ["unit", []],
      ["app", []],
      ["contract", ["test/helpers/require-openspec.ts"]],
      // e2e also packs the checkout once, before any test (WS-30)
      ["e2e", ["test/helpers/require-openspec.ts", "test/helpers/pack-checkout.ts"]]
    ]);
  });

  it("no test is skipped for want of openspec", () => {
    const skipping = testFiles().filter((file) =>
      /skipIf\([^)]*openspec/i.test(readFileSync(path.join(TEST_ROOT, ...file.split("/")), "utf8"))
    );
    expect(skipping, "a missing or wrong openspec fails the run in globalSetup; skipIf would hide the contract").toEqual([]);
  });

  it("the version check names what it found and what to install", () => {
    expect(openspecVersionProblem(`${OPENSPEC_VERSION}\n`)).toBeNull();
    expect(openspecVersionProblem(null)).toMatch(new RegExp(`need openspec ${OPENSPEC_VERSION}.*no \`openspec\` on PATH`));
    expect(openspecVersionProblem("1.14.0\n")).toMatch(/found openspec 1\.14\.0 on PATH; install it with `npm i -g @fission-ai\/openspec@1\.13\.1`/);
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
