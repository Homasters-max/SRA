/**
 * `Ctx` (ADR-0025 п. 2, design §2, §3): what a command and every `core`
 * function that reaches a port, directly or through its callees, receives
 * instead of `root`. Pure functions receive data, not `ctx`. The production
 * `ctx` is built by `src/bin/warrant.ts` from the adapters; there is no
 * implicit context. `Ctx` is internal API: the external contract stays argv.
 */
import type { CheckRunnerPort } from "./ports/checks.js";
import type { ClockPort } from "./ports/clock.js";
import type { GitPort } from "./ports/git.js";
import type { OpenSpecPort } from "./ports/openspec.js";
import type { SignalsPort } from "./ports/signals.js";
import type { Writes } from "./writes.js";

export interface Ctx {
  /** Project root; every path the CLI reports is relative to it. */
  readonly root: string;
  readonly openspec: OpenSpecPort;
  readonly git: GitPort;
  readonly checks: CheckRunnerPort;
  readonly clock: ClockPort;
  /** Cleanup on SIGINT / SIGTERM / SIGHUP: a lock taken must not outlive the process (A-12). */
  readonly signals: SignalsPort;
  /** Every write of a command that changes state: performed, or only collected under `--dry-run` (REQ-KRN-034). */
  readonly writes: Writes;
  /** Diagnostics: stderr in production, so stdout stays exactly one envelope. */
  readonly warn: (text: string) => void;
}
