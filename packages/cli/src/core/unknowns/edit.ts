/**
 * Adding and closing an UNKNOWN of a Change record (REQ-KRN-035, 02 section 1,
 * ADR-0040 п. 2). Pure: the functions take a record and return the updated
 * one with the written element; the command reads, checks the state and writes
 * through `writeRecord`.
 *
 * A blocking UNKNOWN is closed only by the maintainer's decision — `decision`
 * with `ref`, the URL of a pull request comment whose text names the UNKNOWN;
 * `fact` and `assumption` close only non-blocking ones and add nothing to
 * `assumptions[]`. `warrant ci` verifies the ref (REQ-VER-013), not this module.
 */
import { WarrantError } from "../errors.js";
import { isPlainObject } from "../json.js";
import { recordPath } from "../record/write.js";
import { isClosed, openUnknowns, unknownsOf, type ResolutionKind } from "./state.js";

/** A new UNKNOWN: its id is allocated by the caller (`allocateSpecLevel`, REQ-KRN-024). */
export interface NewUnknown {
  id: string;
  text: string;
  blocking: boolean;
}

/** The answer that closes an UNKNOWN. */
export interface Resolution {
  as: ResolutionKind;
  text: string;
  ref?: string | undefined;
  /** Rewrite an element that is already closed (`--replace`). */
  replace?: boolean | undefined;
}

/** A record with the element written into it. */
export interface Edited {
  record: Record<string, unknown>;
  unknown: Record<string, unknown>;
}

/**
 * `hint` of a blocking UNKNOWN closed without the maintainer's decision: the
 * form of `--ref` and the id its comment must name (SCN-KRN-150).
 */
export function decisionRefHint(change: string, id: string): string {
  return (
    `a blocking UNKNOWN is closed by the maintainer's decision: \`warrant unknown resolve ${change} ${id} --as decision ` +
    `--text <answer> --ref <URL>\`, where <URL> is the maintainer's comment in the pull request — ` +
    `https://github.com/<owner>/<repo>/pull/<N>#issuecomment-<id> or …/pull/<N>#pullrequestreview-<id> — whose text names ${id}`
  );
}

/** The record with `unknown` appended to `unknowns[]`. */
export function addUnknown(record: Record<string, unknown>, unknown: NewUnknown): Edited {
  const entry: Record<string, unknown> = { id: unknown.id, text: unknown.text, blocking: unknown.blocking };
  return { record: { ...record, unknowns: [...unknownsOf(record), entry] }, unknown: entry };
}

/**
 * The record with the answer written into the element `id`: `resolution`,
 * `resolved_as` and `ref` (a ref of a previous answer is dropped). Throws
 * `UNKNOWN_NOT_FOUND`, `UNKNOWN_RESOLVED` without `replace`, and `USAGE` for
 * `fact` / `assumption` of a blocking UNKNOWN — each with its `hint`.
 */
export function resolveUnknown(record: Record<string, unknown>, change: string, id: string, answer: Resolution): Edited {
  const unknowns = unknownsOf(record);
  const index = unknowns.findIndex((e) => isPlainObject(e) && e["id"] === id);
  const current = unknowns[index];
  if (index < 0 || !isPlainObject(current)) {
    const open = openUnknowns(unknowns);
    throw new WarrantError("UNKNOWN_NOT_FOUND", `record of "${change}" has no UNKNOWN ${id}`, {
      path: `${recordPath(change)}#/unknowns`,
      hint:
        open.length === 0
          ? `the Change has no open UNKNOWN; \`warrant unknown add ${change} --area <AREA> --text <question>\` records one`
          : `open UNKNOWNs of the Change: ${open.join(", ")}`
    });
  }
  const at = `${recordPath(change)}#/unknowns/${index}`;
  if (isClosed(current) && answer.replace !== true) {
    throw new WarrantError("UNKNOWN_RESOLVED", `${id} is already closed: ${String(current["resolution"])}`, {
      path: at,
      hint: `add --replace to rewrite its answer, resolved_as and ref (for example, a ref to a new comment of the maintainer)`
    });
  }
  if (current["blocking"] === true && answer.as !== "decision") {
    throw new WarrantError("USAGE", `${id} is blocking: --as ${answer.as} closes only a non-blocking UNKNOWN`, {
      path: at,
      hint: decisionRefHint(change, id)
    });
  }
  const entry: Record<string, unknown> = {
    id,
    text: current["text"],
    blocking: current["blocking"],
    resolution: answer.text,
    resolved_as: answer.as
  };
  if (answer.ref !== undefined) entry["ref"] = answer.ref;
  const next = unknowns.map((e, i) => (i === index ? entry : e));
  return { record: { ...record, unknowns: next }, unknown: entry };
}
