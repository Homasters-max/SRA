/**
 * `warrant gate <change> [id...] [--transition <FROM->TO>] [--base <ref>]`
 * (REQ-VER-003, REQ-VER-004, REQ-VER-005, design §8, §9, §11).
 *
 * Gathers what the gate engine needs — records, waivers, git facts, artifact
 * statuses, stable ids — evaluates the gates of the transition (default: the
 * next forward one from `change_state`) and the controller over them, and
 * prints `data.transition`, `data.gates`, `data.findings[]`,
 * `data.controller_action`, `data.next`? and `data.rule`. The exit code is the
 * controller's: CONTINUE 0, STOP 1, WAIT and ESCALATE 2. On `VERIFYING->MERGED`
 * `data.findings[]` also names `FRONTEND_HOOKS_INACTIVE` (REQ-VER-009), which
 * changes neither the verdicts nor the exit code.
 *
 * The steps live in `core/transition/` and are shared with `verify`,
 * `archive`, `transition` and `status`: git and OpenSpec are only ever reached
 * through `ctx`, the engine and the controller stay pure.
 */
import type { Ctx } from "../core/ctx.js";
import { EXIT, exitCodeFor } from "../core/errors.js";
import { MERGE_TRANSITION } from "../core/gates/types.js";
import { evaluate } from "../core/transition/evaluate.js";
import { decisionFields, gateData, hooksFindings } from "../core/transition/gates.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { requireConfigPath } from "./context.js";

export interface GateOptions {
  /** `--transition <FROM->TO>`; default — the next forward transition from `change_state`. */
  transition?: string | undefined;
  /** `--base <ref>`; default `merge-base(HEAD, main)`. */
  base?: string | undefined;
}

export async function runGate(
  ctx: Ctx,
  change: string,
  ids: string[],
  opts: GateOptions = {},
  env: NodeJS.ProcessEnv = process.env
): Promise<CommandResult> {
  requireConfigPath(ctx.root);
  const evaluated = await evaluate(ctx, change, { transition: opts.transition, base: opts.base, env, gates: ids });
  if (!evaluated.ok) {
    if (!evaluated.conflict) return failures(evaluated.errors, EXIT.CONFIG, {}, change);
    const { error, transition, decision } = evaluated;
    return failures([error], EXIT.WAIT, { transition, gates: {}, findings: [], ...decisionFields(decision) }, change);
  }
  const { evaluation } = evaluated;

  const hooks = evaluation.transition === MERGE_TRANSITION ? hooksFindings(ctx, change, evaluation, evaluated.loaded.config, env) : [];
  const data = gateData(evaluation, hooks);
  const exitCode = exitCodeFor([], evaluation.decision.controller_action);
  return exitCode === EXIT.OK ? success(data, change) : failures([], exitCode, data, change);
}
