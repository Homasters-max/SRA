import {
  cliError,
  exitCodeFor,
  isRetryable,
  WarrantError,
  type CliError,
  type ErrorOptions,
  type ExitCode,
  type Outcome
} from "../core/errors.js";

/** Result returned by every command implementation (design D-8). */
export interface CommandResult {
  ok: boolean;
  change?: string;
  data: Record<string, unknown>;
  errors: CliError[];
  /** The controller action or verdict that enters the exit code with `errors` (REQ-KRN-003, exit-contract D4). */
  outcome?: Outcome;
  /** Set by the builders below — `exitCodeFor(errors, outcome)`, never by the call site (exit-contract D2, D4, I-235). */
  exitCode: ExitCode;
}

/**
 * An `errors[]` entry of the envelope: `retryable: true` only for a code of
 * class `retry`, absent otherwise (REQ-KRN-002, exit-contract D5).
 */
export type EnvelopeError = CliError & { retryable?: true };

/** The single JSON object printed to stdout (REQ-KRN-002). */
export interface Envelope {
  command: string;
  ok: boolean;
  change?: string;
  data: Record<string, unknown>;
  errors: EnvelopeError[];
}

/**
 * The one place `retryable` is added (exit-contract D5) — for `cliError`,
 * literals and `toCliError` alike; keys in the order `code`, `message`,
 * `path`, `hint`, `retryable`.
 */
function envelopeError(error: CliError): EnvelopeError {
  if (!isRetryable(error.code)) return error;
  const options: ErrorOptions = {};
  if (error.path !== undefined) options.path = error.path;
  if (error.hint !== undefined) options.hint = error.hint;
  return { ...cliError(error.code, error.message, options), retryable: true };
}

/** Key order is part of the contract: command, ok, change?, data, errors. */
export function toEnvelope(command: string, result: CommandResult): Envelope {
  const errors = result.errors.map(envelopeError);
  return result.change === undefined
    ? { command, ok: result.ok, data: result.data, errors }
    : { command, ok: result.ok, change: result.change, data: result.data, errors };
}

export function formatEnvelope(envelope: Envelope): string {
  return JSON.stringify(envelope, null, 2) + "\n";
}

/** The one builder of a result: its exit code is `exitCodeFor(errors, outcome)` (REQ-KRN-003). */
function build(ok: boolean, data: Record<string, unknown>, errors: CliError[], change: string | undefined, outcome: Outcome | undefined): CommandResult {
  const result: CommandResult = { ok, data, errors, exitCode: exitCodeFor(errors, outcome) };
  if (change !== undefined) result.change = change;
  if (outcome !== undefined) result.outcome = outcome;
  return result;
}

/** Builds a failing result from a catalogued error. */
export function failure(error: WarrantError, change?: string): CommandResult {
  return build(false, error.data ?? {}, [error.toCliError()], change, undefined);
}

/**
 * Builds a failing result from several collected errors (validate reports
 * everything at once) and the outcome that enters the exit code (exit-contract D4).
 */
export function failures(errors: CliError[], data: Record<string, unknown> = {}, change?: string, outcome?: Outcome): CommandResult {
  return build(false, data, errors, change, outcome);
}

export function success(data: Record<string, unknown>, change?: string): CommandResult {
  return build(true, data, [], change, undefined);
}

/**
 * Converts anything thrown by a command into a CommandResult.
 * Unhandled exceptions become INTERNAL with exit code 3; the stack goes to stderr.
 */
export function resultFromThrown(thrown: unknown, change?: string): CommandResult {
  if (thrown instanceof WarrantError) return failure(thrown, change);
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  if (thrown instanceof Error && thrown.stack) process.stderr.write(thrown.stack + "\n");
  return failure(new WarrantError("INTERNAL", message), change);
}

export interface Printer {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const processPrinter: Printer = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text)
};

/**
 * Prints the envelope and returns the exit code. In phase 1 TTY and non-TTY
 * both print the same JSON envelope (design Non-Goals), so `--json` is accepted
 * but changes nothing.
 */
export function emit(command: string, result: CommandResult, printer: Printer = processPrinter): ExitCode {
  printer.stdout(formatEnvelope(toEnvelope(command, result)));
  return result.exitCode;
}

/**
 * Writes `text` to stdout and resolves once the stream has accepted it.
 *
 * Resolves on error too (a closed pipe, EPIPE): the reader is gone, and the
 * exit code is all that is left to report.
 */
export function writeStdout(text: string): Promise<void> {
  return new Promise<void>((resolve) => {
    process.stdout.write(text, () => resolve());
  });
}

/** Whether the process has given its one answer on stdout (exit-contract D9). */
let answered = false;

/**
 * Claims the one answer of the process: `true` the first time, `false` once
 * `emitToProcess`, `emitNative` or the handler of an uncaught exception
 * (`bin/crash.ts`, D9) has claimed it — a second object is never printed.
 */
export function claimAnswer(): boolean {
  if (answered) return false;
  answered = true;
  return true;
}

/**
 * Prints the envelope of the process's command and sets `process.exitCode`
 * once the write completed (B4, REQ-KRN-003). The process is never ended with
 * `process.exit`: that would drop whatever part of a large envelope is still
 * buffered for a pipe. Node exits by itself once stdout has drained, provided
 * no other handle is left open. Nothing is printed once the answer is given.
 */
export async function emitToProcess(command: string, result: CommandResult): Promise<void> {
  if (!claimAnswer()) return;
  await writeStdout(formatEnvelope(toEnvelope(command, result)));
  process.exitCode = result.exitCode;
}

/**
 * Prints the native answer of a frontend adapter (`warrant guard --frontend`,
 * REQ-ENF-005) instead of the envelope and sets its exit code the same way.
 */
export async function emitNative(answer: { stdout: string; exit: number }): Promise<void> {
  if (!claimAnswer()) return;
  if (answer.stdout !== "") await writeStdout(answer.stdout);
  process.exitCode = answer.exit;
}
