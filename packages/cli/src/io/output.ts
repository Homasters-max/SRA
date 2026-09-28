import { EXIT, WarrantError, type CliError, type ExitCode } from "../core/errors.js";

/** Result returned by every command implementation (design D-8). */
export interface CommandResult {
  ok: boolean;
  change?: string;
  data: Record<string, unknown>;
  errors: CliError[];
  exitCode: ExitCode;
}

/** The single JSON object printed to stdout (REQ-KRN-002). */
export interface Envelope {
  command: string;
  ok: boolean;
  change?: string;
  data: Record<string, unknown>;
  errors: CliError[];
}

/** Key order is part of the contract: command, ok, change?, data, errors. */
export function toEnvelope(command: string, result: CommandResult): Envelope {
  return result.change === undefined
    ? { command, ok: result.ok, data: result.data, errors: result.errors }
    : { command, ok: result.ok, change: result.change, data: result.data, errors: result.errors };
}

export function formatEnvelope(envelope: Envelope): string {
  return JSON.stringify(envelope, null, 2) + "\n";
}

/** Builds a failing result from a catalogued error. */
export function failure(error: WarrantError, change?: string): CommandResult {
  const result: CommandResult = { ok: false, data: error.data ?? {}, errors: [error.toCliError()], exitCode: error.exitCode };
  if (change !== undefined) result.change = change;
  return result;
}

/** Builds a failing result from several collected errors (validate reports everything at once). */
export function failures(errors: CliError[], exitCode: ExitCode, data: Record<string, unknown> = {}, change?: string): CommandResult {
  const result: CommandResult = { ok: false, data, errors, exitCode };
  if (change !== undefined) result.change = change;
  return result;
}

export function success(data: Record<string, unknown>, change?: string): CommandResult {
  const result: CommandResult = { ok: true, data, errors: [], exitCode: EXIT.OK };
  if (change !== undefined) result.change = change;
  return result;
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

/**
 * Prints the envelope of the process's command and sets `process.exitCode`
 * once the write completed (B4, REQ-KRN-003). The process is never ended with
 * `process.exit`: that would drop whatever part of a large envelope is still
 * buffered for a pipe. Node exits by itself once stdout has drained, provided
 * no other handle is left open.
 */
export async function emitToProcess(command: string, result: CommandResult): Promise<void> {
  await writeStdout(formatEnvelope(toEnvelope(command, result)));
  process.exitCode = result.exitCode;
}

/**
 * Prints the native answer of a frontend adapter (`warrant guard --frontend`,
 * REQ-ENF-005) instead of the envelope and sets its exit code the same way.
 */
export async function emitNative(answer: { stdout: string; exit: number }): Promise<void> {
  if (answer.stdout !== "") await writeStdout(answer.stdout);
  process.exitCode = answer.exit;
}
