/**
 * Cleanup on SIGINT / SIGTERM while a check runs (design §3, §4).
 *
 * The lock and the child process tree must not outlive an interrupted
 * `warrant check`. Each holder registers a synchronous cleanup; on a signal
 * all of them run (latest first), the handlers are removed and the signal is
 * raised again, so the process ends the way it would have without us.
 */

type Cleanup = () => void;

const SIGNALS = ["SIGINT", "SIGTERM"] as const;
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
  process.kill(process.pid, signal);
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
