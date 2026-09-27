/**
 * `warrant unknown add <change> --area <AREA> --text <question> [--blocking] [--dry-run]`
 * and `warrant unknown resolve <change> <UNK> --as decision|fact|assumption
 * --text <answer> [--ref <url>] [--replace] [--dry-run]` (REQ-KRN-035, 02
 * section 1, ADR-0040 п. 2): the writers of `unknowns[]` of a Change record.
 *
 * `add` appends `{ id, text, blocking }` with the next `UNK-<AREA>-NNN` over
 * specs, Changes and records (REQ-KRN-024); `resolve` writes `resolution`,
 * `resolved_as` and `ref` into an element. Both work only in `PROPOSED` and
 * `SPECIFIED` — a question of the implementation is a line `I-N` in
 * `design.md` — write no transition and write the record only through
 * `writeRecord` (schema `warrant://change-record/1`). The checks of `resolve`
 * run in the order form → record → state → element; form errors read no file.
 * Every error carries a `hint` (REQ-KRN-002). Output: `data{ change, unknown,
 * open_blocking[] }`; `--dry-run` per REQ-KRN-034.
 */
import type { Ctx } from "../core/ctx.js";
import { WarrantError, type ErrorCode } from "../core/errors.js";
import { allocateSpecLevel } from "../core/ids/allocate.js";
import { UNKNOWN_STATES } from "../core/record/lifecycle.js";
import { readChangeRecord, type ChangeRecord } from "../core/record/read.js";
import { assertNotFrozen, recordPath, stateOfRecord, writeRecord } from "../core/record/write.js";
import { addUnknown, decisionRefHint, resolveUnknown, type Edited } from "../core/unknowns/edit.js";
import { isResolutionKind, openBlockingUnknowns, RESOLUTION_KINDS, unknownsOf } from "../core/unknowns/state.js";
import { success, type CommandResult } from "../io/output.js";
import { requireConfigPath, withDryRun, withHints } from "./context.js";

export interface UnknownAddOptions {
  area?: string | undefined;
  text?: string | undefined;
  blocking?: boolean | undefined;
}

export interface UnknownResolveOptions {
  as?: string | undefined;
  text?: string | undefined;
  ref?: string | undefined;
  replace?: boolean | undefined;
}

const ADD_USAGE = "warrant unknown add <change> --area <AREA> --text <question> [--blocking]";
const RESOLVE_USAGE = "warrant unknown resolve <change> <UNK> --as decision|fact|assumption --text <answer> [--ref <url>] [--replace]";

/** `hint` of an error of shared code that was not born with one. */
const DEFAULT_HINTS: Partial<Record<ErrorCode, string>> = {
  CONFIG_MISSING: "run `warrant init` in the project root",
  CHANGE_NOT_FOUND: "check the name of the Change: `warrant status` lists them",
  RECORD_FROZEN: "an ARCHIVED or ABANDONED Change no longer changes (ADR-0021); a new question belongs to a new Change"
};

export function runUnknownAdd(ctx: Ctx, change: string | undefined, opts: UnknownAddOptions = {}): Promise<CommandResult> {
  return withDryRun(ctx, () => withHints(DEFAULT_HINTS, () => add(ctx, change, opts)));
}

export function runUnknownResolve(
  ctx: Ctx,
  change: string | undefined,
  id: string | undefined,
  opts: UnknownResolveOptions = {}
): Promise<CommandResult> {
  return withDryRun(ctx, () => withHints(DEFAULT_HINTS, () => resolve(ctx, change, id, opts)));
}

function add(ctx: Ctx, change: string | undefined, opts: UnknownAddOptions): CommandResult {
  if (change === undefined || change === "") throw new WarrantError("USAGE", "unknown add needs the name of a Change", { hint: ADD_USAGE });
  if (opts.area === undefined || opts.area === "") {
    throw new WarrantError("USAGE", "--area <AREA> is required: the area of the question, as in `warrant id UNK <AREA>`", {
      hint: ADD_USAGE
    });
  }
  const text = requiredText(opts.text, "--text <question> is required and must not be blank", ADD_USAGE);

  const { root } = ctx;
  requireConfigPath(root);
  const record = editableRecord(root, change);
  const id = allocateSpecLevel(root, "UNK", opts.area);
  return written(ctx, change, record, addUnknown(record, { id, text, blocking: opts.blocking === true }));
}

function resolve(ctx: Ctx, change: string | undefined, id: string | undefined, opts: UnknownResolveOptions): CommandResult {
  if (change === undefined || change === "" || id === undefined || id === "") {
    throw new WarrantError("USAGE", "unknown resolve needs the name of a Change and the id of its UNKNOWN", { hint: RESOLVE_USAGE });
  }
  const as = opts.as;
  if (as === undefined || !isResolutionKind(as)) {
    throw new WarrantError("USAGE", `--as must be one of ${RESOLUTION_KINDS.join(", ")}${as === undefined ? "" : ` (got "${as}")`}`, {
      hint: "decision — the maintainer's answer, the only one that closes a blocking UNKNOWN (with --ref); fact or assumption — an answer to a non-blocking one"
    });
  }
  const text = requiredText(opts.text, "--text <answer> is required and must not be blank", RESOLVE_USAGE);
  if (opts.ref !== undefined && !isHttpUrl(opts.ref)) {
    throw new WarrantError("USAGE", `--ref must be an http(s) URL (got "${opts.ref}")`, { hint: decisionRefHint(change, id) });
  }
  if (as === "decision" && opts.ref === undefined) {
    throw new WarrantError("USAGE", "--as decision needs --ref: the maintainer's decision is proven by the comment that records it", {
      hint: decisionRefHint(change, id)
    });
  }

  const { root } = ctx;
  requireConfigPath(root);
  const record = editableRecord(root, change);
  return written(ctx, change, record, resolveUnknown(record, change, id, { as, text, ref: opts.ref, replace: opts.replace }));
}

/** The trimmed text of a required `--text`; `USAGE` when it is missing or blank (SCN-KRN-151). */
function requiredText(value: string | undefined, message: string, usage: string): string {
  const text = value?.trim() ?? "";
  if (text === "") throw new WarrantError("USAGE", message, { hint: usage });
  return text;
}

/** Whether `value` is an http(s) URL: the only form of `--ref` the command checks (REQ-KRN-035). */
function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The record of `change` when `warrant unknown` may edit it: `RECORD_FROZEN`
 * for `ARCHIVED` / `ABANDONED`, `STATE_INVALID` past `SPECIFIED` (SCN-KRN-152).
 */
function editableRecord(root: string, change: string): ChangeRecord {
  const record = readChangeRecord(root, change);
  assertNotFrozen(record, change);
  const state = stateOfRecord(record);
  if (!(UNKNOWN_STATES as readonly string[]).includes(state)) {
    throw new WarrantError(
      "STATE_INVALID",
      `record of "${change}" is ${state}: UNKNOWNs are added and closed only in ${UNKNOWN_STATES.join(" or ")}, before approval`,
      {
        path: recordPath(change),
        hint: `a question of the implementation is a line I-N in openspec/changes/${change}/design.md with the maintainer's decision (skill \`decision\`)`
      }
    );
  }
  return record;
}

/** Writes the edited record and prints the element and the open blocking UNKNOWNs after the write. */
function written(ctx: Ctx, change: string, current: ChangeRecord, edited: Edited): CommandResult {
  writeRecord(ctx, change, current, edited.record);
  return success(
    { change, unknown: edited.unknown, open_blocking: openBlockingUnknowns(unknownsOf(edited.record)) },
    change
  );
}
