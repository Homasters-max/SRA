/**
 * `warrant verify <change> [--transition <FROM->TO>] [--base <ref>] [--paths <a,b>]`
 * (REQ-VER-006, P-20): the checks of the transition, then the gates, then the
 * controller — the scenario `evaluate` of `core/transition` with checks.
 *
 * A failed check (`CHECK_TIMEOUT`, `BUSY`, `CHECK_NOT_CONFIGURED`,
 * `CHECK_LOCAL_FORBIDDEN`) does not stop the gates: its gates are `BLOCKED`,
 * the failure is in `errors[]` and the exit code is the highest of the
 * failure's and the controller's.
 *
 * On `VERIFYING->MERGED` `data.findings[]` also names `FRONTEND_HOOKS_INACTIVE`
 * (REQ-VER-009): a signal that changes neither the verdicts nor the exit code.
 */
import { checksForTransition } from "../core/check/execute.js";
import type { Ctx } from "../core/ctx.js";
import { EXIT, exitCodeFor, type ExitCode } from "../core/errors.js";
import { MERGE_TRANSITION } from "../core/gates/types.js";
import { evaluate } from "../core/transition/evaluate.js";
import { decisionFields, gateData, hooksFindings } from "../core/transition/gates.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { requireConfigPath } from "./context.js";

export interface VerifyOptions {
  transition?: string | undefined;
  base?: string | undefined;
  /** `--paths a,b`: checks run their `scoped_command`; their records are then `scoped:` and not admissible (D-12). */
  paths?: string | undefined;
}

export async function runVerify(ctx: Ctx, change: string, opts: VerifyOptions = {}, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  requireConfigPath(ctx.root);
  // One set of git facts for the checks and the gates: both speak of the same commit and base.
  const evaluated = await evaluate(ctx, change, {
    transition: opts.transition,
    checks: checksForTransition,
    base: opts.base,
    paths: opts.paths,
    env
  });
  if (!evaluated.ok) {
    if (!evaluated.conflict) return failures(evaluated.errors, EXIT.CONFIG, {}, change);
    const { error, transition, decision } = evaluated;
    return failures([error], EXIT.WAIT, { transition, checks: [], gates: {}, findings: [], ...decisionFields(decision) }, change);
  }
  const { policy, run, evaluation } = evaluated;

  const hooks = evaluation.transition === MERGE_TRANSITION ? hooksFindings(ctx, change, evaluation, evaluated.loaded.config, env) : [];
  const gate = gateData(evaluation, hooks);
  const data: Record<string, unknown> = {
    transition: evaluation.transition,
    checks: run.entries,
    gates: gate["gates"],
    findings: gate["findings"],
    ...decisionFields(evaluation.decision),
    effective_policy: { hash: policy.hash, risk_level: policy.risk_level }
  };
  if (run.holder !== undefined) data["holder"] = run.holder;

  const exitCode = Math.max(run.exitCode, exitCodeFor([], evaluation.decision.controller_action)) as ExitCode;
  if (exitCode === EXIT.OK && run.errors.length === 0) return success(data, change);
  return failures(run.errors, exitCode, data, change);
}
