/**
 * `warrant://run/1` as types (REQ-ENF-001, 03 §4): the dictionaries of a Run —
 * `run_state`, `operation` — are owned here (registry `enums` of
 * `architecture.json`); those of a guard event — by the port of guard
 * (`core/ports/frontend.ts`). The schema holds the same values.
 */
import type { GuardAction, GuardDecision, GuardPhase } from "../ports/frontend.js";

/** State axis of a Run (02 §2). */
export const RUN_STATES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export type RunState = (typeof RUN_STATES)[number];

/** `run finish --state`: the states a Run ends in. */
export const FINAL_RUN_STATES: readonly RunState[] = RUN_STATES.slice(2);

/** Operation of a Run (04 §3): the artifacts of the Change, its code and tests, or a review of its spec. */
export const RUN_OPERATIONS = ["specify", "implement", "review"] as const;
export type RunOperation = (typeof RUN_OPERATIONS)[number];

/** One element of `guard_events[]` (F16): codes and ids only, no frontend. */
export interface GuardEventRecord {
  at: string;
  phase: GuardPhase;
  action: GuardAction;
  paths: string[];
  decision: GuardDecision;
  reason?: string;
  findings: string[];
  rules_shown: string[];
  argv?: string[];
}

/** A Run file `<state>/runs/<id>.json`. */
export interface Run {
  $schema: "warrant://run/1";
  id: string;
  change: string;
  operation: RunOperation;
  task?: string;
  skill?: string;
  model?: string;
  write_scope: string[];
  scope: string[];
  /** Hash of the spec tree of the Change: operation `review` only (REQ-ENF-001). */
  spec_tree?: string;
  branch: string;
  started_at: string;
  finished_at?: string;
  run_state: RunState;
  context_hash: string;
  effective_policy_hash: string;
  evidence?: string[];
  guard_events: GuardEventRecord[];
}

export function isRunOperation(value: string): value is RunOperation {
  return (RUN_OPERATIONS as readonly string[]).includes(value);
}

export function isFinalRunState(value: string): value is RunState {
  return (FINAL_RUN_STATES as readonly string[]).includes(value);
}
