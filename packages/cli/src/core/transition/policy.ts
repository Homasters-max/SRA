/**
 * Which transition, and under which policy (design §8): the transition asked
 * for or the next forward one, the effective policy of the record — or the
 * conflict and the controller's decision on it — and the gate ids named on
 * the command line.
 */
import { conflictInputs } from "../controller/inputs.js";
import { controllerRules, evaluateController, type ControllerDecision } from "../controller/evaluate.js";
import { WarrantError, type CliError } from "../errors.js";
import type { LoadResult } from "../packs/types.js";
import { FORWARD_TRANSITIONS, nextForwardTransition } from "../record/lifecycle.js";
import type { ChangeRecord } from "../record/read.js";
import { resolveForProject, type Classification, type EffectivePolicy } from "../resolve/index.js";
import { gateDefinitions } from "./gates.js";

/** `--transition`, else the next forward transition; USAGE when there is none. */
export function transitionOf(record: ChangeRecord, requested: string | undefined): string {
  if (requested !== undefined) {
    if (!FORWARD_TRANSITIONS.includes(requested)) {
      throw new WarrantError("USAGE", `--transition ${JSON.stringify(requested)} is not one of: ${FORWARD_TRANSITIONS.join(", ")}`);
    }
    return requested;
  }
  const state = String(record["change_state"]);
  const next = nextForwardTransition(state);
  if (next === null) {
    throw new WarrantError("USAGE", `change is ${state}: there is no forward transition to evaluate`, { hint: "pass --transition" });
  }
  return next;
}

/** The decision of the controller when the policy could not be composed (`policy-conflict`). */
export function conflictDecision(loaded: LoadResult, record: ChangeRecord): ControllerDecision {
  const unknowns = Array.isArray(record["unknowns"]) ? record["unknowns"] : [];
  return evaluateController(controllerRules(loaded), conflictInputs(unknowns));
}

/** Resolved policy of the record, or the conflict / configuration errors. */
export type Resolved =
  | { ok: true; policy: EffectivePolicy }
  | { ok: false; conflict: true; error: CliError }
  | { ok: false; conflict: false; errors: CliError[] };

export function resolveRecord(loaded: LoadResult, change: string, record: ChangeRecord): Resolved {
  const resolved = resolveForProject(loaded, record["classification"] as Classification | undefined);
  if (resolved.errors.length > 0) return { ok: false, conflict: false, errors: resolved.errors };
  if (!resolved.result.ok) {
    return { ok: false, conflict: true, error: { code: "POLICY_CONFLICT", message: `${change}: ${resolved.result.conflict.message}` } };
  }
  return { ok: true, policy: resolved.result.policy };
}

/** Gate ids named on the command line: declared, and part of the transition. */
export function checkedIds(ids: string[], loaded: LoadResult, policy: EffectivePolicy, transition: string): string[] | undefined {
  if (ids.length === 0) return undefined;
  const declared = gateDefinitions(loaded);
  const inTransition = new Set(policy.gates[transition] ?? []);
  for (const id of ids) {
    if (!declared.has(id)) throw new WarrantError("USAGE", `no gate "${id}" in the enabled packs or .warrant/local/`);
    if (!inTransition.has(id)) {
      throw new WarrantError("USAGE", `gate "${id}" is not a gate of ${transition} in the effective policy`);
    }
  }
  return [...new Set(ids)];
}

