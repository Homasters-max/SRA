/**
 * The minimal shell tokenizer of guard (design phase-4a §6, ADR-0017 п. 5): a
 * command line as words. It knows quotes (`'…'` literal, `"…"` with `\` before
 * `"`, `\`, `$`, `` ` `` and a newline), `\` outside quotes, the operators
 * `&&`, `||`, `;`, `|` and a newline — each a word of its own. `$(…)`, aliases
 * and scripts are not expanded — the limit INV-07 (ADR-0017 Consequences).
 *
 * A heredoc (`<<DELIM`, `<<'DELIM'`, `<<"DELIM"`, `<<-DELIM`) is data of its
 * command, not commands: the redirection and the body up to the delimiter line
 * are dropped, so no body line becomes a command and a redirection before the
 * command name does not shift its first word (I-167). A heredoc whose
 * delimiter line never comes is not one: its lines stay commands (fail-safe).
 * `<<` is no heredoc where bash does not read one: in a comment (an unquoted
 * `#` at the start of a word, to the end of the line; quotes and `\` in it are
 * text, its words stay words) and inside `$((…))`, `((…))`, `$[…]`, `${…}`
 * (up to the closing bracket, bash's rule for `((`; unclosed — not skipped).
 *
 * Rank 0 so that a frontend adapter makes the `argv` of a shell event with it
 * (design §7); the split into simple commands and the match against
 * `guard_prefixes` are `core/guard/shell.ts`.
 */

/** Words that end one simple command and start the next. */
export const SHELL_OPERATORS: ReadonlySet<string> = new Set(["&&", "||", ";", "|", "\n"]);

/** Characters `\` escapes inside double quotes. */
const DOUBLE_QUOTE_ESCAPES = '"\\$`\n';

/** Characters that end the delimiter word of a heredoc outside quotes. */
const DELIMITER_STOPS = " \t\r\n;&|<>()";

/** A heredoc redirection read at `<<`: its delimiter, `<<-`, and where the redirection ends. */
interface Heredoc {
  delimiter: string;
  stripTabs: boolean;
  end: number;
}

/** The heredoc redirection at `line[at] === "<"` (`<<`, not `<<<`), if a delimiter follows. */
function readHeredoc(line: string, at: number): Heredoc | undefined {
  let i = at + 2;
  const stripTabs = line[i] === "-";
  if (stripTabs) i++;
  while (line[i] === " " || line[i] === "\t") i++;
  let delimiter = "";
  for (; i < line.length && !DELIMITER_STOPS.includes(line[i] as string); i++) {
    const c = line[i] as string;
    if (c === "'" || c === '"') {
      const close = line.indexOf(c, i + 1);
      if (close === -1) return undefined;
      delimiter += line.slice(i + 1, close);
      i = close;
    } else if (c === "\\" && i + 1 < line.length) {
      delimiter += line[++i];
    } else {
      delimiter += c;
    }
  }
  return delimiter === "" ? undefined : { delimiter, stripTabs, end: i };
}

/**
 * Where the bodies of `heredocs` starting at `from` end: the index of the
 * newline after the last delimiter line (or `line.length`); `undefined` when a
 * delimiter line never comes. `<<-` strips leading tabs of a line.
 */
function skipBodies(line: string, from: number, heredocs: readonly Heredoc[]): number | undefined {
  let pos = from;
  for (const heredoc of heredocs) {
    for (;;) {
      if (pos >= line.length) return undefined;
      const newline = line.indexOf("\n", pos);
      const stop = newline === -1 ? line.length : newline;
      let text = line.slice(pos, stop);
      if (text.endsWith("\r")) text = text.slice(0, -1);
      if (heredoc.stripTabs) text = text.replace(/^\t+/, "");
      pos = stop + 1;
      if (text === heredoc.delimiter) break;
    }
  }
  return pos - 1;
}

/** The closing brackets of the expansions that bash reads as one unit. */
const CLOSING: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };

/**
 * The index of the bracket that closes `line[at]` (`(`, `[` or `{`), nested
 * ones counted, quoted text and `\`-escaped characters skipped; `undefined`
 * when it never closes.
 */
function closingBracket(line: string, at: number): number | undefined {
  const open = line[at] as string;
  const close = CLOSING[open];
  let depth = 0;
  for (let i = at; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      i++;
    } else if (c === "'") {
      i = line.indexOf("'", i + 1);
      if (i === -1) return undefined;
    } else if (c === '"') {
      for (i++; i < line.length && line[i] !== '"'; i++) if (line[i] === "\\") i++;
      if (i >= line.length) return undefined;
    } else if (c === open) {
      depth++;
    } else if (c === close && --depth === 0) {
      return i;
    }
  }
  return undefined;
}

/**
 * Where an expansion bash reads as one unit ends, when one starts at
 * `line[at]` — `$((…))` and `((…))` at the start of a word (arithmetic: the
 * `(` after the first closes right before `)`, as in bash; otherwise a
 * subshell), `$[…]`, `${…}`; `undefined` for anything else or an unclosed one.
 */
function expansionEnd(line: string, at: number, wordStart: boolean): number | undefined {
  const c = line[at];
  const next = line[at + 1];
  const arithmetic = c === "$" && next === "(" && line[at + 2] === "(" ? at + 2 : c === "(" && next === "(" && wordStart ? at + 1 : undefined;
  if (arithmetic !== undefined) {
    const inner = closingBracket(line, arithmetic);
    return inner !== undefined && line[inner + 1] === ")" ? inner + 1 : undefined;
  }
  return c === "$" && (next === "[" || next === "{") ? closingBracket(line, at + 1) : undefined;
}

/** Words of one command line: quotes removed, operators as words of their own, heredocs dropped. */
export function shellWords(line: string): string[] {
  const words: string[] = [];
  const heredocs: Heredoc[] = []; // redirections of the current line whose bodies follow its newline
  let word = "";
  let open = false; // a word is being built: `""` is a word, a blank is not
  let comment = false; // after an unquoted `#` at the start of a word, to the end of the line
  let plain = 0; // `<<` from here on may be a heredoc: not inside `$((…))`, `((…))`, `$[…]`, `${…}`
  const end = (): void => {
    if (open) words.push(word);
    word = "";
    open = false;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    const next = line[i + 1];
    if (c === "\n") comment = false;
    else if (c === "#" && !open && i >= plain) comment = true;
    if (!comment && i >= plain) plain = (expansionEnd(line, i, !open) ?? i - 1) + 1;
    const heredoc = !comment && i >= plain && c === "<" && next === "<" && line[i + 2] !== "<" ? readHeredoc(line, i) : undefined;
    if (heredoc !== undefined) {
      end();
      heredocs.push(heredoc);
      i = heredoc.end - 1;
    } else if (c === "\n" && heredocs.length > 0) {
      end();
      words.push(c);
      const after = skipBodies(line, i + 1, heredocs);
      heredocs.length = 0;
      if (after !== undefined) i = after; // unclosed: the lines stay commands
    } else if (c === "<" && next === "<") {
      word += line[i + 2] === "<" ? "<<<" : "<<"; // a here-string, or `<<` without a delimiter
      open = true;
      i += line[i + 2] === "<" ? 2 : 1;
    } else if (comment && (c === "'" || c === '"' || c === "\\")) {
      word += c; // no quote and no escape in a comment
      open = true;
    } else if (c === "'") {
      const close = line.indexOf("'", i + 1);
      const stop = close === -1 ? line.length : close;
      word += line.slice(i + 1, stop);
      open = true;
      i = stop;
    } else if (c === '"') {
      open = true;
      for (i++; i < line.length && line[i] !== '"'; i++) {
        const inner = line[i] as string;
        const escaped = line[i + 1];
        if (inner === "\\" && escaped !== undefined && DOUBLE_QUOTE_ESCAPES.includes(escaped)) {
          i++;
          if (escaped !== "\n") word += escaped;
        } else {
          word += inner;
        }
      }
    } else if (c === "\\") {
      if (next === undefined) continue;
      i++;
      if (next === "\n") continue; // a line continuation
      word += next;
      open = true;
    } else if (c === "\n" || c === ";") {
      end();
      words.push(c);
    } else if ((c === "&" || c === "|") && next === c) {
      end();
      words.push(c + c);
      i++;
    } else if (c === "|") {
      end();
      words.push(c);
    } else if (c === " " || c === "\t" || c === "\r") {
      end();
    } else {
      word += c;
      open = true;
    }
  }
  end();
  return words;
}
