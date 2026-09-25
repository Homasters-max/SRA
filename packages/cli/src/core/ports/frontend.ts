/**
 * Port of guard (ADR-0018 п. 2, ADR-0034 п. 2, design phase-4a §2): the
 * normalised event `warrant guard` decides on, its decision, and a frontend
 * adapter — the translation of an agent's native hook input into the event
 * and of the decision into the native answer, nothing more. The logic of the
 * decision lives in `core/guard`; the adapters live in `adapters/frontend/**`
 * and `bin` picks one by `--frontend` (REQ-ENF-005).
 *
 * The dictionaries of the event and of the decision are owned here (registry
 * `enums`, `guard-decision`); `run/1` keeps the same values in `guard_events[]`.
 */

/** Decision of `warrant guard` on one action (ADR-0018 п. 2). */
export const GUARD_DECISIONS = ["allow", "deny"] as const;
export type GuardDecision = (typeof GUARD_DECISIONS)[number];

/** When guard is asked: before or after the action of the agent (ADR-0018 п. 2). */
export const GUARD_PHASES = ["pre", "post"] as const;
export type GuardPhase = (typeof GUARD_PHASES)[number];

/** Kind of the action guard is asked about: a file edit, a shell command, anything else. */
export const GUARD_ACTIONS = ["edit", "shell", "other"] as const;
export type GuardAction = (typeof GUARD_ACTIONS)[number];

/** The normalised event: `{ phase, action, paths[], argv?, cwd }` (REQ-ENF-004). */
export interface GuardEvent {
  phase: GuardPhase;
  action: GuardAction;
  /** Paths the action touches: absolute, or relative to `cwd`. */
  paths: string[];
  /** The shell command as words (operators `&&`, `||`, `;`, `|` and a newline are words of their own). */
  argv?: string[];
  /** Working directory of the action. */
  cwd: string;
}

/** What guard answers on one event: `data` of `warrant guard` (REQ-ENF-004). */
export interface GuardResult {
  decision: GuardDecision;
  reason?: string;
  hints: string[];
}

/** The native answer of an adapter: its stdout and the exit code of `warrant guard --frontend`. */
export interface FrontendResponse {
  stdout: string;
  exit: number;
}

/**
 * Exit of a native input the adapter does not read (REQ-ENF-005): the reason
 * on stderr, stdout empty — the hook protocol cancels a `pre` action on it
 * (fail closed, F9) and shows the reason after a `post` one.
 */
export const UNREADABLE_EXIT = 2;

/** A frontend adapter: translation only (ADR-0034 п. 2). */
export interface FrontendAdapter {
  /** The value of `--frontend`. */
  readonly name: string;
  /** What the native input is, for the message of one that does not read. */
  readonly input: string;
  /** The event of a native input (parsed JSON); `undefined` when it is not one the adapter reads. */
  toEvent(native: unknown): GuardEvent | undefined;
  /** The native answer to `result`, guard's decision on `event`. */
  respond(result: GuardResult, event: GuardEvent): FrontendResponse;
}
