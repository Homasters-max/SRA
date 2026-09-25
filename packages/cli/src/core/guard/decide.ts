/**
 * The decisions of `guard` before an action (REQ-ENF-004, design §6): pure
 * functions of the Run, the loaded project and the paths of the event.
 *
 * - `edit` with an active Run — `deny` for a path outside `write_scope` or a
 *   non-empty `scope` (F1);
 * - `edit` without one — `deny` for the paths of code, tests, Changes and the
 *   policy paths, `allow` for the rest, both with the hint `run start`
 *   (ADR-0022 п. 7);
 * - `shell` — `deny` for a simple command that starts with a `guard_prefixes`
 *   entry of a check that must not run directly (ADR-0017 п. 5, F8).
 */
import { effectiveCheck } from "../check/execute.js";
import { pathMatcher } from "../glob.js";
import { isPlainObject, strings } from "../json.js";
import type { LoadResult } from "../packs/types.js";
import { codeScope, scopeMatcher } from "../run/scope.js";
import type { GuardDecision, Run } from "../run/types.js";
import { policyPaths } from "../transition/gates.js";
import { defaultPrefix, simpleCommands, startsWithPrefix } from "./shell.js";

/** What guard answers, and the `argv` its event keeps (only a `deny` by a prefix, F16). */
export interface Answer {
  decision: GuardDecision;
  reason?: string;
  hints: string[];
  argv?: string[];
}

/** `hint` of an edit without an active Run (ADR-0022 п. 7). */
export const RUN_START_HINT = "start a Run first: `warrant run start <change> --operation specify|implement`";

/** `hint` of a failure before the action (F9). */
export const VALIDATE_HINT = "run `warrant validate`";

const allow = (hints: string[] = []): Answer => ({ decision: "allow", hints });

/** `pre` `edit` with the active Run: every path inside `write_scope` and a non-empty `scope`. */
export function editWithRun(run: Run, files: readonly string[]): Answer {
  const inside = scopeMatcher(run.write_scope, run.scope);
  const outside = files.filter((file) => !inside(file));
  if (outside.length === 0) return allow();
  const narrowed = run.scope.length === 0 ? "" : `; scope: ${run.scope.join(", ")}`;
  return {
    decision: "deny",
    reason: `${outside.join(", ")} outside the Run ${run.id} of ${run.change}: write_scope: ${run.write_scope.join(", ")}${narrowed}`,
    hints: ["edit only inside the write_scope of the Run; for other paths `warrant run finish`, then `warrant run start` with the operation that writes them"]
  };
}

/** Globs an edit without an active Run may not touch: code, tests, Changes, policy paths (ADR-0022 п. 7). */
export function guardedWithoutRun(loaded: LoadResult): string[] {
  return [...new Set([...codeScope(loaded.config), "openspec/changes/**", ...policyPaths(loaded)])];
}

/** `pre` `edit` without an active Run. */
export function editWithoutRun(loaded: LoadResult, files: readonly string[]): Answer {
  const guarded = guardedWithoutRun(loaded);
  const matches = pathMatcher(guarded);
  const denied = files.filter((file) => matches(file));
  if (denied.length === 0) return allow([RUN_START_HINT]);
  return {
    decision: "deny",
    reason: `no active Run in this worktree: ${denied.join(", ")} under ${guarded.join(", ")} is edited only in a Run`,
    hints: [RUN_START_HINT]
  };
}

/** A check guard keeps from running directly, and the prefixes of its command. */
export interface GuardedCheck {
  id: string;
  /** Why: `execution.exclusive: true` or `execution.local: "<value>"`. */
  why: string;
  prefixes: string[][];
  /** It has `run.scoped_command`: `warrant check` runs it over `--paths`. */
  scoped: boolean;
}

/**
 * Checks with `execution.exclusive: true` or `execution.local` other than
 * `allowed` (ADR-0017 п. 5), sorted by id: their `execution.guard_prefixes`,
 * by default the first words of `run.command` (`defaultPrefix`).
 */
export function guardedChecks(loaded: LoadResult): GuardedCheck[] {
  const out: GuardedCheck[] = [];
  for (const object of loaded.objects) {
    if (object.kind !== "check") continue;
    const check = effectiveCheck(object);
    const execution = isPlainObject(check["execution"]) ? check["execution"] : {};
    const local = typeof execution["local"] === "string" ? execution["local"] : "allowed";
    const why = execution["exclusive"] === true ? "execution.exclusive: true" : local !== "allowed" ? `execution.local: "${local}"` : undefined;
    if (why === undefined) continue;
    const run = isPlainObject(check["run"]) ? check["run"] : {};
    const declared = execution["guard_prefixes"];
    const prefixes = Array.isArray(declared)
      ? declared.map((prefix) => strings(prefix)).filter((prefix) => prefix.length > 0)
      : [defaultPrefix(strings(run["command"]))].filter((prefix) => prefix.length > 0);
    out.push({ id: object.id, why, prefixes, scoped: strings(run["scoped_command"]).length > 0 });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * `pre` `shell`: `deny` when a simple command of `argv` starts with a prefix
 * of a guarded check; the hint names `warrant check` of the Change of the
 * active Run (`<change>` without one).
 */
export function shellAnswer(argv: readonly string[] | undefined, checks: readonly GuardedCheck[], change: string | undefined): Answer {
  if (argv === undefined || checks.length === 0) return allow();
  for (const command of simpleCommands(argv)) {
    for (const check of checks) {
      const prefix = check.prefixes.find((p) => startsWithPrefix(command, p));
      if (prefix === undefined) continue;
      return {
        decision: "deny",
        reason: `\`${command.join(" ")}\` runs check ${check.id} directly (prefix \`${prefix.join(" ")}\`, ${check.why}): it runs only through warrant check`,
        hints: [`warrant check ${change ?? "<change>"} ${check.id}${check.scoped ? " [--paths <a,b>]" : ""}`],
        argv: [...argv]
      };
    }
  }
  return allow();
}
