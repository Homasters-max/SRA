/**
 * Catalogue of error codes emitted in the CLI envelope (`errors[].code`).
 * Phase 1 list comes from design.md D-8; codes are UPPER_SNAKE (REQ-KRN-002).
 */
export const ERROR_CODES = [
  "USAGE",
  "CONFIG_MISSING",
  "CONFIG_INVALID",
  "SCHEMA_UNKNOWN",
  "SCHEMA_VIOLATION",
  "SEMANTIC_INVALID",
  "ARTIFACT_UNKNOWN",
  "DUPLICATE_OBJECT_ID",
  "OVERRIDE_INVALID",
  "OVERRIDE_WEAKENS",
  "LOCK_MISMATCH",
  "GENERATED_DRIFT",
  "OPENSPEC_SCHEMA_INVALID",
  "RULES_ARTIFACT_UNKNOWN",
  "ID_FORMAT",
  "ID_PLACEMENT",
  "ID_DUPLICATE",
  "ID_TAKEN",
  "ID_IMMUTABLE",
  "AREA_UNKNOWN",
  "SECRET_LIKE",
  "NOT_CANONICAL",
  "ALREADY_INITIALIZED",
  "CHANGE_NAME_TAKEN",
  "CHANGE_NOT_FOUND",
  "PACK_NOT_FOUND",
  "POLICY_CONFLICT",
  "OPENSPEC_VERSION",
  "OPENSPEC_FAILED",
  "RULE_SCOPE",
  "LINK_TARGET_INVALID",
  "WAIVER_INVALID",
  "PACK_FORM_UNKNOWN",
  "BUSY",
  "CHECK_TIMEOUT",
  "CHECK_NOT_CONFIGURED",
  "RECORD_FROZEN",
  "STATE_INVALID",
  "GATES_NOT_PASSED",
  "ROLE_REQUIRED",
  "COMMIT_NOT_MERGED",
  "BELOW_FLOOR",
  "INTERNAL"
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** One entry of `errors[]` in the envelope. `path` is a file path or a JSON Pointer. */
export interface CliError {
  code: ErrorCode;
  message: string;
  path?: string;
}

/** Exit codes per REQ-KRN-003. */
export const EXIT = {
  OK: 0,
  FAIL: 1,
  WAIT: 2,
  CONFIG: 3
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * Exception carrying a catalogued code. Core modules throw it; the command
 * layer converts it into `errors[]` and the exit code (design D-8).
 */
export class WarrantError extends Error {
  readonly code: ErrorCode;
  readonly path: string | undefined;
  readonly exitCode: ExitCode;

  constructor(code: ErrorCode, message: string, options: { path?: string; exitCode?: ExitCode } = {}) {
    super(message);
    this.name = "WarrantError";
    this.code = code;
    this.path = options.path;
    this.exitCode = options.exitCode ?? EXIT.CONFIG;
  }

  toCliError(): CliError {
    return this.path === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, path: this.path };
  }
}

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}
