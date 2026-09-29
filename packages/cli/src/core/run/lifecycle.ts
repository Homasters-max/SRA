/**
 * Transitions of a Run (REQ-ENF-002, REQ-ENF-003, F5, F18, A-25): start, finish
 * and a guard event. Each owns its write plan (`ctx.writes.write` — the Run
 * file and, for start and finish, `<state>/runs/current`), its lock and the
 * check that the Run is `RUNNING`; the errors `RUN_ACTIVE`, `RUN_NOT_ACTIVE`
 * and that of a `current` naming a Run that does not read are born here.
 * Commands keep their options and output; `run submit` ends its Run through
 * `finishRun` with its own files in the same plan (REQ-ENF-007).
 */
import { existsSync, readFileSync, rmSync } from "node:fs";

import { writeFileAtomic } from "../canon/format-json.js";
import type { Ctx } from "../ctx.js";
import { WarrantError, type CliError } from "../errors.js";
import { projectUri } from "../fs.js";
import { currentFile, lockFileOf, readCurrent, runFile, underLock, updateRun, writeRunFile, type Current } from "./store.js";
import type { GuardEventRecord, Run, RunState } from "./types.js";

/** What a transition of a Run needs of `ctx`. */
export type RunCtx = Pick<Ctx, "root" | "signals" | "writes">;

/** `current` names a Run that does not read: fix or remove the pointer (F9 for `guard`, here a refusal). */
export function brokenCurrent(root: string, current: Extract<Current, { kind: "broken" }>, env: NodeJS.ProcessEnv): WarrantError {
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

function notActive(root: string, env: NodeJS.ProcessEnv, why: string): WarrantError {
  return new WarrantError("RUN_NOT_ACTIVE", `no active Run in this worktree: ${why}`, {
    path: projectUri(root, currentFile(root, env)),
    hint: "start one: `warrant run start <change> --operation specify|implement|review`"
  });
}

/** The active Run (REQ-ENF-003): `current` absent or naming a Run not `RUNNING` is `RUN_NOT_ACTIVE`; one that does not read, its error. */
export function requireActiveRun(root: string, env: NodeJS.ProcessEnv): { id: string; run: Run } {
  const current = readCurrent(root, env);
  if (current.kind === "broken") throw brokenCurrent(root, current, env);
  if (current.kind === "none") throw notActive(root, env, `${projectUri(root, currentFile(root, env))} is absent`);
  if (current.kind === "inactive") throw notActive(root, env, `${current.id} is ${current.run.run_state}`);
  return { id: current.id, run: current.run };
}

/** Refuses a start while `current` does not read or names an active Run (F5); `startRun` checks again under the lock. */
export function assertNoActiveRun(root: string, env: NodeJS.ProcessEnv): void {
  const current = readCurrent(root, env);
  if (current.kind === "broken") throw brokenCurrent(root, current, env);
  if (current.kind === "active") throw runActive(root, current, env);
}

/** Writes `run` (in `RUNNING`) and points `current` at it, under the lock of `current` (F5). */
export async function startRun(ctx: RunCtx, run: Run, env: NodeJS.ProcessEnv): Promise<void> {
  const { root } = ctx;
  const pointer = currentFile(root, env);
  await ctx.writes.write([projectUri(root, runFile(root, run.id, env)), projectUri(root, pointer)], () =>
    underLock(ctx, lockFileOf(root, "current", env), "run start", () => {
      // Again under the lock: another `run start` may have won the race (F5).
      const again = readCurrent(root, env);
      if (again.kind === "active") throw runActive(root, again, env);
      writeRunFile(root, run, env);
      writeFileAtomic(pointer, `${run.id}\n`);
    })
  );
}

/** The Run a finish ended: as read before the write, and the time written into it. */
export interface Finished {
  id: string;
  run: Run;
  finishedAt: string;
}

/** What a finish writes beside the state of the Run: `run submit` (REQ-ENF-007). */
export interface FinishWith {
  /** Files written in the same plan, first in it: paths as `ctx.writes` takes them. */
  targets: string[];
  /** Writes them, under the lock of the Run once it is known `RUNNING`, before the Run itself. */
  write: () => void;
  /** Fields of the Run set with the finish, from the Run as re-read under its lock. */
  fields: (now: Run) => Partial<Pick<Run, "evidence" | "skill" | "model">>;
}

/**
 * Ends the active Run in `state` and removes `current` — only if it still
 * names this Run. No active Run is `RUN_NOT_ACTIVE`; a Run no longer
 * `RUNNING` under its lock is too. `also` joins its files and fields to the
 * one write plan: `[…also.targets, Run, current]`.
 */
export async function finishRun(ctx: RunCtx, state: RunState, env: NodeJS.ProcessEnv, also?: FinishWith): Promise<Finished> {
  const { root } = ctx;
  const { id, run } = requireActiveRun(root, env);
  const finishedAt = new Date().toISOString();
  const pointer = currentFile(root, env);
  const targets = [...(also?.targets ?? []), projectUri(root, runFile(root, id, env)), projectUri(root, pointer)];
  await ctx.writes.write(targets, async () => {
    await updateRun(
      ctx,
      id,
      also === undefined ? "run finish" : "run submit",
      (now) => {
        if (now.run_state !== "RUNNING") throw notActive(root, env, `${id} is ${now.run_state}`);
        also?.write();
        return { ...now, ...(also?.fields(now) ?? {}), finished_at: finishedAt, run_state: state };
      },
      env
    );
    // `current` goes only if it still names this Run.
    if (existsSync(pointer) && readFileSync(pointer, "utf8").trim() === id) rmSync(pointer, { force: true });
  });
  return { id, run, finishedAt };
}

/**
 * Appends the event `build` makes of the Run re-read under its lock to
 * `guard_events[]` (F18); returns what `build` picked from that Run.
 */
export async function appendGuardEvent<T>(
  ctx: RunCtx,
  run: Run,
  env: NodeJS.ProcessEnv,
  build: (now: Run) => { record: GuardEventRecord; picked: T }
): Promise<T> {
  let picked: T | undefined;
  await ctx.writes.write(projectUri(ctx.root, runFile(ctx.root, run.id, env)), () =>
    updateRun(
      ctx,
      run.id,
      "guard",
      (now) => {
        const built = build(now);
        picked = built.picked;
        return { ...now, guard_events: [...now.guard_events, built.record] };
      },
      env
    )
  );
  return picked as T;
}
