/**
 * `warrant run start <change> --operation specify|implement|review [--scope <globs>]
 * [--task <label>] [--dry-run]`, `warrant run finish [--state …] [--dry-run]` and
 * `warrant run submit [--file <path>] [--dry-run]` (REQ-ENF-002, REQ-ENF-003,
 * REQ-ENF-007, F1–F5, F17).
 *
 * `run start` creates a Run in `RUNNING` and points `<state>/runs/current` at
 * it: `write_scope` comes from the operation (`specify` ⇐ `PROPOSED`,
 * `implement` ⇐ `IMPLEMENTING`, `review` ⇐ `PROPOSED` with an empty one and the
 * `spec_tree` of the committed spec), `--scope` only narrows it; the output is
 * the Context Pack with `findings[]` — `UNCOMMITTED_IN_SCOPE` of `specify` and
 * `implement`. `run finish` ends the active Run and removes `current`;
 * `run submit` ends a `review` Run with its envelope and evidence. One active
 * Run per worktree (F5): a Run is active while `current` names it and it is
 * `RUNNING`.
 *
 * Every error of these commands carries a `hint` (REQ-KRN-002): the new ones
 * are born with it, the rest get the default of their code here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { splitPaths } from "../core/check/placeholders.js";
import type { Ctx } from "../core/ctx.js";
import { WarrantError, type ErrorCode } from "../core/errors.js";
import { reportPath } from "../core/fs.js";
import { allocateUlid } from "../core/ids/allocate.js";
import { loadPacks } from "../core/packs/loader.js";
import { readChangeRecord } from "../core/record/read.js";
import { recordPath, stateOfRecord } from "../core/record/write.js";
import { resolveForProject, type Classification } from "../core/resolve/index.js";
import { contextPack } from "../core/run/context-pack.js";
import { assertNoActiveRun, finishRun, startRun } from "../core/run/lifecycle.js";
import { committedSpecTree } from "../core/run/review.js";
import { uncommittedInScope, writeScopeOf } from "../core/run/scope.js";
import { submitReview, type SubmitInput } from "../core/run/submit.js";
import { isFinalRunState, isRunOperation, type Run, type RunOperation } from "../core/run/types.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { readStdin } from "../io/stdin.js";
import { requireConfigPath, withDryRun, withHints } from "./context.js";

export interface RunStartOptions {
  operation?: string | undefined;
  scope?: string | undefined;
  task?: string | undefined;
}

export interface RunFinishOptions {
  state?: string | undefined;
}

export interface RunSubmitOptions {
  /** The envelope file, relative to the project root; without it the envelope is read from stdin. */
  file?: string | undefined;
}

const START_USAGE = "warrant run start <change> --operation specify|implement|review [--scope <globs>] [--task <label>]";

/** The state a Change must be in for the operation (F2, REQ-ENF-002). */
const STATE_OF: Readonly<Record<RunOperation, string>> = { specify: "PROPOSED", implement: "IMPLEMENTING", review: "PROPOSED" };

/** `hint` of `STATE_INVALID` of `run start`: where the operation starts from. */
function stateHint(operation: RunOperation, change: string): string {
  if (operation === "implement") return `move the Change to IMPLEMENTING first: \`warrant transition ${change} IMPLEMENTING\``;
  if (operation === "review") return "review reads the spec of a PROPOSED Change, before `warrant transition <change> SPECIFIED`";
  return "specify edits a PROPOSED Change; a Change in IMPLEMENTING takes `--operation implement`";
}

/** `hint` of an error of `run` that was not born with one: by its code, else `warrant validate`. */
const DEFAULT_HINTS: Partial<Record<ErrorCode, string>> = {
  CONFIG_MISSING: "run `warrant init` in the project root",
  CHANGE_NOT_FOUND: "check the name of the Change: `warrant status` lists them"
};

export function runStart(ctx: Ctx, change: string | undefined, opts: RunStartOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  return withDryRun(ctx, () => withHints(DEFAULT_HINTS, () => start(ctx, change, opts, env)));
}

async function start(ctx: Ctx, change: string | undefined, opts: RunStartOptions, env: NodeJS.ProcessEnv): Promise<CommandResult> {
  const { root } = ctx;
  requireConfigPath(root);
  if (change === undefined || change === "") throw new WarrantError("USAGE", "run start needs the name of a Change", { hint: START_USAGE });
  const operation = opts.operation;
  if (operation === undefined || !isRunOperation(operation)) {
    throw new WarrantError("USAGE", `--operation must be specify, implement or review${operation === undefined ? "" : `, got "${operation}"`}`, {
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
      hint: stateHint(operation, change)
    });
  }
  // A review reads the spec as committed: its tree is what the evidence will name (ADR-0036 п. 3).
  const specTree = operation === "review" ? await committedSpecTree(ctx, change) : undefined;

  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) return failures(loaded.errors, {}, change);
  const writeScope = writeScopeOf(operation, change, loaded.config);

  // The hash of the effective policy is the caller's: core/run does not depend on core/resolve (design §2).
  const { result, errors } = resolveForProject(loaded, record["classification"] as Classification | undefined);
  if (errors.length > 0) return failures(errors, {}, change);
  if (!result.ok) {
    return failures(
      [{ code: "POLICY_CONFLICT", message: result.conflict.message, hint: `see \`warrant resolve ${change} --explain\`` }],
      { controller_action: "ESCALATE", conflicts: result.conflict.items },
      change
    );
  }

  const pack = contextPack({ root, change, rules: loaded.rules, writeScope, scope });
  // Work already in the scope is not the Run's: a finding, the Run starts (REQ-ENF-002, ADR-0044 п. 5).
  const findings = operation === "review" ? [] : await uncommittedInScope(ctx, writeScope);
  const run: Run = {
    $schema: "warrant://run/1",
    id: allocateUlid("RUN"),
    change,
    operation,
    ...(opts.task !== undefined && opts.task !== "" ? { task: opts.task } : {}),
    write_scope: writeScope,
    scope,
    ...(specTree === undefined ? {} : { spec_tree: specTree }),
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
      context_hash: pack.context_hash,
      findings
    },
    change
  );
}

const SUBMIT_USAGE = "warrant run submit --file <envelope.json>, or the envelope on stdin: warrant run submit < envelope.json";

/**
 * `warrant run submit [--file <path>] [--dry-run]` (REQ-ENF-007): the envelope
 * of the active `review` Run from `--file` or, without it, from `readInput`
 * (stdin); the evidence record and the finished Run are `core/run/submit.ts`.
 */
export function runSubmit(
  ctx: Ctx,
  opts: RunSubmitOptions = {},
  readInput: () => Promise<string> = readStdin,
  env: NodeJS.ProcessEnv = process.env
): Promise<CommandResult> {
  return withDryRun(ctx, () => withHints(DEFAULT_HINTS, () => submit(ctx, opts, readInput, env)));
}

async function submit(ctx: Ctx, opts: RunSubmitOptions, readInput: () => Promise<string>, env: NodeJS.ProcessEnv): Promise<CommandResult> {
  const { root } = ctx;
  requireConfigPath(root);
  const read = async (): Promise<SubmitInput> => {
    if (opts.file === undefined) {
      const text = await readInput();
      if (text.trim() === "") throw new WarrantError("USAGE", "no envelope: stdin is empty", { hint: SUBMIT_USAGE });
      return { text: text.replace(/^﻿/, "") };
    }
    const absolute = path.resolve(root, opts.file);
    const source = reportPath(absolute, root);
    let text: string;
    try {
      text = readFileSync(absolute, "utf8").replace(/^﻿/, "");
    } catch (cause) {
      throw new WarrantError("USAGE", `cannot read the envelope ${source}: ${(cause as Error).message}`, { path: source, hint: SUBMIT_USAGE });
    }
    // An empty or blank file is no envelope, as an empty stdin (I-199).
    if (text.trim() === "") throw new WarrantError("USAGE", `no envelope: ${source} is empty`, { path: source, hint: SUBMIT_USAGE });
    return { text, source };
  };
  const done = await submitReview(ctx, read, env);
  return success(
    { run: done.run, change: done.change, evidence: done.evidence, evidence_status: done.status, findings: done.findings, reused: done.reused },
    done.change
  );
}

export function runFinish(ctx: Ctx, opts: RunFinishOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  return withDryRun(ctx, () => withHints(DEFAULT_HINTS, () => finish(ctx, opts, env)));
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
