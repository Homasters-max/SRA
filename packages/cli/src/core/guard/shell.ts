/**
 * Shell parse of `guard` (design §6, ADR-0017 п. 5): the words of a command
 * line (the tokenizer `core/shell.ts`) split into simple commands, and the
 * match of a simple command against `guard_prefixes`. A simple command drops
 * its leading `VAR=…` assignments; `bash -c` / `sh -c` with one string is
 * parsed again, one level deep — the limit INV-07 (ADR-0017 Consequences).
 */
import { SHELL_OPERATORS, shellWords } from "../shell.js";

const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Shells whose `-c` string is parsed again. */
const SHELLS: ReadonlySet<string> = new Set(["bash", "sh"]);

/** The `-c` string of `bash -c <string>` / `sh -lc <string>`, if `command` is one. */
function shellString(command: readonly string[]): string | undefined {
  const name = (command[0] ?? "").split(/[\\/]/).pop() ?? "";
  if (!SHELLS.has(name)) return undefined;
  for (let i = 1; i < command.length; i++) {
    const option = command[i] as string;
    if (!option.startsWith("-")) return undefined;
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(option)) return command[i + 1];
  }
  return undefined;
}

/**
 * Simple commands of `words` (from `shellWords` or the `argv` of an event):
 * split at the operators, without leading `VAR=…`; the string of `bash -c` is
 * parsed into commands of its own, `depth` levels deep (one by default).
 */
export function simpleCommands(words: readonly string[], depth = 1): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  const flush = (): void => {
    let start = 0;
    while (start < current.length && ASSIGNMENT_RE.test(current[start] as string)) start++;
    const command = current.slice(start);
    current = [];
    if (command.length === 0) return;
    out.push(command);
    const script = shellString(command);
    if (script !== undefined && depth > 0) out.push(...simpleCommands(shellWords(script), depth - 1));
  };
  for (const word of words) {
    if (SHELL_OPERATORS.has(word)) flush();
    else current.push(word);
  }
  flush();
  return out;
}

/**
 * The default `guard_prefixes` entry of a check (ADR-0017 п. 5): the words of
 * `run.command` before the first that starts with `-` or holds a placeholder
 * `{…}` — `["pytest", "-q"]` → `["pytest"]`.
 */
export function defaultPrefix(command: readonly string[]): string[] {
  const out: string[] = [];
  for (const word of command) {
    if (word.startsWith("-") || word.includes("{")) break;
    out.push(word);
  }
  return out;
}

/** True when the simple command starts with every word of `prefix` (a non-empty prefix). */
export function startsWithPrefix(command: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length > 0 && prefix.length <= command.length && prefix.every((word, i) => command[i] === word);
}
