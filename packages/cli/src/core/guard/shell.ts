/**
 * Shell parse of `guard` (design §6, ADR-0017 п. 5): the words of a command
 * line (the tokenizer `core/shell.ts`) split into simple commands, and the
 * match of a simple command against `guard_prefixes`. A simple command drops
 * its leading `VAR=…` assignments; `bash -c` / `sh -c` with one string is
 * parsed again, one level deep — the limit INV-07 (ADR-0017 Consequences).
 * The strict form under a `review` Run (REQ-ENF-004) takes the commands as
 * written: `VAR=…` stays and only exactly `bash -c <string>` is parsed.
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

/** The string of exactly `bash -c <string>` / `sh -c <string>`: no option, no path, no argument after it. */
function exactShellString(command: readonly string[]): string | undefined {
  return command.length === 3 && SHELLS.has(command[0] as string) && command[1] === "-c" ? command[2] : undefined;
}

/**
 * Simple commands of `words` (from `shellWords` or the `argv` of an event):
 * split at the operators, without leading `VAR=…`; the string of `bash -c` is
 * parsed into commands of its own, `depth` levels deep (one by default).
 */
export function simpleCommands(words: readonly string[], depth = 1): string[][] {
  return split(words).flatMap((command) => {
    const script = shellString(command);
    return script !== undefined && depth > 0 ? [command, ...simpleCommands(shellWords(script), depth - 1)] : [command];
  });
}

/**
 * The commands that run: as {@link simpleCommands}, but a `bash -c` whose
 * string is parsed stands for the commands of that string, not for itself;
 * one `depth` levels deep stays a command of its own. `asWritten` — the strict
 * form under a `review` Run (REQ-ENF-004): a leading `VAR=…` stays a word of
 * its command, and only exactly `bash -c <string>` / `sh -c <string>` is parsed.
 * `operators`, when given, collects the operators that join the commands, of
 * every level parsed (the strict form of a command that writes nothing, I-207).
 */
export function leafCommands(words: readonly string[], asWritten = false, depth = 1, operators?: string[]): string[][] {
  return split(words, !asWritten, operators).flatMap((command) => {
    const script = asWritten ? exactShellString(command) : shellString(command);
    return script !== undefined && depth > 0 ? leafCommands(shellWords(script), asWritten, depth - 1, operators) : [command];
  });
}

/**
 * `words` split at the operators into commands, without empty ones and, unless
 * kept, without leading `VAR=…`; the operators go to `operators` when given.
 */
function split(words: readonly string[], dropAssignments = true, operators?: string[]): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  const flush = (): void => {
    let start = 0;
    while (dropAssignments && start < current.length && ASSIGNMENT_RE.test(current[start] as string)) start++;
    const command = current.slice(start);
    current = [];
    if (command.length > 0) out.push(command);
  };
  for (const word of words) {
    if (SHELL_OPERATORS.has(word)) {
      flush();
      operators?.push(word);
    } else {
      current.push(word);
    }
  }
  flush();
  return out;
}

/**
 * A `guard_prefixes` entry: the leading `words` a simple command must start
 * with and the mode `flags` it must also hold, in any order after the first
 * word (only a default prefix of an interpreter has flags, ADR-0042 п. 3).
 */
export interface GuardPrefix {
  words: string[];
  flags: string[];
}

/** Interpreters whose check is chosen by flags (`node --test`), not by the next word (ADR-0042 п. 3). */
export const INTERPRETERS: readonly string[] = ["node", "deno", "bun", "python", "python3", "ruby"];

/**
 * The default `guard_prefixes` entry of a check (ADR-0017 п. 5): the words of
 * `run.command` before the first that starts with `-` or holds a placeholder
 * `{…}` — `["pytest", "-q"]` → `pytest`. The pair `-m <module>` right after
 * the first word belongs to the prefix: `python -m pytest` is the check,
 * `python` alone would also forbid `python -` (BL-61, SCN-ENF-037). When that
 * leaves a single interpreter word, the mode flags of the command — words
 * with `-` and without `=` or `{` — join it: `node --experimental-strip-types
 * --test …` → `node` + {`--experimental-strip-types`, `--test`}, so `node -e`
 * and scripts stay allowed (ADR-0042 п. 3, SCN-ENF-040).
 */
export function defaultPrefix(command: readonly string[]): GuardPrefix {
  const plain = (word: string | undefined): word is string => word !== undefined && !word.startsWith("-") && !word.includes("{");
  const [first, flag, module] = command;
  if (!plain(first)) return { words: [], flags: [] };
  const withModule = flag === "-m" && plain(module);
  const words = withModule ? [first, flag, module] : [first];
  for (const word of command.slice(words.length)) {
    if (!plain(word)) break;
    words.push(word);
  }
  if (words.length > 1 || !INTERPRETERS.includes(first)) return { words, flags: [] };
  const flags: string[] = [];
  for (const word of command.slice(1)) {
    if (word.startsWith("-") && !word.includes("=") && !word.includes("{") && !flags.includes(word)) flags.push(word);
  }
  return { words, flags };
}

/** True when the simple command starts with the words of `prefix` and holds each of its flags after the first word. */
export function matchesPrefix(command: readonly string[], prefix: GuardPrefix): boolean {
  if (!startsWithPrefix(command, prefix.words)) return false;
  const rest = command.slice(1);
  return prefix.flags.every((flag) => rest.includes(flag));
}

/** Text of a prefix for a reason: its words, then its flags in braces. */
export function prefixText(prefix: GuardPrefix): string {
  return prefix.flags.length === 0 ? prefix.words.join(" ") : `${prefix.words.join(" ")} {${prefix.flags.join(", ")}}`;
}

/** True when the simple command starts with every word of `prefix` (a non-empty prefix). */
export function startsWithPrefix(command: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length > 0 && prefix.length <= command.length && prefix.every((word, i) => command[i] === word);
}
