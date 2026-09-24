/**
 * `warrant sync [--check]` — generate the OpenSpec files and the lock
 * (REQ-KRN-025, design D-7).
 *
 * The pipeline is: config -> OpenSpec version gate -> packs -> plan -> write.
 * Nothing is written unless the whole plan succeeded, so a failing run leaves
 * the project exactly as it was (SCN-KRN-064).
 */
import type { Ctx } from "../core/ctx.js";
import { applySync } from "../core/sync/apply.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { requireConfigPath } from "./context.js";

export interface SyncOptions {
  /** `--check`: report differences without touching the working tree. */
  check?: boolean | undefined;
}

export async function runSync(ctx: Ctx, opts: SyncOptions = {}): Promise<CommandResult> {
  requireConfigPath(ctx.root);
  const outcome = await applySync(ctx, opts.check === true);
  return outcome.ok ? success(outcome.data) : failures(outcome.errors, outcome.exitCode, outcome.data);
}
