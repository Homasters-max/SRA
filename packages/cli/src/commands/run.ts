/**
 * `warrant run start <change> --operation specify|implement [--scope <globs>]
 * [--task <label>] [--dry-run]` and `warrant run finish [--state …] [--dry-run]`
 * (REQ-ENF-002, REQ-ENF-003, F1–F5, F17).
 *
 * `run start` creates a Run in `RUNNING` and points `<state>/runs/current` at
 * it: `write_scope` comes from the operation (`specify` ⇐ `PROPOSED`,
 * `implement` ⇐ `IMPLEMENTING`), `--scope` only narrows it; the output is the
 * Context Pack. `run finish` ends the active Run and removes `current`. One
 * active Run per worktree (F5): a Run is active while `current` names it and
 * it is `RUNNING`.
 *
 * Every error of these commands carries a `hint` (REQ-KRN-002): the new ones
 * are born with it, the rest get the default of their code here.
 */
import { splitPaths } from "../core/check/placeholders.js";
import type { Ctx } from "../core/ctx.js";
import { EXIT, WarrantError, type CliError, type ErrorCode } from "../core/errors.js";
import { allocateUlid } from "../core/ids/allocate.js";
import { loadPacks } from "../core/packs/loader.js";
import { readChangeRecord } from "../core/record/read.js";
import { recordPath, stateOfRecord } from "../core/record/write.js";
import { resolveForProject, type Classification } from "../core/resolve/index.js";
import { contextPack } from "../core/run/context-pack.js";
import { assertNoActiveRun, finishRun, startRun } from "../core/run/lifecycle.js";
import { writeScopeOf } from "../core/run/scope.js";
import { isFinalRunState, isRunOperation, type Run, type RunOperation } from "../core/run/types.js";
import { failures, resultFromThrown, success, type CommandResult } from "../io/output.js";
import { requireConfigPath, withDryRun } from "./context.js";

export interface RunStartOptions {
  operation?: string | undefined;
  scope?: string | undefined;
  task?: string | undefined;
}

export interface RunFinishOptions {
  state?: string | undefined;
}

const START_USAGE = "warrant run start <change> --operation specify|implement [--scope <globs>] [--task <label>]";

/** The state a Change must be in for the operation (F2). */
const STATE_OF: Readonly<Record<RunOperation, string>> = { specify: "PROPOSED", implement: "IMPLEMENTING" };

/** `hint` of an error of `run` that was not born with one: by its code, else `warrant validate`. */
const DEFAULT_HINTS: Partial<Record<ErrorCode, string>> = {
  CONFIG_MISSING: "run `warrant init` in the project root",
  CHANGE_NOT_FOUND: "check the name of the Change: `warrant status` lists them"
};
const VALIDATE_HINT = "run `warrant validate`";

function hinted(error: CliError): CliError {
  return error.hint !== undefined ? error : { ...error, hint: DEFAULT_HINTS[error.code] ?? VALIDATE_HINT };
}

/** The command's result, a thrown error turned into one as `bin` does, every error with a `hint`. */
async function withHints(run: () => Promise<CommandResult>): Promise<CommandResult> {
  let result: CommandResult;
  try {
    result = await run();
  } catch (thrown) {
    result = resultFromThrown(thrown);
  }
  return result.errors.length === 0 ? result : { ...result, errors: result.errors.map(hinted) };
}

export function runStart(ctx: Ctx, change: string | undefined, opts: RunStartOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  return withDryRun(ctx, () => withHints(() => start(ctx, change, opts, env)));
}

async function start(ctx: Ctx, change: string | undefined, opts: RunStartOptions, env: NodeJS.ProcessEnv): Promise<CommandResult> {
  const { root } = ctx;
  requireConfigPath(root);
  if (change === undefined || change === "") throw new WarrantError("USAGE", "run start needs the name of a Change", { hint: START_USAGE });
  const operation = opts.operation;
  if (operation === undefined || !isRunOperation(operation)) {
    throw new WarrantError("USAGE", `--operation must be specify or implement${operation === undefined ? "" : `, got "${operation}"`}`, {
      hint: START_USAGE
    });
  }
  const scope = opts.scope === undefined ? [] : splitPaths(opts.scope);
  if (opts.scope !== undefined && scope.length === 0) {
    throw new WarrantError("USAGE", "--scope needs at least one glob", { hint: "--scope src/search/**,tests/search/**" });
  }

  assertNoActiveRun(root, env);

  const record = readChangeRecord(root, change);
  const state = stateOfRecord(record);
  const needed = STATE_OF[operation];
  if (state !== needed) {
    throw new WarrantError("STATE_INVALID", `--operation ${operation} needs ${change} in ${needed}; it is ${state}`, {
      path: recordPath(change),
      hint:
        operation === "implement"
          ? `move the Change to IMPLEMENTING first: \`warrant transition ${change} IMPLEMENTING\``
          : "specify edits a PROPOSED Change; a Change in IMPLEMENTING takes `--operation implement`"
    });
  }

  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) return failures(loaded.errors, EXIT.CONFIG, {}, change);
  const writeScope = writeScopeOf(operation, change, loaded.config);

  // The hash of the effective policy is the caller's: core/run does not depend on core/resolve (design §2).
  const { result, errors } = resolveForProject(loaded, record["classification"] as Classification | undefined);
  if (errors.length > 0) return failures(errors, EXIT.CONFIG, {}, change);
  if (!result.ok) {
    return failures(
      [{ code: "POLICY_CONFLICT", message: result.conflict.message, hint: `see \`warrant resolve ${change} --explain\`` }],
      EXIT.WAIT,
      { controller_action: "ESCALATE", conflicts: result.conflict.items },
      change
    );
  }

  const pack = contextPack({ root, change, rules: loaded.rules, writeScope, scope });
  const run: Run = {
    $schema: "warrant://run/1",
    id: allocateUlid("RUN"),
    change,
    operation,
    ...(opts.task !== undefined && opts.task !== "" ? { task: opts.task } : {}),
    write_scope: writeScope,
    scope,
    branch: (await ctx.git.branch()) ?? "",
    started_at: new Date().toISOString(),
    run_state: "RUNNING",
    context_hash: pack.context_hash,
    effective_policy_hash: result.policy.hash,
    guard_events: []
  };

  await startRun(ctx, run, env);

  return success(
    {
      run: run.id,
      change,
      operation,
      write_scope: writeScope,
      scope,
      rules: pack.rules,
      items: pack.items,
      context_hash: pack.context_hash
    },
    change
  );
}

export function runFinish(ctx: Ctx, opts: RunFinishOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  return withDryRun(ctx, () => withHints(() => finish(ctx, opts, env)));
}

async function finish(ctx: Ctx, opts: RunFinishOptions, env: NodeJS.ProcessEnv): Promise<CommandResult> {
  const { root } = ctx;
  requireConfigPath(root);
  const state = opts.state ?? "SUCCEEDED";
  if (!isFinalRunState(state)) {
    throw new WarrantError("USAGE", `--state must be SUCCEEDED, FAILED or CANCELLED, got "${state}"`, {
      hint: "warrant run finish --state SUCCEEDED|FAILED|CANCELLED"
    });
  }

  const { id, run, finishedAt } = await finishRun(ctx, state, env);

  return success({ run: id, change: run.change, operation: run.operation, run_state: state, finished_at: finishedAt }, run.change);
}
