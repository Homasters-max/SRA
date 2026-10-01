/**
 * `warrant guard` on one normalised event (REQ-ENF-004, ADR-0018 п. 2,
 * design §4, §6): the decision before an action (`pre`), the hints after it
 * (`post`) and the event appended to `guard_events[]` of the active Run under
 * its lock (F18).
 *
 * A project without `.warrant/warrant.json` is not under WARRANT: `allow`, no
 * event. A path of the event is absolute or relative to its `cwd`; one outside
 * the project is not guarded. `pre` fails closed (F9): an event that does not
 * read, a Run that does not read, a policy that does not load, a lock not
 * taken — `deny` with the reason and a hint. `post` is always `allow`: its
 * failure gives no hints and a line on stderr (ADR-0019 п. 8).
 */
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Ctx } from "../ctx.js";
import { WarrantError, type CliError } from "../errors.js";
import { projectPath } from "../fs.js";
import { pathMatcher } from "../glob.js";
import { loadPacks } from "../packs/loader.js";
import type { LoadedRule, LoadResult } from "../packs/types.js";
import { UNREADABLE_EXIT, type FrontendAdapter, type FrontendResponse, type GuardEvent, type GuardResult } from "../ports/frontend.js";
import { appendGuardEvent } from "../run/lifecycle.js";
import { cliWrittenState } from "../run/state.js";
import { readCurrent } from "../run/store.js";
import type { GuardEventRecord, Run } from "../run/types.js";
import { runFileChecks, validateRun } from "../validate/registry.js";
import {
  editWithoutRun,
  editWithRun,
  guardedChecks,
  pathClasses,
  reviewEditAnswer,
  reviewShellAnswer,
  RUN_START_HINT,
  shellAnswer,
  VALIDATE_HINT,
  type Answer,
  type PathClasses,
  type ReviewEditPlaces,
  type ReviewShellPlaces
} from "./decide.js";
import { parseEvent } from "./event.js";

/** At most this many finding lines in `hints[]`, then one «and N more» (ADR-0019 п. 10). */
export const FINDING_LINES = 10;

/** One finding of `validate --files` as a line of `hints[]`: `CODE path: message — hint`. */
export function findingLine(error: CliError): string {
  const where = error.path === undefined ? "" : ` ${error.path}`;
  return `${error.code}${where}: ${error.message}${error.hint === undefined ? "" : ` — ${error.hint}`}`;
}

/** The finding lines, at most `FINDING_LINES` and a line with the number of the rest. */
export function findingHints(errors: readonly CliError[]): string[] {
  const lines = errors.map(findingLine);
  if (lines.length <= FINDING_LINES) return lines;
  return [...lines.slice(0, FINDING_LINES), `and ${lines.length - FINDING_LINES} more`];
}

/** A rule text as a line of `hints[]`. */
function ruleLine(rule: LoadedRule): string {
  return `rule ${rule.id}: ${rule.text}`;
}

function result(answer: Answer): GuardResult {
  return { decision: answer.decision, ...(answer.reason === undefined ? {} : { reason: answer.reason }), hints: answer.hints };
}

const ALLOW: GuardResult = { decision: "allow", hints: [] };

/** Refusal of `pre` on a failure (F9): the reason, the error's own hint or `warrant validate`. */
function failedClosed(thrown: unknown): GuardResult {
  if (thrown instanceof WarrantError && thrown.code === "BUSY") {
    return { decision: "deny", reason: `BUSY: ${thrown.message}`, hints: [thrown.hint ?? VALIDATE_HINT] };
  }
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  const where = thrown instanceof WarrantError && thrown.path !== undefined ? `${thrown.path}: ` : "";
  return { decision: "deny", reason: `guard failed: ${where}${message}`, hints: [VALIDATE_HINT] };
}

/** Project paths of the event (F16): outside the project and the root itself are dropped. */
function projectFiles(root: string, event: GuardEvent): string[] {
  const out: string[] = [];
  for (const given of event.paths) {
    const file = projectPath(root, path.resolve(event.cwd, given));
    if (file !== undefined && file !== "" && !out.includes(file)) out.push(file);
  }
  return out;
}

/** The loaded project, or the loader's first error thrown: a policy that does not load (F9). */
function loadPolicy(root: string): LoadResult {
  const loaded = loadPacks(root);
  const first = loaded.errors[0];
  if (first !== undefined) {
    throw new WarrantError(first.code, `the policy does not load: ${first.message}`, first.path === undefined ? {} : { path: first.path });
  }
  return loaded;
}

/** The active Run, none, or the failure of a `current` that names a Run that does not read. */
function activeRun(root: string, env: NodeJS.ProcessEnv): Run | undefined {
  const current = readCurrent(root, env);
  if (current.kind === "broken") {
    const first = current.errors[0] as CliError;
    throw new WarrantError(first.code, `the Run file ${current.path} named by the active Run pointer does not read: ${first.message}`, {
      path: first.path ?? current.path
    });
  }
  return current.kind === "active" ? current.run : undefined;
}

function eventRecord(event: GuardEvent, files: string[], answer: Answer, findings: string[], rulesShown: string[]): GuardEventRecord {
  return {
    at: new Date().toISOString(),
    phase: event.phase,
    action: event.action,
    paths: files,
    decision: answer.decision,
    ...(answer.reason === undefined ? {} : { reason: answer.reason }),
    findings,
    rules_shown: rulesShown,
    ...(answer.argv === undefined ? {} : { argv: answer.argv })
  };
}

/** Absolute paths of the event outside the project (they are never recorded in `guard_events[]`). */
function outsidePaths(root: string, event: GuardEvent): string[] {
  return event.paths.map((given) => path.resolve(event.cwd, given)).filter((file) => projectPath(root, file) === undefined);
}

/**
 * The temporary directory as `os.tmpdir()` finds it, from `env` so a test can
 * place it (I-201): `TEMP`, `TMP` on Windows; `TMPDIR`, `TMP`, `TEMP` elsewhere.
 */
export function tempDirOf(env: NodeJS.ProcessEnv): string {
  const names = process.platform === "win32" ? ["TEMP", "TMP"] : ["TMPDIR", "TMP", "TEMP"];
  const given = names.map((name) => env[name]).find((value) => typeof value === "string" && value !== "");
  return given ?? tmpdir();
}

/** The real path of `file`: its nearest existing ancestor resolved (links, 8.3 short names), the rest appended. */
function realPath(file: string): string {
  let dir = path.resolve(file);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync.native(dir), ...rest.reverse());
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return path.resolve(file);
      rest.push(path.basename(dir));
      dir = parent;
    }
  }
}

/** Where the outside paths of an edit under a `review` Run land (ADR-0042 п. 4). */
function reviewPlaces(root: string, event: GuardEvent, env: NodeJS.ProcessEnv): ReviewEditPlaces {
  const tempDir = realPath(tempDirOf(env));
  const tempInProject = projectPath(realPath(root), tempDir) !== undefined;
  const strays = outsidePaths(root, event).filter((file) => projectPath(tempDir, realPath(file)) === undefined).length;
  return { tempDir, tempInProject, strays };
}

/**
 * Where `cd` of a shell line under a `review` Run may lead: inside the project
 * of the event after `realpath` (links, 8.3 short names; I-202) — `run finish`
 * and `run submit` act on the Run of the checkout `cd` leads to.
 */
function reviewShellPlaces(root: string, event: GuardEvent): ReviewShellPlaces {
  const project = realPath(root);
  return { cwd: path.resolve(event.cwd), inProject: (dir) => projectPath(project, realPath(dir)) !== undefined };
}

/** The answer before the action; what fails in it is a refusal (F9). */
function decidePre(ctx: Ctx, event: GuardEvent, files: readonly string[], run: Run | undefined, env: NodeJS.ProcessEnv): Answer {
  try {
    const classes = (loaded: LoadResult): PathClasses => pathClasses(loaded, cliWrittenState(ctx.root, env));
    if (event.action === "edit" && run?.operation === "review") return reviewEditAnswer(run, files, reviewPlaces(ctx.root, event, env));
    if (event.action === "edit" && run !== undefined) return editWithRun(run, files, () => classes(loadPolicy(ctx.root)));
    if (event.action === "edit") {
      const loaded = loadPolicy(ctx.root);
      return editWithoutRun(loaded, files, classes(loaded));
    }
    if (event.action === "shell" && run?.operation === "review") return reviewShellAnswer(event.argv, run, reviewShellPlaces(ctx.root, event));
    if (event.action === "shell") return shellAnswer(event.argv, guardedChecks(loadPolicy(ctx.root)), run?.change);
    return { decision: "allow", hints: [] };
  } catch (thrown) {
    return failedClosed(thrown);
  }
}

async function pre(ctx: Ctx, event: GuardEvent, env: NodeJS.ProcessEnv): Promise<GuardResult> {
  const files = projectFiles(ctx.root, event);
  const run = activeRun(ctx.root, env);
  const answer = decidePre(ctx, event, files, run, env);
  // A lock not taken is a refusal too: `deny` BUSY, the event lost (F18).
  if (run !== undefined) await appendGuardEvent(ctx, run, env, () => ({ record: eventRecord(event, files, answer, [], []), picked: undefined }));
  return result(answer);
}

/** Rules whose `paths` match one of `files` and whose id no event of `run` has shown (ADR-0022 п. 3). */
function rulesToShow(rules: readonly LoadedRule[], files: readonly string[], run: Run): LoadedRule[] {
  const shown = new Set(run.guard_events.flatMap((e) => e.rules_shown));
  return rules.filter((rule) => {
    const matches = pathMatcher(rule.paths);
    return !shown.has(rule.id) && files.some((file) => matches(file));
  });
}

async function post(ctx: Ctx, event: GuardEvent, env: NodeJS.ProcessEnv): Promise<GuardResult> {
  const files = projectFiles(ctx.root, event);
  const run = activeRun(ctx.root, env);
  const loaded = loadPacks(ctx.root);
  const errors = files.length === 0 ? [] : (await runFileChecks(validateRun(ctx, loaded), files)).errors;
  const findingsHints = findingHints(errors);
  // Without a Run the hint `run start` of `pre` comes again after the edit: a frontend may deliver the context of
  // `pre` only with the result of the action, or not at all (I-165).
  if (run === undefined) {
    const runStart = event.action === "edit" && files.length > 0 ? [RUN_START_HINT] : [];
    return { decision: "allow", hints: [...findingsHints, ...runStart] };
  }

  const codes = [...new Set(errors.map((e) => e.code))];
  const answer: Answer = { decision: "allow", hints: [] };
  let rules: LoadedRule[];
  try {
    rules = await appendGuardEvent(ctx, run, env, (now) => {
      const fresh = rulesToShow(loaded.rules, files, now);
      return { record: eventRecord(event, files, answer, codes, fresh.map((r) => r.id)), picked: fresh };
    });
  } catch (thrown) {
    // The event is lost (F18); the hints still reach the agent.
    ctx.warn(`guard: the event of this edit is not recorded in the Run ${run.id}: ${(thrown as Error).message}\n`);
    rules = rulesToShow(loaded.rules, files, run);
  }
  return { decision: "allow", hints: [...findingsHints, ...rules.map(ruleLine)] };
}

/** A project under WARRANT has `.warrant/warrant.json`; guard allows everything elsewhere (SCN-ENF-016). */
function underWarrant(root: string): boolean {
  return existsSync(path.join(root, ".warrant", "warrant.json"));
}

/** `warrant guard` on the text of stdin, in the project `ctx.root`. */
export async function guard(ctx: Ctx, input: string, env: NodeJS.ProcessEnv = process.env): Promise<GuardResult> {
  if (!underWarrant(ctx.root)) return ALLOW;
  const parsed = parseEvent(input);
  if (!parsed.ok) {
    if (parsed.phase === "post") {
      ctx.warn(`guard: ${parsed.message}\n`);
      return ALLOW;
    }
    return { decision: "deny", reason: parsed.message, hints: [VALIDATE_HINT] };
  }
  return decide(ctx, parsed.event, env);
}

/**
 * `warrant guard --frontend <name>` on the text of stdin (REQ-ENF-005): the
 * adapter makes the event of the native input, guard decides as on the
 * normalised event, the adapter makes the native answer of the decision.
 * A native input that does not read — exit `UNREADABLE_EXIT`, the reason on
 * stderr, stdout empty. Outside a project under WARRANT nothing is read:
 * `allow`, stdout empty (SCN-ENF-016).
 */
export async function guardFrontend(
  ctx: Ctx,
  adapter: FrontendAdapter,
  input: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<FrontendResponse> {
  if (!underWarrant(ctx.root)) return { stdout: "", exit: 0 };
  const unreadable = (why: string): FrontendResponse => {
    ctx.warn(`warrant guard --frontend ${adapter.name}: ${why}\n`);
    return { stdout: "", exit: UNREADABLE_EXIT };
  };
  let native: unknown;
  try {
    native = JSON.parse(input);
  } catch (cause) {
    return unreadable(`stdin is not JSON: ${(cause as Error).message}`);
  }
  const event = adapter.toEvent(native);
  if (event === undefined) return unreadable(`stdin is not ${adapter.input}`);
  return adapter.respond(await decide(ctx, event, env), event);
}

/** The decision on a read event: `pre` fails closed, `post` open (F9). */
async function decide(ctx: Ctx, event: GuardEvent, env: NodeJS.ProcessEnv): Promise<GuardResult> {
  if (event.phase === "pre") {
    try {
      return await pre(ctx, event, env);
    } catch (thrown) {
      return failedClosed(thrown);
    }
  }
  try {
    return await post(ctx, event, env);
  } catch (thrown) {
    ctx.warn(`guard: ${(thrown as Error).message}\n`);
    return ALLOW;
  }
}

/**
 * The decision of `warrant guard` on an exception nothing caught (exit-contract
 * D9, REQ-ENF-004): `post` — `allow` without hints (the caller writes the
 * message to stderr); `pre`, or stdin not read or without a phase, — the
 * refusal of a failure. `input` is the text of stdin, once read.
 */
export function crashDecision(input: string | undefined, thrown: unknown): GuardResult {
  const parsed = input === undefined ? undefined : parseEvent(input);
  const phase = parsed === undefined ? undefined : parsed.ok ? parsed.event.phase : parsed.phase;
  return phase === "post" ? ALLOW : failedClosed(thrown);
}
