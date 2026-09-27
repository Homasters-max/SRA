/**
 * The decisions of `guard` before an action (REQ-ENF-004, design §6): pure
 * functions of the Run, the loaded project and the paths of the event.
 *
 * - `edit` with an active Run — `deny` for a path outside `write_scope` or a
 *   non-empty `scope` (F1); under a `review` Run — `deny` for any path;
 * - `shell` under a `review` Run — `allow` only for the strict form of
 *   `warrant run submit [--file <path>] [--dry-run]`;
 * - `edit` without one — `deny` for the paths of code, tests, Changes and the
 *   policy paths, `allow` for the rest, both with the hint `run start`
 *   (ADR-0022 п. 7);
 * - in both `deny` of an edit, the state the CLI writes gets the hint of its
 *   commands (I-190), a policy path no Run writes the hint of a human edit in
 *   a `factory-change` Change (BL-56), instead of `run start` / `run finish`;
 * - `shell` — `deny` for a simple command that starts with a `guard_prefixes`
 *   entry of a check that must not run directly (ADR-0017 п. 5, F8).
 */
import { effectiveCheck } from "../check/execute.js";
import { pathMatcher } from "../glob.js";
import { isPlainObject, strings } from "../json.js";
import { policyPaths } from "../packs/objects.js";
import type { LoadResult } from "../packs/types.js";
import { codeScope, scopeMatcher } from "../run/scope.js";
import type { GuardResult } from "../ports/frontend.js";
import type { Run } from "../run/types.js";
import { defaultPrefix, leafCommands, simpleCommands, startsWithPrefix } from "./shell.js";

/** What guard answers, and the `argv` its event keeps (only a `deny` by a prefix, F16). */
export interface Answer extends GuardResult {
  argv?: string[];
}

/** `hint` of an edit without an active Run (ADR-0022 п. 7). */
export const RUN_START_HINT = "start a Run first: `warrant run start <change> --operation specify|implement`";

/** `hint` of a failure before the action (F9). */
export const VALIDATE_HINT = "run `warrant validate`";

const allow = (hints: string[] = []): Answer => ({ decision: "allow", hints });

/** The words every simple command of a shell line under a `review` Run starts with (REQ-ENF-004). */
export const SUBMIT_PREFIX: readonly string[] = ["warrant", "run", "submit"];

/**
 * A path after `--file` under a `review` Run: letters, digits and `_ . / \ : @ + , ~ -`,
 * no leading `-` — no shell metacharacter, no blank (REQ-ENF-004, REQ-ENF-007).
 */
const SUBMIT_PATH_RE = /^(?!-)[\p{L}\p{N}_./\\:@+,~-]+$/u;

/** `hint` of a refusal under a `review` Run. */
export const SUBMIT_HINT = "a review Run only reads; hand in its result with `warrant run submit` (envelope warrant://skill-result/1)";

/** `hint` of a `deny` for the state the CLI writes (I-190): its commands, not a Run. */
export const CLI_STATE_HINT =
  "records, evidence, Runs and waivers are written by the CLI, not by hand: `warrant transition`, `warrant unknown`, `warrant check`, `warrant waive`, `warrant run`";

/** `hint` of a `deny` for a policy path no Run operation writes (BL-56, ADR-0040 п. 7). */
export const HUMAN_ONLY_HINT =
  "no Run operation writes this path: the edit is made by a human (maintainer) outside the agent session, in a Change with the profile `factory-change` (ADR-0040 п. 7)";

/** `hint` of an edit outside the `write_scope` of the active Run. */
export const RUN_SWITCH_HINT =
  "edit only inside the write_scope of the Run; for other paths `warrant run finish`, then `warrant run start` with the operation that writes them";

/** Classes of a denied path whose way out is not a Run (REQ-ENF-004). */
export interface PathClasses {
  /** State the CLI writes: records, waivers, `<state>/evidence/**`, `<state>/runs/**` (I-190). */
  cliState(file: string): boolean;
  /** A policy path outside `paths.src`, `paths.tests` and `openspec/changes/**`: no Run operation writes it (BL-56). */
  humanOnly(file: string): boolean;
}

/**
 * The classes of paths over the loaded project; `cliState` is the matcher of
 * `<state>` of the process (`cliWrittenState`), and wins over `humanOnly`.
 */
export function pathClasses(loaded: LoadResult, cliState: (file: string) => boolean): PathClasses {
  const policy = pathMatcher(policyPaths(loaded));
  const runWritten = pathMatcher([...codeScope(loaded.config), "openspec/changes/**"]);
  return {
    cliState,
    humanOnly: (file) => !cliState(file) && policy(file) && !runWritten(file)
  };
}

/**
 * Hints of a `deny` of `files`: the CLI commands for its state, the human for
 * a path no Run writes, and `fallback` for the rest — each once, only for a
 * class present among `files`.
 */
function denyHints(files: readonly string[], classes: PathClasses, fallback: string): string[] {
  const hints = new Set<string>();
  for (const file of files) {
    if (classes.cliState(file)) hints.add(CLI_STATE_HINT);
    else if (classes.humanOnly(file)) hints.add(HUMAN_ONLY_HINT);
    else hints.add(fallback);
  }
  return [...hints];
}

/**
 * `pre` `edit` with the active Run: every path inside `write_scope` and a
 * non-empty `scope`; none under a `review` Run. `classes` is asked only for a
 * refusal outside the `write_scope`.
 */
export function editWithRun(run: Run, files: readonly string[], classes: () => PathClasses): Answer {
  if (run.operation === "review" && files.length > 0) {
    return {
      decision: "deny",
      reason: `${files.join(", ")}: the Run ${run.id} of ${run.change} is a review, and a review Run only reads`,
      hints: [SUBMIT_HINT]
    };
  }
  const inside = scopeMatcher(run.write_scope, run.scope);
  const outside = files.filter((file) => !inside(file));
  if (outside.length === 0) return allow();
  const narrowed = run.scope.length === 0 ? "" : `; scope: ${run.scope.join(", ")}`;
  return {
    decision: "deny",
    reason: `${outside.join(", ")} outside the Run ${run.id} of ${run.change}: write_scope: ${run.write_scope.join(", ")}${narrowed}`,
    hints: denyHints(outside, classes(), RUN_SWITCH_HINT)
  };
}

/** Globs an edit without an active Run may not touch: code, tests, Changes, policy paths (ADR-0022 п. 7). */
export function guardedWithoutRun(loaded: LoadResult): string[] {
  return [...new Set([...codeScope(loaded.config), "openspec/changes/**", ...policyPaths(loaded)])];
}

/** `pre` `edit` without an active Run. */
export function editWithoutRun(loaded: LoadResult, files: readonly string[], classes: PathClasses): Answer {
  const guarded = guardedWithoutRun(loaded);
  const matches = pathMatcher(guarded);
  const denied = files.filter((file) => matches(file));
  if (denied.length === 0) return allow([RUN_START_HINT]);
  return {
    decision: "deny",
    reason: `no active Run in this worktree: ${denied.join(", ")} under ${guarded.join(", ")} is edited only in a Run`,
    hints: denyHints(denied, classes, RUN_START_HINT)
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
 * True for the strict form `warrant run submit [--file <path>] [--dry-run]`
 * (REQ-ENF-007): exactly these words, each option at most once, in any order,
 * the path by {@link SUBMIT_PATH_RE}.
 */
function isSubmit(command: readonly string[]): boolean {
  if (!startsWithPrefix(command, SUBMIT_PREFIX)) return false;
  let dryRun = false;
  let file = false;
  for (let i = SUBMIT_PREFIX.length; i < command.length; i++) {
    const word = command[i];
    if (word === "--dry-run" && !dryRun) {
      dryRun = true;
    } else if (word === "--file" && !file && SUBMIT_PATH_RE.test(command[i + 1] ?? "")) {
      file = true;
      i++;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * `pre` `shell` under a `review` Run, fail-closed: `allow` only when every
 * command of `argv` as written — a leading `VAR=…` kept; the commands inside
 * exactly `bash -c <string>`, not the wrapper — is the strict form of
 * `warrant run submit` ({@link isSubmit}); the operators of the tokenizer and
 * a heredoc (data, I-167) may join them. Any other word — `&`, a redirection,
 * `$(…)`, a comment, an assignment — or no command at all is `deny`.
 */
export function reviewShellAnswer(argv: readonly string[] | undefined, run: Run): Answer {
  const commands = argv === undefined ? [] : leafCommands(argv, true);
  const other = commands.find((command) => !isSubmit(command));
  if (commands.length > 0 && other === undefined) return allow();
  const what = other === undefined ? "no command" : `\`${other.join(" ")}\``;
  return {
    decision: "deny",
    reason: `${what} under the review Run ${run.id} of ${run.change}: a review Run runs only \`${SUBMIT_PREFIX.join(" ")}\``,
    hints: [SUBMIT_HINT]
  };
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
