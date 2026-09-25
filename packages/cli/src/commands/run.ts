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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { splitPaths } from "../core/check/placeholders.js";
import type { Ctx } from "../core/ctx.js";
import { EXIT, WarrantError, type CliError, type ErrorCode } from "../core/errors.js";
import { projectUri } from "../core/evidence/store.js";
import { allocateUlid } from "../core/ids/allocate.js";
import { loadPacks } from "../core/packs/loader.js";
import { readChangeRecord } from "../core/record/read.js";
import { recordPath, stateOfRecord } from "../core/record/write.js";
import { resolveForProject, type Classification } from "../core/resolve/index.js";
import { contextPack } from "../core/run/context-pack.js";
import { writeScopeOf } from "../core/run/scope.js";
import { currentFile, lockFileOf, readCurrent, runFile, underLock, updateRun, writeRunFile, type Current } from "../core/run/store.js";
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

/** `current` names a Run that does not read: fix or remove the pointer (F9 for `guard`, here a refusal). */
function brokenCurrent(root: string, current: Extract<Current, { kind: "broken" }>, env: NodeJS.ProcessEnv): WarrantError {
  const first = current.errors[0] as CliError;
  return new WarrantError(first.code, `${projectUri(root, currentFile(root, env))} names ${current.id}: ${first.message}`, {
    path: first.path ?? current.path,
    hint: `fix the Run file (\`warrant validate\`) or delete ${projectUri(root, currentFile(root, env))}`
  });
}

function runActive(root: string, current: Extract<Current, { kind: "active" }>, env: NodeJS.ProcessEnv): WarrantError {
  return new WarrantError("RUN_ACTIVE", `Run ${current.id} of ${current.run.change} is RUNNING in this worktree`, {
    path: projectUri(root, currentFile(root, env)),
    hint: "finish it first: `warrant run finish` (or `warrant run finish --state CANCELLED`)"
  });
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

  const current = readCurrent(root, env);
  if (current.kind === "broken") throw brokenCurrent(root, current, env);
  if (current.kind === "active") throw runActive(root, current, env);

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

  const pointer = currentFile(root, env);
  await ctx.writes.write([projectUri(root, runFile(root, run.id, env)), projectUri(root, pointer)], () =>
    underLock(ctx, lockFileOf(root, "current", env), "run start", () => {
      // Again under the lock: another `run start` may have won the race (F5).
      const again = readCurrent(root, env);
      if (again.kind === "active") throw runActive(root, again, env);
      writeRunFile(root, run, env);
      mkdirSync(path.dirname(pointer), { recursive: true });
      writeFileSync(pointer, `${run.id}\n`, "utf8");
    })
  );

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

function notActive(root: string, env: NodeJS.ProcessEnv, why: string): WarrantError {
  return new WarrantError("RUN_NOT_ACTIVE", `no active Run in this worktree: ${why}`, {
    path: projectUri(root, currentFile(root, env)),
    hint: "start one: `warrant run start <change> --operation specify|implement`"
  });
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

  const current = readCurrent(root, env);
  if (current.kind === "broken") throw brokenCurrent(root, current, env);
  if (current.kind === "none") throw notActive(root, env, `${projectUri(root, currentFile(root, env))} is absent`);
  if (current.kind === "inactive") throw notActive(root, env, `${current.id} is ${current.run.run_state}`);

  const { id, run } = current;
  const finishedAt = new Date().toISOString();
  const pointer = currentFile(root, env);
  await ctx.writes.write([projectUri(root, runFile(root, id, env)), projectUri(root, pointer)], async () => {
    await updateRun(
      ctx,
      id,
      "run finish",
      (now) => {
        if (now.run_state !== "RUNNING") throw notActive(root, env, `${id} is ${now.run_state}`);
        return { ...now, finished_at: finishedAt, run_state: state };
      },
      env
    );
    // `current` goes only if it still names this Run.
    if (existsSync(pointer) && readFileSync(pointer, "utf8").trim() === id) rmSync(pointer, { force: true });
  });

  return success({ run: id, change: run.change, operation: run.operation, run_state: state, finished_at: finishedAt }, run.change);
}
