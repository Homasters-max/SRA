/**
 * Where Runs live and how they are read and written (REQ-ENF-001, F3, F5, F18).
 *
 * `<state>` is that of evidence (`WARRANT_STATE_DIR` or `.warrant`, D-2):
 * a Run is `<state>/runs/<id>.json` — committed with the work — and the
 * active one is named by `<state>/runs/current`, one line with the id, not
 * committed. A Run is active only while its `run_state` is `RUNNING`.
 *
 * Every rewrite of a Run file goes under its lock `<state>/runs/<id>.lock`
 * (`core/lock.ts`): take the lock (retried for ~2 s), read the file, change
 * it, `writeJsonFile`, release — so the events of parallel `guard` calls are
 * not lost to each other.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeJsonFile } from "../canon/format-json.js";
import { cliError, EXIT, WarrantError, type CliError } from "../errors.js";
import { projectUri, stateDir } from "../evidence/store.js";
import { waitForLock, lockHolder } from "../lock.js";
import type { SignalsPort } from "../ports/signals.js";
import type { Json } from "../schemas/loader.js";
import { validateFile } from "../schemas/semantic.js";
import type { Run } from "./types.js";

export const CURRENT_FILE = "current";

/** How long a writer of a Run file waits for its lock (F18). */
export const RUN_LOCK_WAIT_MS = 2_000;

const RUN_ID_RE = /^RUN-[0-9A-HJKMNP-TV-Z]{26}$/;

/** Absolute `<state>/runs/`. */
export function runsDir(root: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateDir(root, env), "runs");
}

/** Absolute `<state>/runs/<id>.json`. */
export function runFile(root: string, id: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(runsDir(root, env), `${id}.json`);
}

/** Absolute `<state>/runs/current`. */
export function currentFile(root: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(runsDir(root, env), CURRENT_FILE);
}

/** Absolute lock of one Run file, `<state>/runs/<id>.lock`, or of `current` (`current.lock`). */
export function lockFileOf(root: string, name: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(runsDir(root, env), `${name}.lock`);
}

/** What `<state>/runs/current` names. */
export type Current =
  /** No `current`, or an empty one. */
  | { kind: "none" }
  /** `current` names a Run that is not `RUNNING`: not active (REQ-ENF-003). */
  | { kind: "inactive"; id: string; run: Run; path: string }
  | { kind: "active"; id: string; run: Run; path: string }
  /** `current` names no Run file, or one that fails `warrant://run/1`. */
  | { kind: "broken"; id: string; path: string; errors: CliError[] };

/** Reads one Run file and checks it against `warrant://run/1`. */
export function readRun(
  root: string,
  id: string,
  env: NodeJS.ProcessEnv = process.env
): { run: Run; path: string } | { errors: CliError[]; path: string } {
  const absolute = runFile(root, id, env);
  const reported = projectUri(root, absolute);
  if (!RUN_ID_RE.test(id)) {
    const pointer = projectUri(root, currentFile(root, env));
    return { path: reported, errors: [cliError("CONFIG_INVALID", `"${id}" is not a Run id RUN-<ULID>`, { path: pointer })] };
  }
  if (!existsSync(absolute)) {
    return { path: reported, errors: [cliError("CONFIG_INVALID", `Run file of ${id} does not exist`, { path: reported })] };
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (cause) {
    return { path: reported, errors: [cliError("CONFIG_INVALID", `invalid JSON: ${(cause as Error).message}`, { path: reported })] };
  }
  const result = validateFile(json as Json, reported);
  if (!result.ok) return { path: reported, errors: result.errors };
  return { run: json as Run, path: reported };
}

/** The Run `current` names, and whether it is active. */
export function readCurrent(root: string, env: NodeJS.ProcessEnv = process.env): Current {
  const pointer = currentFile(root, env);
  if (!existsSync(pointer)) return { kind: "none" };
  const id = readFileSync(pointer, "utf8").trim();
  if (id === "") return { kind: "none" };
  const read = readRun(root, id, env);
  if ("errors" in read) return { kind: "broken", id, path: read.path, errors: read.errors };
  return { kind: read.run.run_state === "RUNNING" ? "active" : "inactive", id, run: read.run, path: read.path };
}

/** What the writers of a Run need of `ctx`. */
export interface RunWriteCtx {
  readonly root: string;
  readonly signals: SignalsPort;
}

/**
 * Runs `perform` holding the lock `lock` (absolute), taken for `what` with
 * the wait of F18; a lock not taken in time is `BUSY` (exit 2) with its holder.
 */
export async function underLock<T>(ctx: RunWriteCtx, lock: string, what: string, perform: () => T): Promise<T> {
  const acquired = await waitForLock(lock, lockHolder(what), ctx.signals, { waitMs: RUN_LOCK_WAIT_MS });
  if (!acquired.ok) {
    const pid = acquired.holder?.["pid"];
    const reported = projectUri(ctx.root, lock);
    throw new WarrantError("BUSY", `${what}: ${reported} is held${pid === undefined ? "" : ` by pid ${String(pid)}`}`, {
      path: reported,
      hint: `retry; if that process is gone, delete ${reported}`,
      exitCode: EXIT.WAIT
    });
  }
  try {
    return perform();
  } finally {
    acquired.release();
  }
}

/** Writes a Run file after checking it against its schema: the CLI never writes an invalid Run. */
export function writeRunFile(root: string, run: Run, env: NodeJS.ProcessEnv = process.env): void {
  const absolute = runFile(root, run.id, env);
  const reported = projectUri(root, absolute);
  const checked = validateFile(run as unknown as Json, reported);
  if (!checked.ok) {
    const first = checked.errors[0] as CliError;
    throw new WarrantError("INTERNAL", `the Run would not match its schema: ${first.message}`, { path: first.path ?? reported });
  }
  writeJsonFile(absolute, run as unknown as Json);
}

/**
 * Rewrites the Run `id` under its lock: reads it again, `change` returns the
 * new Run (F18). A Run that no longer reads is `CONFIG_INVALID`.
 */
export async function updateRun(
  ctx: RunWriteCtx,
  id: string,
  what: string,
  change: (run: Run) => Run,
  env: NodeJS.ProcessEnv = process.env
): Promise<Run> {
  return underLock(ctx, lockFileOf(ctx.root, id, env), what, () => {
    const read = readRun(ctx.root, id, env);
    if ("errors" in read) {
      const first = read.errors[0] as CliError;
      throw new WarrantError(first.code, first.message, { path: first.path ?? read.path, hint: "run `warrant validate`" });
    }
    const next = change(read.run);
    writeRunFile(ctx.root, next, env);
    return next;
  });
}
