/**
 * The decisions of `guard` before an action (REQ-ENF-004, design §6): pure
 * functions of the Run, the loaded project and the paths of the event.
 *
 * - `edit` with an active Run — `deny` for a path outside `write_scope` or a
 *   non-empty `scope` (F1); under a `review` Run — `deny` for any path of the
 *   project and for a path outside it that is not in the temporary directory,
 *   where the envelope file goes (ADR-0042 п. 4, I-198);
 * - `shell` under a `review` Run — `allow` only for the strict form of
 *   `warrant run submit [--file <path>] [--dry-run]` and of the commands that
 *   write nothing — `warrant status`, `warrant gate`, `--help`, `git status |
 *   log | diff | show`, `cd` inside the project — and the cancel
 *   `warrant run finish --state CANCELLED` (ADR-0044 п. 5, I-202, I-207);
 * - `edit` without one — `deny` for the paths of code, tests, Changes and the
 *   policy paths, `allow` for the rest, both with the hint `run start`
 *   (ADR-0022 п. 7);
 * - in both `deny` of an edit, the state the CLI writes gets the hint of its
 *   commands (I-190), a policy path no Run writes the hint of a human edit in
 *   a `factory-change` Change (BL-56), instead of `run start` / `run finish`;
 * - `shell` — `deny` for a simple command that starts with a `guard_prefixes`
 *   entry of a check that must not run directly (ADR-0017 п. 5, F8);
 * - a policy that does not load, where a decision above needs it — the
 *   recovery mode (ADR-0053 п. 2): an edit of `.warrant/warrant.json` alone and
 *   a shell line of recovery commands and commands that write nothing pass,
 *   any other edit of the project is refused with the versions and the way out.
 *
 * With `cli` in `warrant.json` (ADR-0053 п. 3) a simple command `node <cli> …`
 * run at the project root reads as `warrant …` in the strict forms of a
 * `review` Run and of the recovery mode, and their hints name that form.
 */
import path from "node:path";

import type { CliError } from "../errors.js";
import { pathMatcher } from "../glob.js";
import { isPlainObject, strings } from "../json.js";
import { effectiveCheck, policyPaths } from "../packs/objects.js";
import type { LoadResult } from "../packs/types.js";
import { codeScope, scopeMatcher } from "../run/scope.js";
import type { GuardResult } from "../ports/frontend.js";
import type { Run } from "../run/types.js";
import { KERNEL_VERSION } from "../../version.js";
import { defaultPrefix, type GuardPrefix, leafCommands, matchesPrefix, prefixText, simpleCommands, startsWithPrefix } from "./shell.js";

/** What guard answers, and the `argv` its event keeps (only a `deny` by a prefix, F16). */
export interface Answer extends GuardResult {
  argv?: string[];
}

/** `hint` of an edit without an active Run (ADR-0022 п. 7). */
export const RUN_START_HINT = "start a Run first: `warrant run start <change> --operation specify|implement`";

/** `hint` of a failure before the action (F9). */
export const VALIDATE_HINT = "run `warrant validate`";

/** The pin of the project: the one path an edit may touch while the policy does not load (ADR-0053 п. 2). */
export const CONFIG_FILE = ".warrant/warrant.json";

/**
 * `text` with its commands in the form of the pinned CLI (ADR-0053 п. 3):
 * every `` `warrant `` becomes `` `node <cli> ``, and the text says to run them
 * from the project root — the only place `node <cli>` is that file. Without
 * `cli`, or without a command, `text` as it is.
 */
export function inCliForm(text: string, cli: string | undefined): string {
  if (cli === undefined || !text.includes("`warrant ")) return text;
  return `${text.split("`warrant ").join(`\`node ${cli} `)} (from the project root)`;
}

const allow = (hints: string[] = []): Answer => ({ decision: "allow", hints });

/** The words every simple command of a shell line under a `review` Run starts with (REQ-ENF-004). */
export const SUBMIT_PREFIX: readonly string[] = ["warrant", "run", "submit"];

/**
 * A path after `--file` under a `review` Run: letters, digits and `_ . / \ : @ + , ~ -`,
 * no leading `-` — no shell metacharacter, no blank (REQ-ENF-004, REQ-ENF-007).
 */
const SUBMIT_PATH_RE = /^(?!-)[\p{L}\p{N}_./\\:@+,~-]+$/u;

/** `hint` of a refusal under a `review` Run: the result, the cancel and the state (ADR-0044 п. 5). */
export const SUBMIT_HINT =
  "a review Run only reads; hand in its result with `warrant run submit` (envelope warrant://skill-result/1); to stop the review: `warrant run finish --state CANCELLED`; to read state: `warrant status`";

/** {@link SUBMIT_HINT} in the form of the pinned CLI. */
export function submitHint(cli: string | undefined): string {
  return inCliForm(SUBMIT_HINT, cli);
}

/** `hint` of a `deny` for the state the CLI writes (I-190): its commands, not a Run. */
export const CLI_STATE_HINT =
  "records, evidence, Runs and waivers are written by the CLI, not by hand: `warrant transition`, `warrant unknown`, `warrant check`, `warrant waive`, `warrant run`";

/** `hint` of a `deny` for a policy path no Run operation writes (BL-56, ADR-0040 п. 7). */
export const HUMAN_ONLY_HINT =
  "no Run operation writes this path: the edit is made by a human (maintainer) outside the agent session, in a Change with the profile `factory-change` (ADR-0040 п. 7)";

/** `hint` of an edit of another checkout under WARRANT under an active Run (#138). */
export const OTHER_CHECKOUT_HINT = "edit it from a session whose working directory is that checkout";

/** The part of the hint when the project of the event has the active Run. */
const OTHER_CHECKOUT_FINISH = ", or end the Run of this checkout first: `warrant run finish`";

/**
 * `pre` `edit` of a path in another checkout under WARRANT while the project
 * of the event (`run`) or that checkout has an active Run (REQ-ENF-004, #138):
 * `deny`; neither the reason nor the hint names the path — it lies outside
 * the project and the reason goes to `guard_events[]`.
 */
export function otherCheckoutAnswer(run: Run | undefined): Answer {
  return {
    decision: "deny",
    reason: "the edit is in another checkout under WARRANT, where a Run is active or this session runs one: a Run guards only the checkout of its session",
    hints: [OTHER_CHECKOUT_HINT + (run === undefined ? "" : OTHER_CHECKOUT_FINISH)]
  };
}

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

/** Where an edit outside the project lands under a `review` Run (ADR-0042 п. 4). */
export interface ReviewEditPlaces {
  /** The temporary directory, real path: the only place a review Run writes (its envelope file). */
  tempDir: string;
  /** The temporary directory lies inside the project: an envelope cannot be written anywhere (I-198). */
  tempInProject: boolean;
  /** Paths of the event outside the project and outside the temporary directory. */
  strays: number;
  /** `cli` of `warrant.json` that passes its pattern: the form of the commands of the hints (ADR-0053 п. 3). */
  cli?: string;
}

/**
 * `pre` `edit` under a `review` Run: any path of the project — `deny`, the Run
 * only reads; a path outside it and outside the temporary directory — `deny`,
 * with the directory in the hint only: the reason goes to `guard_events[]`,
 * which is committed, and must not carry a path of the user's disk (I-198);
 * the envelope file in the temporary directory — `allow`.
 */
export function reviewEditAnswer(run: Run, files: readonly string[], places: ReviewEditPlaces): Answer {
  const writeThere = inCliForm(`write the envelope file into ${places.tempDir} and run \`warrant run submit --file <that file>\``, places.cli);
  const submit = submitHint(places.cli);
  if (files.length > 0) {
    const tempInside = places.tempInProject ? "; the temporary directory lies inside the project, so an envelope cannot be written at all" : "";
    return {
      decision: "deny",
      reason: `${files.join(", ")}: the Run ${run.id} of ${run.change} is a review, and a review Run only reads${tempInside}`,
      hints: places.tempInProject ? [submit] : [submit, writeThere]
    };
  }
  if (places.strays > 0) {
    return {
      decision: "deny",
      reason: `an edit outside the project under the review Run ${run.id} of ${run.change}: a review Run writes only its envelope file, into the temporary directory`,
      hints: [writeThere]
    };
  }
  return allow();
}

/**
 * `pre` `edit` with the active Run of `specify` / `implement`: every path
 * inside `write_scope` and a non-empty `scope`; a `review` Run is
 * {@link reviewEditAnswer}. `classes` is asked only for a refusal outside the
 * `write_scope`.
 */
export function editWithRun(run: Run, files: readonly string[], classes: () => PathClasses): Answer {
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
  prefixes: GuardPrefix[];
  /** It has `run.scoped_command`: `warrant check` runs it over `--paths`. */
  scoped: boolean;
}

/**
 * Checks with `execution.exclusive: true` or `execution.local` other than
 * `allowed` (ADR-0017 п. 5), sorted by id: their `execution.guard_prefixes`,
 * by default `defaultPrefix` of `run.command`; a declared prefix has no flags.
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
      ? declared.map((prefix) => ({ words: strings(prefix), flags: [] })).filter((prefix) => prefix.words.length > 0)
      : [defaultPrefix(strings(run["command"]))].filter((prefix) => prefix.words.length > 0);
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

/** The subcommands of `git` that write nothing under a `review` Run (REQ-ENF-004). */
const READING_GIT: ReadonlySet<string> = new Set(["status", "log", "diff", "show"]);

/** Operators that may join a command that writes nothing to the next (I-207): a pipe may not. */
const READING_JOINS: ReadonlySet<string> = new Set(["&&", "||", ";", "\n"]);

/**
 * A character that makes a word more than a word under a `review` Run: a
 * redirection, `&`, a substitution or expansion (`$…`, `` `…` ``, `<(…)`,
 * `{a,b}`), a group. The tokenizer has removed the quotes, so a quoted one is
 * refused too (fail-closed).
 */
const UNSAFE_WORD_RE = /[<>&$`(){}]/;

/**
 * An argument of `git` that writes a file (I-207): `-o…`, a prefix of
 * `--output` from `--ou` on (`=…` too); `--ext-diff` and its prefixes from
 * `--ext` on (git takes an unambiguous prefix of a long option).
 */
function writingGitArgument(word: string): boolean {
  const name = word.split("=")[0] as string;
  if (word.startsWith("-o")) return true;
  if (name.length >= 4 && "--output".startsWith(name)) return true;
  return name.length >= 5 && "--ext-diff".startsWith(name);
}

/** Where `cd` of a shell line under a `review` Run may lead (I-202). */
export interface ReviewShellPlaces {
  /** The `cwd` of the event, absolute. */
  cwd: string;
  /** True when `dir` (absolute) lies inside the project of the event after `realpath`. */
  inProject: (dir: string) => boolean;
  /** True when `dir` (absolute) is the root of the project after `realpath`: where `node <cli>` is the pinned CLI. */
  isRoot?: (dir: string) => boolean;
  /** `cli` of `warrant.json` that passes its pattern (ADR-0053 п. 3). */
  cli?: string;
}

/**
 * `node <cli> …` as `warrant …` (ADR-0053 п. 3): only for `cli` exactly as
 * written in `warrant.json`, and only when every directory the line may be in
 * by now is the project root — elsewhere `node <cli>` runs another file.
 */
function aliased(command: readonly string[], dirs: ReadonlySet<string>, places: ReviewShellPlaces | undefined): readonly string[] {
  const cli = places?.cli;
  const isRoot = places?.isRoot;
  if (cli === undefined || isRoot === undefined || command[0] !== "node" || command[1] !== cli) return command;
  return [...dirs].every((dir) => isRoot(dir)) ? ["warrant", ...command.slice(2)] : command;
}

/**
 * True for `cd <path>` whose path, from every directory the line may be in by
 * now, lies inside the project (I-202); `dirs` gains where it leads — a `cd`
 * that fails leaves the line where it was. No path, `-`, `~`, an option or a
 * second argument is `false`: where that leads is not the path given.
 */
function isCdInside(command: readonly string[], dirs: Set<string>, places: ReviewShellPlaces | undefined): boolean {
  const target = command[1];
  if (places === undefined || command.length !== 2 || target === undefined || target === "" || /^[-~]/.test(target)) return false;
  const reached = [...dirs].map((dir) => path.resolve(dir, target));
  if (!reached.every((dir) => places.inProject(dir))) return false;
  for (const dir of reached) dirs.add(dir);
  return true;
}

/** `warrant run finish --state CANCELLED [--dry-run]`, `--state=CANCELLED` alike, each option once (I-207). */
function isCancel(command: readonly string[]): boolean {
  if (!startsWithPrefix(command, ["warrant", "run", "finish"])) return false;
  let state = false;
  let dryRun = false;
  for (let i = 3; i < command.length; i++) {
    const word = command[i];
    if (word === "--dry-run" && !dryRun) {
      dryRun = true;
    } else if (word === "--state=CANCELLED" && !state) {
      state = true;
    } else if (word === "--state" && command[i + 1] === "CANCELLED" && !state) {
      state = true;
      i++;
    } else {
      return false;
    }
  }
  return state;
}

/**
 * True for a command that writes nothing (REQ-ENF-004, I-207): `warrant
 * status [...]`, `warrant gate <change> [...]`, `warrant <words> --help|-h`,
 * `git status|log|diff|show [...]` without global options and without an
 * argument that writes, `cd` inside the project; no word of it with a
 * redirection, `&`, a substitution or a group.
 */
function isReading(command: readonly string[], dirs: Set<string>, places: ReviewShellPlaces | undefined): boolean {
  if (command.some((word) => UNSAFE_WORD_RE.test(word))) return false;
  const [name, sub] = command;
  if (name === "cd") return isCdInside(command, dirs, places);
  if (name === "git") return sub !== undefined && READING_GIT.has(sub) && !command.slice(2).some(writingGitArgument);
  if (name !== "warrant") return false;
  if (sub === "status") return true;
  if (sub === "gate") return command.length >= 3;
  const last = command[command.length - 1];
  return (last === "--help" || last === "-h") && command.slice(1, -1).every((word) => /^[a-z][a-z-]*$/.test(word));
}

/**
 * `pre` `shell` under a `review` Run, fail-closed: `allow` only when every
 * command of `argv` as written — a leading `VAR=…` kept; the commands inside
 * exactly `bash -c <string>`, not the wrapper — is the strict form of
 * `warrant run submit` ({@link isSubmit}), of a command that writes nothing
 * ({@link isReading}) or of the cancel ({@link isCancel}) (ADR-0044 п. 5).
 * Submits alone may be joined by any operator of the tokenizer and carry a
 * heredoc (data, I-167); with any other command only `&&`, `||`, `;` and a
 * newline join. Any other word — `&`, a redirection, `$(…)`, an assignment —
 * or no command at all is `deny`, with the hint of the result, the cancel and
 * the state. Without `places` no `cd` is allowed.
 */
export function reviewShellAnswer(argv: readonly string[] | undefined, run: Run, places?: ReviewShellPlaces): Answer {
  const operators: string[] = [];
  const commands = argv === undefined ? [] : leafCommands(argv, true, 1, operators);
  const dirs = new Set(places === undefined ? [] : [places.cwd]);
  const read: (readonly string[])[] = [];
  let other: readonly string[] | undefined;
  for (const command of commands) {
    const as = aliased(command, dirs, places);
    read.push(as);
    if (!isSubmit(as) && !isCancel(as) && !isReading(as, dirs, places)) {
      other = command;
      break;
    }
  }
  const join = read.every((command) => isSubmit(command)) ? undefined : operators.find((operator) => !READING_JOINS.has(operator));
  if (commands.length > 0 && other === undefined && join === undefined) return allow();
  if (other === undefined && join !== undefined) other = [join];
  const what = other === undefined ? "no command" : `\`${other.join(" ")}\``;
  return {
    decision: "deny",
    reason:
      `${what} under the review Run ${run.id} of ${run.change}: a review Run runs only \`${SUBMIT_PREFIX.join(" ")}\`, ` +
      "the cancel `warrant run finish --state CANCELLED` and commands that write nothing (`warrant status`, `warrant gate`, `--help`, " +
      "`git status|log|diff|show`, `cd` inside the project), joined only by `&&`, `||`, `;` or a newline",
    hints: [submitHint(places?.cli)]
  };
}

/** How out of a policy that does not load (ADR-0053 п. 2), by the error of the mode. */
export type RecoveryExit = "pin-up" | "cli-older" | "fix-config" | "human";

/** The policy that does not load, as guard tells it: the error of the mode, its way out, the versions (ADR-0053 п. 2). */
export interface RecoveryFailure {
  /** The first `PACK_VERSION_RANGE` among the load errors, else the first one. */
  error: CliError;
  exit: RecoveryExit;
  /** `<id> <version>` of every pack bundled with the CLI, joined: what `pin-up` raises the pin to. */
  carries: string;
  /** The reason of a refusal: the error, the CLI and its packs, the pins of `warrant.json`. */
  reason: string;
}

/**
 * True for a recovery command (ADR-0053 п. 2): `warrant sync [...]`,
 * `warrant validate [...]`, `warrant status [...]`, `warrant --version`,
 * `warrant -V`; no word with a redirection, `&`, a substitution or a group.
 */
function isRecovery(command: readonly string[]): boolean {
  if (command.some((word) => UNSAFE_WORD_RE.test(word))) return false;
  const [name, sub] = command;
  if (name !== "warrant") return false;
  if (sub === "sync" || sub === "validate" || sub === "status") return true;
  return command.length === 2 && (sub === "--version" || sub === "-V");
}

/** The way out of `failure`, in the form of the pinned CLI. */
function exitHint(failure: RecoveryFailure, cli: string | undefined): string {
  switch (failure.exit) {
    case "pin-up":
      return inCliForm(
        `pin-Change: raise packs.<id>.version and kernel in ${CONFIG_FILE} to what this CLI carries (${failure.carries}, kernel ${KERNEL_VERSION}), then run \`warrant sync\``,
        cli
      );
    case "cli-older":
      return cli === undefined
        ? `this CLI is older than the pin: keep ${CONFIG_FILE}; the maintainer installs the CLI of the tag the project pins, outside the agent session`
        : `this CLI is older than the pin: keep ${CONFIG_FILE}; the maintainer updates ${cli} (npm ci, npm run build), outside the agent session`;
    case "fix-config":
      return inCliForm(`fix ${CONFIG_FILE} (guard allows this edit), then run \`warrant validate\``, cli);
    case "human":
      return "the file the reason names is fixed by a human (maintainer) outside the agent session, in a Change with the profile `factory-change` (ADR-0040 п. 7)";
  }
}

/** What guard lets through while the policy does not load (ADR-0053 п. 2). */
function recoveryListHint(cli: string | undefined): string {
  return inCliForm(
    `until the policy loads guard allows only: an edit of ${CONFIG_FILE}; \`warrant sync\`, \`warrant validate\`, \`warrant status\`, ` +
      "`warrant --version` and commands that write nothing (`git status|log|diff|show`, `warrant gate`, `--help`, `cd` inside the project), " +
      "joined only by `&&`, `||`, `;` or a newline; paths outside the project are not guarded",
    cli
  );
}

/** Hints of a refusal of the recovery mode: the hint of the error, the way out, what passes. */
export function recoveryHints(failure: RecoveryFailure, cli: string | undefined): string[] {
  const own = failure.error.hint === undefined ? [] : [inCliForm(failure.error.hint, cli)];
  return [...own, exitHint(failure, cli), recoveryListHint(cli)];
}

/** `hint` after an edit of the pin: the next step is `sync`, not a Run (ADR-0053 п. 2). */
export function syncHint(cli: string | undefined): string {
  return inCliForm(`${CONFIG_FILE} changed: run \`warrant sync\``, cli);
}

/**
 * `pre` `edit` while the policy does not load (ADR-0053 п. 2): the pin
 * `.warrant/warrant.json` alone — `allow` with the hint `sync`, under an active
 * Run too; any other path of the project — `deny`, naming the paths outside
 * the `write_scope` of an active Run as {@link editWithRun} does.
 */
export function recoveryEditAnswer(files: readonly string[], run: Run | undefined, failure: RecoveryFailure, cli?: string): Answer {
  if (files.length > 0 && files.every((file) => file === CONFIG_FILE)) return allow([syncHint(cli)]);
  let where = files.join(", ");
  if (run !== undefined) {
    const inside = scopeMatcher(run.write_scope, run.scope);
    const narrowed = run.scope.length === 0 ? "" : `; scope: ${run.scope.join(", ")}`;
    where = `${files.filter((file) => !inside(file)).join(", ")} outside the Run ${run.id} of ${run.change}: write_scope: ${run.write_scope.join(", ")}${narrowed}`;
  }
  return { decision: "deny", reason: `${where}; ${failure.reason}`, hints: recoveryHints(failure, cli) };
}

/**
 * `pre` `shell` while the policy does not load (ADR-0053 п. 2): `allow` only
 * when every command of `argv` is a recovery command or one that writes
 * nothing, in the strict form of a `review` Run (`&&`, `||`, `;`, a newline);
 * else `deny` with the reason of `failure`.
 */
export function recoveryShellAnswer(argv: readonly string[] | undefined, failure: RecoveryFailure, places?: ReviewShellPlaces): Answer {
  const operators: string[] = [];
  const commands = argv === undefined ? [] : leafCommands(argv, true, 1, operators);
  const dirs = new Set(places === undefined ? [] : [places.cwd]);
  let other: readonly string[] | undefined;
  for (const command of commands) {
    const as = aliased(command, dirs, places);
    if (!isRecovery(as) && !isReading(as, dirs, places)) {
      other = command;
      break;
    }
  }
  const join = operators.find((operator) => !READING_JOINS.has(operator));
  if (commands.length > 0 && other === undefined && join === undefined) return allow();
  const what = other !== undefined ? `\`${other.join(" ")}\`` : join !== undefined ? `\`${join}\`` : "no command";
  return { decision: "deny", reason: `${what}: ${failure.reason}`, hints: recoveryHints(failure, places?.cli) };
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
      const prefix = check.prefixes.find((p) => matchesPrefix(command, p));
      if (prefix === undefined) continue;
      return {
        decision: "deny",
        reason: `\`${command.join(" ")}\` runs check ${check.id} directly (prefix \`${prefixText(prefix)}\`, ${check.why}): it runs only through warrant check`,
        hints: [`warrant check ${change ?? "<change>"} ${check.id}${check.scoped ? " [--paths <a,b>]" : ""}`],
        argv: [...argv]
      };
    }
  }
  return allow();
}
