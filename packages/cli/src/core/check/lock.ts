/**
 * The `exclusive` check lock (design §3, ADR-0017 point 3).
 *
 * One lock per machine: `<git-common-dir>/warrant/check.lock`, shared by every
 * process and worktree of the repository. It is the one lock primitive
 * (`core/lock.ts`, A-12) with the holder `{ pid, check, started_at, cwd }`
 * and a single attempt: a taken lock is `BUSY` with the holder at once; a dead
 * holder is not removed automatically (D-23) — the person deletes the file.
 * Outside git the lock falls back to `.warrant/check.lock`.
 */
import path from "node:path";

import { takeLock, type Acquired } from "../lock.js";
import type { SignalsPort } from "../ports/signals.js";

export type { Acquired } from "../lock.js";

export const LOCK_FILE = "check.lock";

export interface CheckLockHolder {
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

/**
 * Takes the lock or reports its holder. The returned `release` is idempotent
 * and is also run on SIGINT / SIGTERM (`signals`) until it has been called.
 */
export function acquireLock(file: string, holder: CheckLockHolder, signals: SignalsPort): Acquired {
  return takeLock(file, holder, signals);
}
