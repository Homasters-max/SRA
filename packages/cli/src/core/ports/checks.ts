/**
 * Port to the runner of check commands (ADR-0025 п. 3, design §2, REQ-VER-002).
 * The adapter (`adapters/check-runner.ts`) runs the argv without a shell in
 * `cwd`, kills the whole process tree on timeout and never rejects.
 */

export interface RunSpec {
  argv: readonly string[];
  cwd: string;
  timeoutMs: number;
  /** Keep stdout in memory (the parser reads it); otherwise it is passed to `forward`. */
  captureStdout: boolean;
  /** Where uncaptured stdout goes; default stderr of the CLI, so the envelope stays alone on stdout. */
  forward?: (chunk: Buffer) => void;
}

export type RunOutcome =
  | { kind: "exited"; code: number | null; signal: NodeJS.Signals | null; stdout: string }
  | { kind: "timeout" }
  | { kind: "spawn-error"; message: string };

export interface CheckRunnerPort {
  run(spec: RunSpec): Promise<RunOutcome>;
}
