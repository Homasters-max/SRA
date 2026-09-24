/**
 * `core/check`: placeholders (design §2), the exclusive lock (§3) and the
 * runner (§4) — REQ-VER-002. The process-tree kill on timeout is covered
 * end to end by SCN-VER-009 in `test/e2e/check.test.ts`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { acquireLock, lockPath } from "../../../src/core/check/lock.js";
import { expandArgv, splitPaths } from "../../../src/core/check/placeholders.js";
import { runCommand } from "../../../src/adapters/check-runner.js";
import { WarrantError } from "../../../src/core/errors.js";
import { makeTempDir, removeDir } from "../../helpers/cli.js";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

function temp(): string {
  const dir = makeTempDir("warrant-unit-check-");
  tempDirs.push(dir);
  return dir;
}

describe("expandArgv", () => {
  const values = { out: ".warrant/evidence/add-search/raw/tests-passed", change: "add-search" };

  it("substitutes {out} and {change} inside elements", () => {
    expect(expandArgv(["openspec", "validate", "{change}", "--strict", "--json"], values)).toEqual([
      "openspec",
      "validate",
      "add-search",
      "--strict",
      "--json"
    ]);
    expect(expandArgv(["pytest", "--junitxml={out}/junit.xml", "-k", "{change}-{change}"], values)).toEqual([
      "pytest",
      "--junitxml=.warrant/evidence/add-search/raw/tests-passed/junit.xml",
      "-k",
      "add-search-add-search"
    ]);
  });

  it("expands a whole {paths} element into one element per path (SCN-VER-010)", () => {
    expect(expandArgv(["mutmut", "run", "{paths}", "--out={out}"], { ...values, paths: ["src/a.py", "src/b py.py"] })).toEqual([
      "mutmut",
      "run",
      "src/a.py",
      "src/b py.py",
      "--out=.warrant/evidence/add-search/raw/tests-passed"
    ]);
  });

  it("refuses {paths} inside a longer element, and {paths} without --paths, with USAGE", () => {
    const embedded = (): string[] => expandArgv(["tool", "--files={paths}"], { ...values, paths: ["a"] });
    expect(embedded).toThrow(WarrantError);
    try {
      embedded();
    } catch (thrown) {
      expect((thrown as WarrantError).code).toBe("USAGE");
    }
    expect(() => expandArgv(["tool", "{paths}"], values)).toThrow(/no --paths/);
  });

  it("leaves code braces alone (I-67)", () => {
    const code = "setTimeout(()=>{}, 60000); const o = { a: 1 };";
    expect(expandArgv(["node", "-e", code], values)).toEqual(["node", "-e", code]);
  });

  it("splits --paths on commas, trimming and dropping empty entries", () => {
    expect(splitPaths("src/a.py, src/b.py,,")).toEqual(["src/a.py", "src/b.py"]);
  });
});

describe("exclusive lock", () => {
  const holder = { pid: process.pid, check: "tests-passed", started_at: "2026-09-22T10:00:00.000Z", cwd: "/p" };

  it("lives under <git-common-dir>/warrant/, or in .warrant/ of the project with a warning outside git", () => {
    const root = path.resolve("/project");
    expect(lockPath(root, path.join(root, ".git"))).toEqual({ file: path.join(root, ".git", "warrant", "check.lock") });
    const fallback = lockPath(root, null);
    expect(fallback.file).toBe(path.join(root, ".warrant", "check.lock"));
    expect(fallback.warning).toMatch(/not a git repository/);
  });

  it("is taken once, reports its holder while held and is free again after release", () => {
    const file = path.join(temp(), "git", "warrant", "check.lock");
    const first = acquireLock(file, holder);
    expect(first.ok).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(holder);

    const second = acquireLock(file, { ...holder, pid: 1, check: "other" });
    expect(second).toEqual({ ok: false, holder });

    if (!first.ok) throw new Error("unreachable");
    first.release();
    first.release(); // idempotent
    expect(existsSync(file)).toBe(false);

    const third = acquireLock(file, holder);
    expect(third.ok).toBe(true);
    if (third.ok) third.release();
  });

  it("reports an unreadable holder as null rather than failing", () => {
    const file = path.join(temp(), "check.lock");
    writeFileSync(file, "", "utf8");
    expect(acquireLock(file, holder)).toEqual({ ok: false, holder: null });
  });
});

describe("runCommand", () => {
  const node = process.execPath;

  it("runs argv without a shell and captures stdout and the exit code", async () => {
    const cwd = temp();
    const outcome = await runCommand({
      argv: [node, "-e", "process.stdout.write(process.argv[1] + '\\n' + process.cwd()); process.exitCode = 3", "a b;&|$x"],
      cwd,
      timeoutMs: 20_000,
      captureStdout: true
    });
    expect(outcome.kind).toBe("exited");
    if (outcome.kind !== "exited") return;
    expect(outcome.code).toBe(3);
    const [arg, dir] = outcome.stdout.split("\n");
    expect(arg).toBe("a b;&|$x");
    expect(path.resolve(dir as string).toLowerCase()).toBe(path.resolve(cwd).toLowerCase());
  }, 30_000);

  it("forwards stdout instead of capturing it when the parser does not read it", async () => {
    const chunks: string[] = [];
    const outcome = await runCommand({
      argv: [node, "-e", "process.stdout.write('forwarded')"],
      cwd: temp(),
      timeoutMs: 20_000,
      captureStdout: false,
      forward: (chunk) => chunks.push(chunk.toString("utf8"))
    });
    expect(outcome).toEqual({ kind: "exited", code: 0, signal: null, stdout: "" });
    expect(chunks.join("")).toBe("forwarded");
  }, 30_000);

  it("stops a command that outlives its timeout", async () => {
    const started = Date.now();
    const outcome = await runCommand({
      argv: [node, "-e", "setTimeout(()=>{}, 60000)"],
      cwd: temp(),
      timeoutMs: 500,
      captureStdout: true
    });
    expect(outcome).toEqual({ kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);

  it("reports a command that cannot start", async () => {
    const outcome = await runCommand({
      argv: ["warrant-no-such-command-5f1c"],
      cwd: temp(),
      timeoutMs: 20_000,
      captureStdout: true
    });
    expect(outcome.kind).toBe("spawn-error");
  }, 30_000);
});
