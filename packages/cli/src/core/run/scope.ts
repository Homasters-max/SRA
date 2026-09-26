/**
 * `write_scope` of a Run (F1, REQ-ENF-002): what the operation may write, and
 * the narrowing by `--scope`. A path is inside the Run when it matches
 * `write_scope` and, if `scope` is not empty, `scope` too.
 */
import type { WarrantConfig } from "../config.js";
import { WarrantError } from "../errors.js";
import { pathMatcher } from "../glob.js";
import type { RunOperation } from "./types.js";

/** A `paths.*` value of `warrant.json` as a directory prefix: without leading `./` and trailing slashes. */
function directory(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const dir = value.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  return dir === "" || dir === "." ? undefined : dir;
}

/**
 * `write_scope` of `operation` on `change`: `specify` — the Change directory;
 * `implement` — `<paths.src>/**`, `<paths.tests>/**` and `tasks.md` of the
 * Change; `review` — nothing, a review only reads (REQ-ENF-002). `implement`
 * without either path is `CONFIG_INVALID`.
 */
export function writeScopeOf(operation: RunOperation, change: string, config: WarrantConfig): string[] {
  const dir = `openspec/changes/${change}`;
  if (operation === "review") return [];
  if (operation === "specify") return [`${dir}/**`];
  const code = codeScope(config);
  if (code.length === 0) {
    throw new WarrantError("CONFIG_INVALID", "--operation implement needs paths.src or paths.tests in .warrant/warrant.json", {
      path: ".warrant/warrant.json#/paths",
      hint: 'set "paths": { "src": "<dir>", "tests": "<dir>" } in .warrant/warrant.json, then `warrant validate`'
    });
  }
  return code.concat(`${dir}/tasks.md`);
}

/** `<paths.src>/**` and `<paths.tests>/**` of `warrant.json`, those that are set: the code and tests of the project. */
export function codeScope(config: WarrantConfig): string[] {
  const roots = [directory(config.paths.src), directory(config.paths.tests)].filter((d): d is string => d !== undefined);
  return [...new Set(roots)].map((root) => `${root}/**`);
}

/** The predicate «inside the Run»: `write_scope` and a non-empty `scope`, both. */
export function scopeMatcher(writeScope: readonly string[], scope: readonly string[]): (path: string) => boolean {
  const write = pathMatcher(writeScope);
  if (scope.length === 0) return write;
  const narrow = pathMatcher(scope);
  return (path) => write(path) && narrow(path);
}

/**
 * The directory or file a glob can match under: its segments up to the first
 * one with a glob character. `src/**` → `src`, `a/b.md` → `a/b.md`, `**` → ``.
 */
export function globBase(glob: string): string {
  const segments = glob.split("/");
  const fixed: string[] = [];
  for (const segment of segments) {
    if (/[*?[\]{}()!+@]/.test(segment)) break;
    fixed.push(segment);
  }
  return fixed.join("/");
}
