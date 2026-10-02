/**
 * `write_scope` of a Run (F1, REQ-ENF-002): what the operation may write, and
 * the narrowing by `--scope`. A path is inside the Run when it matches
 * `write_scope` and, if `scope` is not empty, `scope` too.
 */
import type { WarrantConfig } from "../config.js";
import type { Ctx } from "../ctx.js";
import { WarrantError } from "../errors.js";
import { toProjectPaths } from "../git/paths.js";
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
 * `implement` — `<paths.src>/**`, `<paths.tests>/**`, `<dir>/**` of each
 * `paths.data` directory (REQ-KRN-037), `tasks.md`, `design.md` and `specs/**` of the Change, not `proposal.md` (a spec edit after approval is
 * judged by gate `spec-approved`, ADR-0040 п. 4); `review` — nothing, a review
 * only reads (REQ-ENF-002). `implement` when no code root is set is `CONFIG_INVALID`.
 */
export function writeScopeOf(operation: RunOperation, change: string, config: WarrantConfig): string[] {
  const dir = `openspec/changes/${change}`;
  if (operation === "review") return [];
  if (operation === "specify") return [`${dir}/**`];
  const code = codeScope(config);
  if (code.length === 0) {
    throw new WarrantError("CONFIG_INVALID", "--operation implement needs paths.src, paths.tests or paths.data in .warrant/warrant.json", {
      path: ".warrant/warrant.json#/paths",
      hint: 'set "paths": { "src": "<dir>", "tests": "<dir>" } or "data": ["<dir>"] in .warrant/warrant.json, then `warrant validate`'
    });
  }
  return code.concat(`${dir}/tasks.md`, `${dir}/design.md`, `${dir}/specs/**`);
}

/**
 * `<paths.src>/**`, `<paths.tests>/**` and `<dir>/**` of each `paths.data` directory of
 * `warrant.json`, in that order, those that give a root: the code, tests and data of the
 * project (REQ-KRN-037); a root repeated after normalization once.
 */
export function codeScope(config: WarrantConfig): string[] {
  const roots = [config.paths.src, config.paths.tests, ...(config.paths.data ?? [])]
    .map(directory)
    .filter((d): d is string => d !== undefined);
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

/** A finding of `run start` in `data.findings[]` (REQ-ENF-002): the Run starts, the exit code does not change. */
export interface StartFinding {
  code: "UNCOMMITTED_IN_SCOPE";
  paths: string[];
  hint: string;
}

/**
 * `UNCOMMITTED_IN_SCOPE` (REQ-ENF-002, ADR-0044 п. 5): the files inside
 * `writeScope` that differ from `HEAD` in the index or the work tree
 * (deleted ones too) or are untracked and not ignored — git's own answer
 * (`GitPort.dirty`), project paths in code-unit order. The result of a Run is
 * bounded by a commit: work already there is not the Run's. Without git (no
 * work tree, `git status` failed) there is no finding.
 */
export async function uncommittedInScope(ctx: Pick<Ctx, "git">, writeScope: readonly string[]): Promise<StartFinding[]> {
  if (writeScope.length === 0) return [];
  const prefix = await ctx.git.prefix();
  if (prefix === null) return [];
  const bases = [...new Set(writeScope.map((glob) => globBase(glob) || "."))];
  const dirty = await ctx.git.dirty(bases);
  if (!dirty.ok) return [];
  const inside = pathMatcher(writeScope);
  const paths = [...new Set(toProjectPaths(prefix, dirty.value).filter((file) => inside(file)))].sort();
  if (paths.length === 0) return [];
  return [
    {
      code: "UNCOMMITTED_IN_SCOPE",
      paths,
      hint: "the result of a Run is bounded by a commit: commit this work, or remove what is not yours (`git status`), before the Run writes beside it"
    }
  ];
}
