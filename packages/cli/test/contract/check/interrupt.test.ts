/**
 * `adapters/signals.ts` (review of phase 3, R-3; A-12): a hang-up — the
 * terminal closed under `warrant check` — releases the exclusive lock like
 * SIGINT and SIGTERM do. Run in a child process on the built CLI, because the
 * handler ends the process it runs in.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { CLI_ROOT, makeTempDir, removeDir } from "../../helpers/cli.js";

const DIST = path.join(CLI_ROOT, "dist");
const WIN = process.platform === "win32";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

/** Takes the lock in a child, raises `signal` there, returns how the child ended. */
function interrupted(signal: string): { lock: string; status: number | null; signal: NodeJS.Signals | null; stdout: string } {
  const dir = makeTempDir("warrant-unit-interrupt-");
  tempDirs.push(dir);
  const lock = path.join(dir, "check.lock");
  const url = (file: string): string => pathToFileURL(path.join(DIST, file)).href;
  const script = `
    import { writeSync } from "node:fs";
    import { acquireLock } from ${JSON.stringify(url(path.join("core", "check", "lock.js")))};
    import { processSignals } from ${JSON.stringify(url(path.join("adapters", "signals.js")))};
    const taken = acquireLock(${JSON.stringify(lock)}, { pid: process.pid, check: "t", started_at: "", cwd: "" }, processSignals);
    if (!taken.ok) process.exit(9);
    writeSync(1, "locked\\n");
    setTimeout(() => {}, 10_000);
    // Windows cannot deliver a hang-up to itself; the handler is what is tested there.
    if (process.platform === "win32") process.emit(${JSON.stringify(signal)}, ${JSON.stringify(signal)});
    else process.kill(process.pid, ${JSON.stringify(signal)});
  `;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 20_000 });
  return { lock, status: run.status, signal: run.signal, stdout: run.stdout };
}

describe("onInterrupt", () => {
  it.skipIf(!existsSync(path.join(DIST, "adapters", "signals.js")))("releases the lock on SIGHUP and ends by the signal (R-3)", () => {
    const run = interrupted("SIGHUP");
    expect(run.stdout).toBe("locked\n");
    expect(existsSync(run.lock)).toBe(false);
    if (WIN) expect(run.status).toBe(129);
    else expect(run.signal).toBe("SIGHUP");
  });

  it.skipIf(!WIN || !existsSync(path.join(DIST, "adapters", "signals.js")))("releases the lock on SIGBREAK on Windows (R-3)", () => {
    const run = interrupted("SIGBREAK");
    expect(existsSync(run.lock)).toBe(false);
    expect(run.status).toBe(149);
  });
});
