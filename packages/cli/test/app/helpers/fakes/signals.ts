/**
 * `FakeSignals` (design §5 of phase-4a, A-12): the cleanups a command
 * registered on `ctx.signals`, without handlers on the test process;
 * `interrupt()` runs them as a signal would — latest first.
 */
import type { SignalsPort } from "../../../../src/core/ports/signals.js";

export class FakeSignals implements SignalsPort {
  private readonly cleanups: (() => void)[] = [];

  onInterrupt(cleanup: () => void): () => void {
    this.cleanups.push(cleanup);
    return () => {
      const index = this.cleanups.lastIndexOf(cleanup);
      if (index >= 0) this.cleanups.splice(index, 1);
    };
  }

  /** How many cleanups are registered now. */
  get registered(): number {
    return this.cleanups.length;
  }

  /** Runs every registered cleanup, latest first, as SIGINT would. */
  interrupt(): void {
    while (this.cleanups.length > 0) (this.cleanups.pop() as () => void)();
  }
}
