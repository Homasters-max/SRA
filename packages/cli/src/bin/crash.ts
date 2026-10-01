/**
 * The handler of an exception no command caught — `uncaughtException` and
 * `unhandledRejection` of the process (exit-contract D9, REQ-KRN-003,
 * REQ-ENF-004, REQ-ENF-005). Pure over its inputs: the argv of the call,
 * whether the answer is already on stdout, the error and the printer; it
 * returns the exit code, and `bin/warrant.ts` ends the process with it. The
 * test calls it directly, without a test entry into the CLI.
 */
import { WarrantError } from "../core/errors.js";
import { UNREADABLE_EXIT } from "../core/ports/frontend.js";
import { runGuardCrash } from "../commands/guard.js";
import { failure, formatEnvelope, toEnvelope, type Printer } from "../io/output.js";

/** What the process knows when the exception comes. */
export interface CrashState {
  /** `process.argv`: the mode of the call and the command come from it. */
  argv: readonly string[];
  /** The answer is already on stdout: a second one is never printed. */
  answered: boolean;
  /** The envelope name of the running command (`run start`), once its action began; else the first word of argv. */
  command?: string;
  /** The text of stdin of `warrant guard`, once read: its phase picks `deny` or `allow`. */
  guardInput?: string;
}

/** The mode of the call: `guard --frontend <name>` answers the hook protocol, `guard` decides, any other command — the envelope. */
export type CrashMode = "command" | "guard" | "guard-frontend";

/** The words of argv after `node warrant`, without the options. */
function words(argv: readonly string[]): string[] {
  return argv.slice(2).filter((arg) => !arg.startsWith("-"));
}

export function crashMode(argv: readonly string[]): CrashMode {
  if (words(argv)[0] !== "guard") return "command";
  const frontend = argv.slice(2).some((arg) => arg === "--frontend" || arg.startsWith("--frontend="));
  return frontend ? "guard-frontend" : "guard";
}

function trace(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.stack ?? thrown.message;
  return String(thrown);
}

function message(thrown: unknown): string {
  const text = thrown instanceof Error ? thrown.message : String(thrown);
  return thrown instanceof WarrantError ? `${thrown.code}: ${text}` : text;
}

/**
 * Answers an exception no command caught and returns the exit code:
 * - `guard --frontend` — the reason on stderr, nothing on stdout, exit 2
 *   (fail-closed: the agent cancels the action, REQ-ENF-005);
 * - `guard` — `deny` with hint `warrant validate` in `pre` or an unknown
 *   phase, `allow` without hints in `post`, the message on stderr, exit 0
 *   (REQ-ENF-004); once the decision is out — stderr only, exit 0;
 * - any other command — the envelope `INTERNAL` with `command` from argv
 *   (`warrant` without one), printed as a command's result is, the stack on
 *   stderr, exit 3; once the answer is out — the stack on stderr only, exit 3.
 */
export function onCrash(thrown: unknown, state: CrashState, printer: Printer): number {
  const mode = crashMode(state.argv);
  if (mode === "guard-frontend") {
    printer.stderr(`warrant guard --frontend: ${trace(thrown)}\n`);
    return UNREADABLE_EXIT;
  }
  if (mode === "guard") {
    const result = runGuardCrash(state.guardInput, thrown);
    printer.stderr(`warrant guard: ${trace(thrown)}\n`);
    if (!state.answered) printer.stdout(formatEnvelope(toEnvelope("guard", result)));
    return result.exitCode;
  }
  const result = failure(new WarrantError("INTERNAL", message(thrown)));
  printer.stderr(trace(thrown) + "\n");
  if (!state.answered) printer.stdout(formatEnvelope(toEnvelope(state.command ?? words(state.argv)[0] ?? "warrant", result)));
  return result.exitCode;
}
