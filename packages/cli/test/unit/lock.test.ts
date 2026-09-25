/**
 * `core/lock.ts` — the one lock primitive (design §5, A-12, F18): `O_EXCL`
 * file with its holder, a repeated attempt until the deadline, release —
 * idempotent and also on an interrupt through `ctx.signals`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { lockHolder, takeLock, waitForLock } from "../../src/core/lock.js";
import type { SignalsPort } from "../../src/core/ports/signals.js";
import { makeTempDir, removeDir } from "../helpers/cli.js";

const dirs: string[] = [];
afterAll(() => dirs.forEach(removeDir));
function lockIn(): string {
  const dir = makeTempDir("warrant-unit-lock-");
  dirs.push(dir);
  return path.join(dir, "runs", "RUN-X.lock");
}

/** Signals of a test: the registered cleanups, run by `interrupt()`. */
function signals(): SignalsPort & { cleanups: (() => void)[]; interrupt(): void } {
  const cleanups: (() => void)[] = [];
  return {
    cleanups,
    onInterrupt(cleanup) {
      cleanups.push(cleanup);
      return () => {
        const i = cleanups.lastIndexOf(cleanup);
        if (i >= 0) cleanups.splice(i, 1);
      };
    },
    interrupt() {
      while (cleanups.length > 0) (cleanups.pop() as () => void)();
    }
  };
}

describe("takeLock", () => {
  it("creates the file with its directory and the holder, answers the holder while held, is free after release", () => {
    const file = lockIn();
    const s = signals();
    const holder = lockHolder("run finish");
    expect(holder).toEqual({ pid: process.pid, what: "run finish", at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });

    const first = takeLock(file, holder, s);
    expect(first.ok).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(holder);
    expect(s.cleanups).toHaveLength(1);
    expect(takeLock(file, lockHolder("guard"), s)).toEqual({ ok: false, holder });

    if (!first.ok) throw new Error("unreachable");
    first.release();
    first.release(); // idempotent
    expect(existsSync(file)).toBe(false);
    expect(s.cleanups).toHaveLength(0);
  });

  it("an interrupt releases a lock taken (A-12: the cleanup goes through the port)", () => {
    const file = lockIn();
    const s = signals();
    expect(takeLock(file, lockHolder("run start"), s).ok).toBe(true);
    s.interrupt();
    expect(existsSync(file)).toBe(false);
  });

  it("a holder that is not JSON is null", () => {
    const file = lockIn();
    const s = signals();
    expect(takeLock(file, lockHolder("a"), s).ok).toBe(true);
    writeFileSync(file, "", "utf8");
    expect(takeLock(file, lockHolder("b"), s)).toEqual({ ok: false, holder: null });
  });
});

describe("waitForLock (F18)", () => {
  it("takes the lock once its holder releases it within the wait", async () => {
    const file = lockIn();
    const s = signals();
    const first = takeLock(file, lockHolder("guard"), s);
    if (!first.ok) throw new Error("unreachable");
    setTimeout(() => first.release(), 60);
    const second = await waitForLock(file, lockHolder("run finish"), s, { waitMs: 2_000, stepMs: 10 });
    expect(second.ok).toBe(true);
    expect((JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)["what"]).toBe("run finish");
    if (second.ok) second.release();
  });

  it("answers the holder after the wait when the lock stays taken; waitMs 0 is one attempt", async () => {
    const file = lockIn();
    const s = signals();
    const holder = lockHolder("guard");
    const first = takeLock(file, holder, s);
    const started = Date.now();
    expect(await waitForLock(file, lockHolder("x"), s, { waitMs: 80, stepMs: 10 })).toEqual({ ok: false, holder });
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
    expect(await waitForLock(file, lockHolder("x"), s, { waitMs: 0 })).toEqual({ ok: false, holder });
    if (first.ok) first.release();
  });
});
