/**
 * The `exclusive` check lock (design §3, ADR-0017 point 3).
 *
 * One lock per machine: `<git-common-dir>/warrant/check.lock`, shared by every
 * process and worktree of the repository. It is created with the `wx` flag,
 * which is atomic on POSIX and Windows alike, and holds its holder as JSON
 * `{ pid, check, started_at, cwd }`. A taken lock is `BUSY` with the holder;
 * a dead holder is not removed automatically (D-23) — the person deletes the
 * file. Outside git the lock falls back to `.warrant/check.lock`.
 */
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";

import { onInterrupt } from "./interrupt.js";

export const LOCK_FILE = "check.lock";

export interface LockHolder {
  pid: number;
  check: string;
  started_at: string;
  cwd: string;
}

/**
 * Where the lock lives: under `<git-common-dir>/warrant/` when the project is
 * in a git repository (`gitCommonDir` absolute), else `.warrant/` of the
 * project with a warning for stderr.
 */
export function lockPath(root: string, gitCommonDir: string | null): { file: string; warning?: string } {
  if (gitCommonDir !== null) return { file: path.join(gitCommonDir, "warrant", LOCK_FILE) };
  return {
    file: path.join(root, ".warrant", LOCK_FILE),
    warning: "check: not a git repository; the exclusive lock is .warrant/check.lock of this project only\n"
  };
}

export type Acquired = { ok: true; release: () => void } | { ok: false; holder: LockHolder | Record<string, unknown> | null };

function readHolder(file: string): LockHolder | Record<string, unknown> | null {
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  } catch {
    return null; // being written or not JSON: the holder is unknown
  }
}

/**
 * Takes the lock or reports its holder. The returned `release` is idempotent
 * and is also run on SIGINT / SIGTERM until it has been called.
 */
export function acquireLock(file: string, holder: LockHolder): Acquired {
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
  const unregister = onInterrupt(unlink);
  return {
    ok: true,
    release: () => {
      unregister();
      unlink();
    }
  };
}
