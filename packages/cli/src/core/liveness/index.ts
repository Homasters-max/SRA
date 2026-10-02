/**
 * Liveness of the frontend hooks (REQ-VER-009, ADR-0018 п. 5, D-14, F10): a
 * path of the Change's diff, removals aside, under `paths.src` ∪ `paths.tests` ∪ `paths.data`
 * that no `post` event of the Change's Runs names was changed without the hooks — the
 * finding `FRONTEND_HOOKS_INACTIVE`. A signal, never a verdict: an edit by a
 * human without hooks is legitimate, so the finding changes no verdict, no
 * `controller_action` and no exit code.
 *
 * Pure: the caller gives the entries of the diff (the diff `scope-valid` judges)
 * and the Runs of the Change (design §2).
 */
import type { WarrantConfig } from "../config.js";
import { pathMatcher } from "../glob.js";
import type { DiffEntry } from "../ports/git.js";
import { codeScope } from "../run/scope.js";
import type { Run } from "../run/types.js";

export const HOOKS_INACTIVE = "FRONTEND_HOOKS_INACTIVE";

/** Paths the finding names; the rest is counted in `more`. */
export const HOOKS_INACTIVE_PATHS = 10;

export interface HooksInactiveFinding {
  code: typeof HOOKS_INACTIVE;
  paths: string[];
  more: number;
  message: string;
}

/**
 * `FRONTEND_HOOKS_INACTIVE` for the paths of `diff` (in its order) under
 * `paths.src` ∪ `paths.tests` ∪ `paths.data` of `config` without a `post` event naming them
 * in any of `runs`; undefined when there are none, or when `config` sets
 * no code root (`paths.src`, `paths.tests`, `paths.data`). A removed path is not judged: a
 * removal goes through the shell, no `post` event could name it; a rename is
 * judged by its target.
 */
export function hooksInactive(
  diff: readonly DiffEntry[],
  runs: readonly Pick<Run, "guard_events">[],
  config: WarrantConfig
): HooksInactiveFinding | undefined {
  const scope = codeScope(config);
  if (scope.length === 0) return undefined;
  const code = pathMatcher(scope);

  const seen = new Set<string>();
  for (const run of runs) {
    for (const event of run.guard_events) if (event.phase === "post") for (const p of event.paths) seen.add(p);
  }
  const written = diff.filter((entry) => entry.status !== "D").map((entry) => entry.path);
  const missing = [...new Set(written)].filter((p) => code(p) && !seen.has(p));
  if (missing.length === 0) return undefined;

  const paths = missing.slice(0, HOOKS_INACTIVE_PATHS);
  const more = missing.length - paths.length;
  const tail = more > 0 ? ` and ${more} more` : "";
  return {
    code: HOOKS_INACTIVE,
    paths,
    more,
    message: `changed without a post event of warrant guard in the Runs of the Change: ${paths.join(", ")}${tail}`
  };
}
