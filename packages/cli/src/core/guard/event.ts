/**
 * The normalised event of `warrant guard` (REQ-ENF-004, ADR-0018 п. 2): what a
 * frontend adapter makes of its native hook input, and what `warrant guard`
 * without `--frontend` reads from stdin — `{ phase, action, paths[], argv?, cwd }`.
 * Keys beyond these are ignored (ADR-0018 names `run?`, which guard does not
 * need: the active Run is the one `<state>/runs/current` names).
 */
import { isPlainObject } from "../json.js";
import { GUARD_ACTIONS, GUARD_PHASES, type GuardAction, type GuardPhase } from "../run/types.js";

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

export type ParsedEvent =
  | { ok: true; event: GuardEvent }
  /** `phase`, when it could be read: a broken `post` event is still `post` (F9). */
  | { ok: false; phase: GuardPhase | undefined; message: string };

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** Reads the event from the text of stdin; what is wrong with it is named in `message`. */
export function parseEvent(text: string): ParsedEvent {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return { ok: false, phase: undefined, message: `the guard event is not JSON: ${(cause as Error).message}` };
  }
  if (!isPlainObject(json)) return { ok: false, phase: undefined, message: "the guard event is not a JSON object" };
  const phase = oneOf(GUARD_PHASES, json["phase"]) ? json["phase"] : undefined;
  const fail = (message: string): ParsedEvent => ({ ok: false, phase, message: `the guard event ${message}` });

  if (phase === undefined) return fail(`has no phase ${GUARD_PHASES.join(" | ")}`);
  const action = json["action"];
  if (!oneOf(GUARD_ACTIONS, action)) return fail(`has no action ${GUARD_ACTIONS.join(" | ")}`);
  const paths = json["paths"];
  if (!isStrings(paths)) return fail("has no paths[] of strings");
  const argv = json["argv"];
  if (argv !== undefined && !isStrings(argv)) return fail("has argv that is not an array of strings");
  const cwd = json["cwd"];
  if (typeof cwd !== "string" || cwd === "") return fail("has no cwd");
  return { ok: true, event: { phase, action, paths, ...(argv === undefined ? {} : { argv }), cwd } };
}
