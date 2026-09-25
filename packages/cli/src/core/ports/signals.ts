/**
 * Port to the signals of the CLI process (design §5, A-12): cleanup that must
 * run when SIGINT / SIGTERM / SIGHUP (SIGBREAK on Windows) ends the process —
 * a lock taken, a child process tree running. The adapter
 * (`adapters/signals.ts`) installs the handlers; `core` only registers.
 */

export interface SignalsPort {
  /**
   * Registers a synchronous `cleanup` until the returned function is called;
   * on a signal every registered cleanup runs, latest first, and the process
   * ends by that signal.
   */
  onInterrupt(cleanup: () => void): () => void;
}
