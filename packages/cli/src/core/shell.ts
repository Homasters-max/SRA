/**
 * The minimal shell tokenizer of guard (design phase-4a §6, ADR-0017 п. 5): a
 * command line as words. It knows quotes (`'…'` literal, `"…"` with `\` before
 * `"`, `\`, `$`, `` ` `` and a newline), `\` outside quotes, the operators
 * `&&`, `||`, `;`, `|` and a newline — each a word of its own. `$(…)`, aliases
 * and scripts are not expanded — the limit INV-07 (ADR-0017 Consequences).
 *
 * Rank 0 so that a frontend adapter makes the `argv` of a shell event with it
 * (design §7); the split into simple commands and the match against
 * `guard_prefixes` are `core/guard/shell.ts`.
 */

/** Words that end one simple command and start the next. */
export const SHELL_OPERATORS: ReadonlySet<string> = new Set(["&&", "||", ";", "|", "\n"]);

/** Characters `\` escapes inside double quotes. */
const DOUBLE_QUOTE_ESCAPES = '"\\$`\n';

/** Words of one command line: quotes removed, operators as words of their own. */
export function shellWords(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let open = false; // a word is being built: `""` is a word, a blank is not
  const end = (): void => {
    if (open) words.push(word);
    word = "";
    open = false;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    const next = line[i + 1];
    if (c === "'") {
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
