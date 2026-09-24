/**
 * The outcome of a forward transition judged by its gates (REQ-VER-007,
 * REQ-VER-008): the gates that keep it out, the refusal, and the entry written
 * when it passed. Shared by `transition` and `archive`.
 */
import { exitCodeOf } from "../controller/evaluate.js";
import { EXIT, type CliError, type ExitCode } from "../errors.js";
import { PASSING_VERDICTS, type Verdict } from "../gates/types.js";
import type { TransitionEntry } from "../record/write.js";
import type { EffectivePolicy } from "../resolve/index.js";
import type { Evaluation } from "./gates.js";

/** Who records a transition made by this command (REQ-VER-007). */
export const RECORDED_BY = "cli:local";

/** Gates of an evaluation whose verdict does not let the transition through, sorted. */
export function gatesNotPassed(gates: Record<string, Verdict>): string[] {
  return Object.keys(gates)
    .filter((id) => !PASSING_VERDICTS.has(gates[id] as Verdict))
    .sort();
}

/** Ids of the records the verdicts rest on, sorted and unique. */
export function evidenceOf(evaluation: Evaluation): string[] {
  return [...new Set(Object.values(evaluation.engine.evidence).flat())].sort();
}

/** The entry written for a forward transition that passed its gates. */
export function forwardEntry(to: string, policy: EffectivePolicy, evaluation: Evaluation, ref: string | undefined): TransitionEntry {
  const entry: TransitionEntry = {
    to,
    at: new Date().toISOString(),
    by: RECORDED_BY,
    effective_policy_hash: policy.hash,
    gates: evaluation.engine.gates,
    evidence: evidenceOf(evaluation)
  };
  if (ref !== undefined) entry.ref = ref;
  return entry;
}

/**
 * `GATES_NOT_PASSED` with the verdicts; the exit code is the controller's, and
 * never 0 — a gate that did not pass always keeps the transition out.
 */
export function gatesNotPassedRefusal(evaluation: Evaluation, failed: string[]): { error: CliError; exitCode: ExitCode } {
  let code: ExitCode = exitCodeOf(evaluation.decision.controller_action);
  if (code === EXIT.OK) code = EXIT.WAIT;
  const message = `${evaluation.transition}: gates not passed: ${failed.map((id) => `${id} ${String(evaluation.engine.gates[id])}`).join(", ")}`;
  return { error: { code: "GATES_NOT_PASSED", message }, exitCode: code };
}
