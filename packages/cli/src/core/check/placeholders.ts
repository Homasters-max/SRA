/**
 * Placeholders of `run.command` / `run.scoped_command` (P-14, design §2,
 * REQ-KRN-010).
 *
 * The argv is never handed to a shell, so expansion works on argv elements:
 * `{out}` and `{change}` are replaced inside a string; `{paths}` must be a
 * whole element and becomes one element per path. `{paths}` inside a longer
 * element would have to be joined somehow — that is a quoting question the
 * argv form exists to avoid, so it is refused with `USAGE`.
 *
 * Other `{name}` tokens are left alone: the check schema already rejects them
 * (I-67), and `{}` or `{ a: 1 }` in `node -e` code are not placeholders.
 */
import { WarrantError } from "../errors.js";

export const PATHS_PLACEHOLDER = "{paths}";

export interface PlaceholderValues {
  /** `{out}`: the run output directory. */
  out: string;
  /** `{change}`: the Change id. */
  change: string;
  /** `{paths}`: the `--paths` list; undefined for a full run. */
  paths?: readonly string[] | undefined;
}

export function expandArgv(argv: readonly string[], values: PlaceholderValues): string[] {
  const out: string[] = [];
  for (const element of argv) {
    if (element === PATHS_PLACEHOLDER) {
      if (values.paths === undefined) {
        throw new WarrantError("USAGE", "the command uses {paths}, but no --paths were given");
      }
      out.push(...values.paths);
      continue;
    }
    if (element.includes(PATHS_PLACEHOLDER)) {
      throw new WarrantError(
        "USAGE",
        `{paths} must be a whole argv element, got ${JSON.stringify(element)}; it expands into one element per path`
      );
    }
    out.push(element.split("{out}").join(values.out).split("{change}").join(values.change));
  }
  return out;
}

/** `--paths a,b` as a list: trimmed, empty entries dropped, order kept. */
export function splitPaths(raw: string): string[] {
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
}
