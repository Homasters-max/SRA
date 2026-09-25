/**
 * `SignalsPort` (design §5 of phase-4a, A-12): cleanup on SIGINT / SIGTERM /
 * SIGHUP (and SIGBREAK on Windows) while a lock is held or a check runs
 * (design §3, §4 of phase 3).
 *
 * A lock (`core/lock.ts`) and the child process tree must not outlive an
 * interrupted `warrant`. Each holder registers a synchronous cleanup; on a signal
 * all of them run (latest first), the handlers are removed and the signal is
 * raised again, so the process ends the way it would have without us.
 *
 * SIGHUP matters on POSIX (review of phase 3, R-3): the child runs `detached`,
 * in a session of its own, so closing the terminal hangs up the CLI only —
 * without a handler the CLI died with the lock taken and the child tree
 * running. Windows reports a closed console as SIGHUP and Ctrl+Break as
 * SIGBREAK; it cannot raise either again, so there the CLI exits with
 * 128 + the signal number instead.
 */
import { constants } from "node:os";

import type { SignalsPort } from "../core/ports/signals.js";

type Cleanup = () => void;

const SIGNALS: readonly NodeJS.Signals[] =
  process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] : ["SIGINT", "SIGTERM", "SIGHUP"];
const cleanups: Cleanup[] = [];

function runAll(): void {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop() as Cleanup;
    try {
      cleanup();
    } catch {
      // best effort: the next cleanup must still run
    }
  }
}

function onSignal(signal: NodeJS.Signals): void {
  runAll();
  uninstall();
  try {
    process.kill(process.pid, signal);
  } catch {
    // Windows emulates only SIGINT, SIGTERM and SIGKILL for process.kill.
    process.exit(128 + (constants.signals[signal] ?? 1));
  }
}

function install(): void {
  for (const signal of SIGNALS) process.on(signal, onSignal);
}

function uninstall(): void {
  for (const signal of SIGNALS) process.removeListener(signal, onSignal);
}

/**
 * Registers `cleanup` until the returned function is called. The handlers
 * exist only while at least one cleanup is registered, so an idle CLI keeps
 * the default signal behaviour.
 */
export function onInterrupt(cleanup: Cleanup): () => void {
  if (cleanups.length === 0) install();
  cleanups.push(cleanup);
  return () => {
    const index = cleanups.lastIndexOf(cleanup);
    if (index >= 0) cleanups.splice(index, 1);
    if (cleanups.length === 0) uninstall();
  };
}

/** The production `ctx.signals`: the handlers of this process. */
export const processSignals: SignalsPort = { onInterrupt };
