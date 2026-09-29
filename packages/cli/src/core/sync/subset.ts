/**
 * The second kind of `sync` target (design phase-4a §8): a file WARRANT owns
 * only some entries of. The target itself says which entries are ours
 * (`own`), how to put them into the current file keeping everything else
 * (`merge`) and where the current file lacks them (`drift`), so `sync`, which
 * writes `merge`, and `validate`, which reports `drift`, read one definition
 * (audit core-seams §3.4).
 */
import type { CliError } from "../errors.js";

/** One entry `sync` owns in a file, as found in the current bytes. */
export interface OwnEntry {
  /** JSON Pointer of the entry in a JSON file; `""` for a line of a text file. */
  pointer: string;
  /** True when the current file holds the entry in exactly the form `sync` writes. */
  exact: boolean;
}

/** What `merge` gives: the new bytes (and the JSON value for `writeJsonFile`), or why it cannot merge. */
export type Merged = { bytes: Buffer; json?: unknown } | { error: CliError };

export interface SubsetTarget {
  /** Path relative to the project root, POSIX separators. */
  path: string;
  /** Our entries in `current` (undefined: no file). */
  own(current: Buffer | undefined): OwnEntry[];
  /** `current` with our entries in exact form and every other key, entry and line kept. */
  merge(current: Buffer | undefined): Merged;
  /** Pointers of our entries `current` lacks in exact form, without repeats; empty when in sync. */
  drift(current: Buffer | undefined): string[];
}

/** A target from `own` and `merge`; `drift` is derived from `own`, so the two cannot disagree. */
export function subsetTarget(target: Omit<SubsetTarget, "drift">): SubsetTarget {
  return {
    ...target,
    drift: (current) => [...new Set(target.own(current).filter((entry) => !entry.exact).map((entry) => entry.pointer))]
  };
}

/** `path` of an `errors[]` entry for a drift pointer: the file, with `#<pointer>` inside a JSON file. */
export function driftPath(file: string, pointer: string): string {
  return pointer === "" ? file : `${file}#${pointer}`;
}

/** True when some line of `text`, without surrounding spaces and CR, is exactly `line`. */
function hasLine(text: string, line: string): boolean {
  return text.split("\n").some((current) => current.trim() === line);
}

/**
 * A text file where `sync` owns whole lines (`.gitignore`): a
 * missing line is appended at the end, on its own line, with the file's line
 * ending; the file is created when absent.
 */
export function linesTarget(path: string, lines: readonly string[]): SubsetTarget {
  return subsetTarget({
    path,
    own(current) {
      const text = current?.toString("utf8") ?? "";
      return lines.map((line) => ({ pointer: "", exact: hasLine(text, line) }));
    },
    merge(current) {
      let text = current?.toString("utf8") ?? "";
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      for (const line of lines) {
        if (hasLine(text, line)) continue;
        const separator = text === "" || text.endsWith("\n") ? "" : eol;
        text = `${text}${separator}${line}${eol}`;
      }
      return { bytes: Buffer.from(text, "utf8") };
    }
  });
}
