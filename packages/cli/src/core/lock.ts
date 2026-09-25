/**
 * The one lock primitive of the CLI (design §5 of phase-4a, A-12, F18): a
 * file created with the `wx` flag — `O_CREAT | O_EXCL`, atomic on POSIX and
 * Windows alike — that holds its holder as one line of JSON. The `exclusive`
 * check lock (`core/check/lock.ts`) and the lock of a Run file
 * (`core/run/store.ts`) are both this file.
 *
 * A taken lock answers with its holder, or `null` when the file is being
 * written or is not JSON. `waitForLock` repeats the attempt every `stepMs`
 * until `waitMs` has passed. A dead holder is never removed automatically
 * (D-23): the person deletes the file. A lock taken is released by `release`
 * (idempotent) or, until then, by an interrupt through `ctx.signals`.
 */
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";

import type { SignalsPort } from "./ports/signals.js";

/** The holder of a lock other than the check lock: who, for what, since when. */
export interface LockHolder {
  pid: number;
  what: string;
  at: string;
}

/** `LockHolder` of this process now, for `what`. */
export function lockHolder(what: string): LockHolder {
  return { pid: process.pid, what, at: new Date().toISOString() };
}

export type Acquired = { ok: true; release: () => void } | { ok: false; holder: Record<string, unknown> | null };

/** Default step between two attempts of `waitForLock`. */
export const LOCK_STEP_MS = 50;

function readHolder(file: string): Record<string, unknown> | null {
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  } catch {
    return null; // being written or not JSON: the holder is unknown
  }
}

/**
 * One attempt: creates `file` (and its directory) holding `holder`, or reports
 * the holder of the lock already there.
 */
export function takeLock(file: string, holder: object, signals: SignalsPort): Acquired {
  mkdirSync(path.dirname(file), { recursive: true });
  let fd: number;
  try {
    fd = openSync(file, "wx");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") return { ok: false, holder: readHolder(file) };
    throw cause;
  }
  try {
    writeSync(fd, JSON.stringify(holder) + "\n");
  } finally {
    closeSync(fd);
  }

  let released = false;
  const unlink = (): void => {
    if (released) return;
    released = true;
    try {
      unlinkSync(file);
    } catch {
      // already gone: someone removed it by hand
    }
  };
  const unregister = signals.onInterrupt(unlink);
  return {
    ok: true,
    release: () => {
      unregister();
      unlink();
    }
  };
}

export interface WaitOptions {
  /** How long to keep trying after the first attempt; 0 — one attempt. */
  waitMs: number;
  stepMs?: number;
}

/** `takeLock`, repeated every `stepMs` until it succeeds or `waitMs` has passed; the last answer. */
export async function waitForLock(file: string, holder: object, signals: SignalsPort, options: WaitOptions): Promise<Acquired> {
  const deadline = Date.now() + options.waitMs;
  const step = options.stepMs ?? LOCK_STEP_MS;
  for (;;) {
    const acquired = takeLock(file, holder, signals);
    if (acquired.ok || Date.now() >= deadline) return acquired;
    await new Promise((resolve) => setTimeout(resolve, Math.min(step, Math.max(1, deadline - Date.now()))));
  }
}
