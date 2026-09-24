/**
 * `FakeCheckRunner` (ADR-0025 п. 4, design §5): `CheckRunnerPort` with the
 * answers given per command — exit code or signal, output, timeout, failure to
 * start — and a journal of the runs. The command is `argv[0]`; a behaviour may
 * be a function of the run, and its `effect` stands for what the command does
 * to the files (a junit report in `{out}`). The contract
 * (`test/contract/checks.contract.test.ts`) holds it to the real runner:
 * captured output comes back as `stdout`, uncaptured output goes to `forward`.
 */
import type { CheckRunnerPort, RunOutcome, RunSpec } from "../../../../src/core/ports/checks.js";

export interface FakeCommand {
  /** Exit code; default 0. Ignored when `signal` is set. */
  exit?: number;
  signal?: NodeJS.Signals;
  /** What the command prints on stdout. */
  output?: string;
  /** The command outlives its timeout. */
  timedOut?: boolean;
  /** The command cannot be started. */
  spawnError?: string;
  /** What the command does besides printing, e.g. writing a report. */
  effect?: (spec: RunSpec) => void;
}

export type FakeBehaviour = FakeCommand | ((spec: RunSpec) => FakeCommand);

export class FakeCheckRunner implements CheckRunnerPort {
  /** Every run, in order. */
  readonly calls: RunSpec[] = [];
  /** Uncaptured output of runs without `forward` (the real runner writes it to stderr). */
  readonly forwarded: string[] = [];

  private readonly behaviours = new Map<string, FakeBehaviour>();

  /** Answers every run of `command` (its `argv[0]`) with `behaviour`. */
  on(command: string, behaviour: FakeBehaviour): this {
    this.behaviours.set(command, behaviour);
    return this;
  }

  run(spec: RunSpec): Promise<RunOutcome> {
    this.calls.push(spec);
    const [command] = spec.argv;
    if (command === undefined) return Promise.resolve({ kind: "spawn-error", message: "empty command" });
    const behaviour = this.behaviours.get(command);
    if (behaviour === undefined) return Promise.resolve({ kind: "spawn-error", message: `spawn ${command} ENOENT` });
    const answer = typeof behaviour === "function" ? behaviour(spec) : behaviour;
    if (answer.spawnError !== undefined) return Promise.resolve({ kind: "spawn-error", message: answer.spawnError });
    answer.effect?.(spec);
    if (answer.timedOut === true) return Promise.resolve({ kind: "timeout" });
    const output = answer.output ?? "";
    if (!spec.captureStdout && output !== "") {
      if (spec.forward !== undefined) spec.forward(Buffer.from(output, "utf8"));
      else this.forwarded.push(output);
    }
    const stdout = spec.captureStdout ? output : "";
    return Promise.resolve(
      answer.signal !== undefined
        ? { kind: "exited", code: null, signal: answer.signal, stdout }
        : { kind: "exited", code: answer.exit ?? 0, signal: null, stdout }
    );
  }
}
