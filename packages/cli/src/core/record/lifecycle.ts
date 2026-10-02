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

/**
 * The three backward moves 04 section 2 allows; they carry no gates.
 * `SPECIFIED->PROPOSED` — a rework of the spec before approval (ADR-0056 п. 3):
 * only for a Change never `APPROVED`, which `transition` and `warrant ci` check
 * on the history ({@link wasApproved}).
 */
export const BACKWARD_TRANSITIONS: readonly string[] = ["VERIFYING->IMPLEMENTING", "IMPLEMENTING->SPECIFIED", "SPECIFIED->PROPOSED"];

/** The backward move of a rework of the spec (REQ-VER-018). */
export const REWORK = "SPECIFIED->PROPOSED";

/** Whether `transitions` (of a record, in order) hold an `APPROVED` before `index` (all of them without `index`). */
export function wasApproved(transitions: readonly unknown[], index = transitions.length): boolean {
  return transitions.slice(0, index).some((t) => typeof t === "object" && t !== null && (t as Record<string, unknown>)["to"] === "APPROVED");
}

/**
 * Whether `transitions` hold a rework (`PROPOSED` after the first entry) before
 * `index` (REQ-VER-018): the Change went back from `SPECIFIED` to `PROPOSED`.
 */
export function wasReworked(transitions: readonly unknown[], index = transitions.length): boolean {
  return transitions
    .slice(1, index)
    .some((t) => typeof t === "object" && t !== null && (t as Record<string, unknown>)["to"] === "PROPOSED");
}

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

/** States in which `warrant unknown` adds or closes an UNKNOWN: before approval (REQ-KRN-035). */
export const UNKNOWN_STATES: readonly ChangeState[] = ["PROPOSED", "SPECIFIED"];

/**
 * States of the record of the base from which a pull request keeps every
 * element of `unknowns[]` and does not weaken it: `SPECIFIED` and later
 * (REQ-VER-011 «Record», I-188).
 */
export const UNKNOWNS_HELD_STATES: ReadonlySet<string> = new Set(FORWARD_CHAIN.slice(FORWARD_CHAIN.indexOf("SPECIFIED")));

/** States a Change must be in to stand in `amends[]` of another (ADR-0021 point 5). */
export const AMENDS_TARGET_STATES: readonly ChangeState[] = ["MERGED", "ARCHIVED"];

/** States in which `status` reports `FRONTEND_HOOKS_INACTIVE`: `IMPLEMENTING` and later (REQ-VER-009). */
export const HOOKS_LIVENESS_STATES: readonly ChangeState[] = ["IMPLEMENTING", "VERIFYING", "MERGED", "ARCHIVED"];

/** Kind of a pull request (REQ-VER-011): by `change_state` of the one record its diff changes, `none` without one. */
export type PrKind = "spec" | "impl" | "archive" | "abandon" | "none";

/** How the entry into a state is confirmed by the merge of a pull request (A-32). */
export interface Confirmation {
  /** The transition whose approval the merge records. */
  transition: string;
  /** The transition the pull request brings into the record: the one it is the merge of. */
  broughtBy: ChangeState;
  /** The kind of that pull request; its URL is the `--ref` of the transition. */
  pr: Extract<PrKind, "spec" | "impl">;
}

/**
 * The states whose transition is confirmed by a merged pull request (P-6,
 * ADR-0037 п. 5, A-32): `APPROVED` by the spec-PR that brought `SPECIFIED`,
 * `MERGED` by the impl-PR that brought `VERIFYING`. `transition` needs `--ref`
 * for them, `warrant ci` verifies that ref through the forge.
 */
export const CONFIRMED_BY = {
  APPROVED: { transition: "SPECIFIED->APPROVED", broughtBy: "SPECIFIED", pr: "spec" },
  MERGED: { transition: "VERIFYING->MERGED", broughtBy: "VERIFYING", pr: "impl" }
} as const satisfies Partial<Record<ChangeState, Confirmation>>;

/** The {@link Confirmation} of the entry into `state`, or undefined when no pull request confirms it. */
export function confirmationOf(state: string): Confirmation | undefined {
  return isChangeState(state) ? (CONFIRMED_BY as Partial<Record<ChangeState, Confirmation>>)[state] : undefined;
}

/** States whose transition needs `--ref`, the URL of a pull request: the keys of {@link CONFIRMED_BY}. */
export const REF_REQUIRED_STATES: readonly ChangeState[] = Object.keys(CONFIRMED_BY) as ChangeState[];

/** {@link PrKind} of a pull request whose record ends in the state (REQ-VER-011, N33). */
export const PR_KIND_OF_STATE: Readonly<Record<ChangeState, Exclude<PrKind, "none">>> = {
  PROPOSED: "spec",
  SPECIFIED: "spec",
  APPROVED: "impl",
  IMPLEMENTING: "impl",
  VERIFYING: "impl",
  MERGED: "archive",
  ARCHIVED: "archive",
  ABANDONED: "abandon"
};

/** The kinds of a pull request after the spec-PR (A-36): the record is past `SPECIFIED`, its classification is judged (SCN-VER-105). */
const MERGE_KINDS: ReadonlySet<PrKind> = new Set(["impl", "archive", "abandon"]);

/** Whether `kind` is a pull request after the spec-PR: `impl`, `archive` or `abandon` (A-36). */
export function isMergeKind(kind: PrKind): boolean {
  return MERGE_KINDS.has(kind);
}

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
 * forward only to the next state of the chain, backward only the three listed
 * moves, `ABANDONED` from any state before `MERGED`. Nothing leaves a frozen
 * state; `PROPOSED` is re-entered only by `SPECIFIED->PROPOSED`.
 */
export function transitionKind(from: string, to: string): TransitionKind | null {
  if (isFrozen(from)) return null;
  if (to === "ABANDONED") return (ABANDONABLE as readonly string[]).includes(from) ? "abandon" : null;
  const index = (FORWARD_CHAIN as readonly string[]).indexOf(from);
  if (index >= 0 && FORWARD_CHAIN[index + 1] === to) return "forward";
  if (BACKWARD_TRANSITIONS.includes(`${from}->${to}`)) return "backward";
  return null;
}
