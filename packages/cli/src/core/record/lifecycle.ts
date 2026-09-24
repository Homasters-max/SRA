/**
 * The lifecycle of a Change as data: the states of 02 section 2, the
 * transition matrix of 04 section 2 and the subsets of states other modules
 * decide by (ADR-0030 point 4: one owner per enumeration, subsets included).
 *
 * Pure: no disk, no process. Writing a transition lives in `write.ts`.
 */

/** The forward chain of 04 section 2; `ABANDONED` has no successor. */
export const FORWARD_CHAIN = ["PROPOSED", "SPECIFIED", "APPROVED", "IMPLEMENTING", "VERIFYING", "MERGED", "ARCHIVED"] as const;

/** Every `change_state` (02 section 2). */
export const CHANGE_STATES = [...FORWARD_CHAIN, "ABANDONED"] as const;

export type ChangeState = (typeof CHANGE_STATES)[number];

/** The forward transitions of 04 section 2, the only ones that have gates: `<STATE>-><NEXT>` along the chain. */
export const FORWARD_TRANSITIONS: readonly string[] = FORWARD_CHAIN.slice(1).map(
  (to, index) => `${FORWARD_CHAIN[index] as string}->${to}`
);

/** The two backward moves 04 section 2 allows; they carry no gates. */
export const BACKWARD_TRANSITIONS: readonly string[] = ["VERIFYING->IMPLEMENTING", "IMPLEMENTING->SPECIFIED"];

/** States from which `ABANDONED` may be entered: any before `MERGED`. */
export const ABANDONABLE: readonly ChangeState[] = ["PROPOSED", "SPECIFIED", "APPROVED", "IMPLEMENTING", "VERIFYING"];

/** States after which the record never changes again (ADR-0021). */
export const FROZEN_STATES: readonly ChangeState[] = ["ARCHIVED", "ABANDONED"];

/** Record states from which the ids of a change are frozen (02 section 2, 04 section 2). */
export const IDS_FROZEN_FROM: ReadonlySet<string> = new Set([
  "APPROVED",
  "IMPLEMENTING",
  "VERIFYING",
  "MERGED",
  "ARCHIVED"
]);

/** States after which a stable id may no longer move by `warrant id renumber` (ADR-0012 point 1). */
export const RENUMBER_FROZEN_STATES: ReadonlySet<string> = new Set(["MERGED", "ARCHIVED"]);

/** States in which a value below the floor may be approved: before `APPROVED` (REQ-KRN-028). */
export const BELOW_FLOOR_APPROVABLE_STATES: readonly ChangeState[] = ["PROPOSED", "SPECIFIED"];

/** States in which the links of a record may change (REQ-KRN-030). */
export const LINKABLE_STATES: readonly ChangeState[] = ["PROPOSED", "SPECIFIED"];

/** States a Change must be in to stand in `amends[]` of another (ADR-0021 point 5). */
export const AMENDS_TARGET_STATES: readonly ChangeState[] = ["MERGED", "ARCHIVED"];

/** States whose transition needs `--ref` (P-6). */
export const REF_REQUIRED_STATES: readonly ChangeState[] = ["APPROVED", "MERGED"];

export type TransitionKind = "forward" | "backward" | "abandon";

export function isChangeState(value: string): value is ChangeState {
  return (CHANGE_STATES as readonly string[]).includes(value);
}

export function isFrozen(state: string): boolean {
  return (FROZEN_STATES as readonly string[]).includes(state);
}

/** `<STATE>-><NEXT>` of the next forward transition, or null at the end of the chain. */
export function nextForwardTransition(state: string): string | null {
  const index = (FORWARD_CHAIN as readonly string[]).indexOf(state);
  if (index < 0 || index === FORWARD_CHAIN.length - 1) return null;
  return `${state}->${FORWARD_CHAIN[index + 1] as string}`;
}

/**
 * How `from -> to` is allowed by 04 section 2, or null when it is not:
 * forward only to the next state of the chain, backward only the two listed
 * moves, `ABANDONED` from any state before `MERGED`. Nothing leaves a frozen
 * state and nothing re-enters `PROPOSED`.
 */
export function transitionKind(from: string, to: string): TransitionKind | null {
  if (isFrozen(from)) return null;
  if (to === "ABANDONED") return (ABANDONABLE as readonly string[]).includes(from) ? "abandon" : null;
  const index = (FORWARD_CHAIN as readonly string[]).indexOf(from);
  if (index >= 0 && FORWARD_CHAIN[index + 1] === to) return "forward";
  if (BACKWARD_TRANSITIONS.includes(`${from}->${to}`)) return "backward";
  return null;
}
