/**
 * Class of an error code (REQ-KRN-003, design D1): what kind of failure it is,
 * which gives its exit code in every command — `rule` 1 (the subject of
 * judgement breaks a rule), `wait` 2 (the transition waits for an action),
 * `config` 3 (configuration, an invalid file, usage, a failed tool, `INTERNAL`),
 * `retry` 4 (an infrastructure failure a retry may get past).
 */
export type ErrorClass = "rule" | "wait" | "config" | "retry";

/**
 * Catalogue of error codes emitted in the CLI envelope (`errors[].code`), each
 * with its one class (REQ-KRN-003, design D1). Codes are UPPER_SNAKE
 * (REQ-KRN-002); a new code has no exit code of its own, only a class.
 */
export const ERROR_CODES = {
  USAGE: "config",
  CONFIG_MISSING: "config",
  CONFIG_INVALID: "config",
  SCHEMA_UNKNOWN: "config",
  SCHEMA_VIOLATION: "config",
  SEMANTIC_INVALID: "config",
  ARTIFACT_UNKNOWN: "config",
  DUPLICATE_OBJECT_ID: "config",
  OVERRIDE_INVALID: "config",
  OVERRIDE_WEAKENS: "config",
  LOCK_MISMATCH: "config",
  GENERATED_DRIFT: "config",
  GENERATED_TOO_LARGE: "config",
  OPENSPEC_SCHEMA_INVALID: "config",
  RULES_ARTIFACT_UNKNOWN: "config",
  ID_FORMAT: "config",
  ID_PLACEMENT: "config",
  ID_DUPLICATE: "config",
  ID_TAKEN: "config",
  ID_IMMUTABLE: "config",
  ID_DANGLING: "config",
  AREA_UNKNOWN: "config",
  SECRET_LIKE: "config",
  NOT_CANONICAL: "config",
  ALREADY_INITIALIZED: "config",
  CHANGE_NAME_TAKEN: "config",
  CHANGE_NOT_FOUND: "config",
  PACK_NOT_FOUND: "config",
  /** An enabled pack's version outside the range of `warrant.json` (design D8). */
  PACK_VERSION_RANGE: "config",
  POLICY_CONFLICT: "wait",
  OPENSPEC_VERSION: "config",
  OPENSPEC_FAILED: "config",
  RULE_SCOPE: "config",
  LINK_TARGET_INVALID: "config",
  WAIVER_INVALID: "config",
  PACK_FORM_UNKNOWN: "config",
  BUSY: "retry",
  CHECK_TIMEOUT: "retry",
  CHECK_NOT_CONFIGURED: "config",
  CHECK_LOCAL_FORBIDDEN: "config",
  RECORD_FROZEN: "config",
  STATE_INVALID: "config",
  GATES_NOT_PASSED: "wait",
  ROLE_REQUIRED: "config",
  COMMIT_NOT_MERGED: "config",
  REF_MISMATCH: "config",
  BELOW_FLOOR: "config",
  BASE_BEHIND_UPSTREAM: "config",
  RUN_ACTIVE: "config",
  RUN_NOT_ACTIVE: "config",
  SPEC_UNCOMMITTED: "config",
  SKILL_RESULT_INVALID: "config",
  FORGE_UNAVAILABLE: "retry",
  /** The forge refuses access: `gh` missing or not logged in, HTTP 401, 403 without a rate limit (design D7). */
  FORGE_ACCESS: "config",
  TOPOLOGY_VIOLATION: "rule",
  RECORD_MISMATCH: "rule",
  REF_NOT_VERIFIED: "rule",
  SCOPE_VIOLATION: "rule",
  GATE_NOT_PASSED: "rule",
  CHANGE_NOT_VERIFYING: "rule",
  EVIDENCE_NOT_VERIFIED: "rule",
  SPECS_NOT_ARCHIVED: "rule",
  PR_NOT_FOUND: "config",
  PR_NOT_MERGED: "config",
  PR_NOT_IMPL: "config",
  COMMIT_NOT_FOUND: "config",
  NO_CI_EVIDENCE: "config",
  EVIDENCE_CONFLICT: "config",
  UNKNOWN_NOT_FOUND: "config",
  UNKNOWN_RESOLVED: "config",
  INTERNAL: "config"
} as const satisfies Record<string, ErrorClass>;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * One entry of `errors[]` in the envelope. `path` is a file path or a JSON Pointer;
 * `message` says what is wrong, `hint` — the command or action that fixes it
 * (REQ-KRN-002, ADR-0034 п. 8). The fix text is never repeated in `message`.
 */
export interface CliError {
  code: ErrorCode;
  message: string;
  path?: string;
  hint?: string;
}

/** `hint` of errors fixed by regenerating the lock and the generated files. */
export const SYNC_HINT = "run `warrant sync`";

/** `hint` of errors fixed by rewriting files in canonical form. */
export const FMT_HINT = "run `warrant fmt`";

/** `hint` of `FORGE_UNAVAILABLE`: how to give `gh` a token (ADR-0037 п. 6). */
export const FORGE_HINT = "run `gh auth login`, or set `GH_TOKEN` to a GitHub token with read access to the repository";

/** Options of an `errors[]` entry: where it is and how to fix it. */
export interface ErrorOptions {
  path?: string;
  hint?: string;
}

/**
 * The one factory of an `errors[]` entry (A-17): the keys `path` and `hint` are
 * present only when given, keys in the order `code`, `message`, `path`, `hint`.
 */
export function cliError(code: ErrorCode, message: string, options: ErrorOptions = {}): CliError {
  const error: CliError = { code, message };
  if (options.path !== undefined) error.path = options.path;
  if (options.hint !== undefined) error.hint = options.hint;
  return error;
}

/** Exit codes per REQ-KRN-003; a command's code is chosen only by `exitCodeFor`. */
export const EXIT = {
  OK: 0,
  FAIL: 1,
  WAIT: 2,
  CONFIG: 3,
  RETRY: 4
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Exit code of each class (REQ-KRN-003). */
const CLASS_EXIT = {
  rule: EXIT.FAIL,
  wait: EXIT.WAIT,
  config: EXIT.CONFIG,
  retry: EXIT.RETRY
} as const satisfies Record<ErrorClass, ExitCode>;

/** True for a code of class `retry`: its `errors[]` entry carries `retryable: true` (REQ-KRN-002, design D5). */
export function isRetryable(code: ErrorCode): boolean {
  return ERROR_CODES[code] === "retry";
}

/**
 * Action of the controller (04 section 4, REQ-VER-005). Declared here, not in
 * `core/controller`: rank 0 does not import the controller, which reuses the
 * type (design D2).
 */
export type ControllerAction = "CONTINUE" | "WAIT" | "STOP" | "ESCALATE";

/**
 * What enters the exit code besides `errors[]` (design D2): the controller
 * action of `gate`, `verify`, `transition`, `archive`, or the verdict `FAIL`
 * of `analyze` (findings).
 */
export type Outcome = ControllerAction | "FAIL";

/** Exit code of an outcome (REQ-KRN-003): CONTINUE 0, STOP and FAIL 1, WAIT and ESCALATE 2. */
const OUTCOME_EXIT = {
  CONTINUE: EXIT.OK,
  STOP: EXIT.FAIL,
  FAIL: EXIT.FAIL,
  WAIT: EXIT.WAIT,
  ESCALATE: EXIT.WAIT
} as const satisfies Record<Outcome, ExitCode>;

/**
 * Exit codes from the eldest down (REQ-KRN-003): an error a retry cannot fix
 * (3, then 1) is elder than a retryable one (4), and that is elder than a wait
 * (2) computed on data a failure left incomplete.
 */
const PRIORITY = [EXIT.CONFIG, EXIT.FAIL, EXIT.RETRY, EXIT.WAIT] as const;

/**
 * The one choice of a command's exit code (REQ-KRN-003, design D2): the eldest,
 * by `3 > 1 > 4 > 2 > 0`, of the classes of `errors` and the code of
 * `outcome`. No errors and no outcome, or `CONTINUE` — 0. A code outside the
 * catalogue (never typed so, but read from outside) counts as `config`.
 */
export function exitCodeFor(errors: readonly Pick<CliError, "code">[], outcome?: Outcome): ExitCode {
  const present = new Set<ExitCode>(errors.map((error) => CLASS_EXIT[ERROR_CODES[error.code] ?? "config"]));
  if (outcome !== undefined) present.add(OUTCOME_EXIT[outcome]);
  return PRIORITY.find((code) => present.has(code)) ?? EXIT.OK;
}

/**
 * Exception carrying a catalogued code. Core modules throw it; the command
 * layer converts it into `errors[]` and the exit code (design D-8).
 */
export class WarrantError extends Error {
  readonly code: ErrorCode;
  readonly path: string | undefined;
  readonly hint: string | undefined;
  /**
   * @deprecated Transitional (exit-contract group 3 removes it with the option
   * `exitCode`): the code a throwing site chose itself, 3 when it chose none.
   * The code of an error is the class of `code` (`exitCodeFor`, design D4).
   */
  readonly exitCode: ExitCode;
  /** What the failing command puts in `data` (`{}` without it), e.g. `received` of `SKILL_RESULT_INVALID` (I-199). */
  readonly data: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, options: ErrorOptions & { exitCode?: ExitCode; data?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "WarrantError";
    this.code = code;
    this.path = options.path;
    this.hint = options.hint;
    this.exitCode = options.exitCode ?? EXIT.CONFIG;
    this.data = options.data;
  }

  toCliError(): CliError {
    const options: ErrorOptions = {};
    if (this.path !== undefined) options.path = this.path;
    if (this.hint !== undefined) options.hint = this.hint;
    return cliError(this.code, this.message, options);
  }
}

/**
 * The one form of `FORGE_UNAVAILABLE` of `ForgePort` (REQ-VER-011, REQ-VER-012):
 * code 3, `hint` about `gh auth login` or `GH_TOKEN` unless another fixes it.
 */
export function forgeUnavailable(message: string, hint: string = FORGE_HINT): WarrantError {
  return new WarrantError("FORGE_UNAVAILABLE", message, { hint });
}

export function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}
