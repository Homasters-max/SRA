/**
 * Two predicates of the verdict algorithm (06 section 3) as pure functions
 * (design D5 of agent-merge, A-39): whether a gate applies to a diff (step 1,
 * `applies_when`) and which waiver of a gate and Change counts (step 4). The
 * gate engine (`verdict.ts`), `evidence-complete` and the judge of `warrant ci`
 * (`core/ci/record.ts`, the rule `verdicts`) ask them and get the same answer.
 */
import { pathMatcher } from "../glob.js";
import { isPlainObject, strings } from "../json.js";
import type { DiffEntry } from "../ports/git.js";
import type { WaiverInput } from "../waivers/read.js";
import { waiverStatus, type WaiverContext, type WaiverIgnoredReason } from "../waivers/status.js";

/** `applies_when.changed_paths` of a gate document; empty — the gate sets no condition on the diff. */
export function appliesWhenPaths(definition: Record<string, unknown> | undefined): string[] {
  const appliesWhen = definition?.["applies_when"];
  return isPlainObject(appliesWhen) ? strings(appliesWhen["changed_paths"]) : [];
}

/**
 * Whether the gate applies to `diff` (step 1): it has no `applies_when.changed_paths`,
 * or one of them matches a path of the diff — either side of a rename.
 */
export function appliesTo(definition: Record<string, unknown> | undefined, diff: readonly DiffEntry[]): boolean {
  const patterns = appliesWhenPaths(definition);
  if (patterns.length === 0) return true;
  const matches = pathMatcher(patterns);
  return diff.some((entry) => [entry.path, entry.from].some((p) => p !== undefined && matches(p)));
}

/** A waiver of the gate and Change that does not count, with the reason of `waiverStatus`. */
export interface IgnoredWaiver {
  waiver: WaiverInput;
  reason: WaiverIgnoredReason;
}

export interface CountingWaiver {
  /** The first waiver by id of the gate and Change that counts; undefined — none does. */
  counting: WaiverInput | undefined;
  /** The waivers of the gate and Change before it by id that do not count. */
  ignored: IgnoredWaiver[];
}

/**
 * The waiver of `gate` and `change` that counts (step 4, `waiverStatus`), each
 * judged against the gate document of `definitions`: waivers are taken in the
 * order of their ids, the first that counts wins.
 */
export function countingWaiver(
  gate: string,
  change: string,
  waivers: readonly WaiverInput[],
  definitions: ReadonlyMap<string, Record<string, unknown>>,
  ctx: WaiverContext
): CountingWaiver {
  const definition = definitions.get(gate);
  const matching = waivers
    .filter((w) => w.json["gate"] === gate && w.json["change"] === change)
    .sort((a, b) => (String(a.json["id"]) < String(b.json["id"]) ? -1 : 1));
  const ignored: IgnoredWaiver[] = [];
  for (const waiver of matching) {
    const status = waiverStatus(waiver.json, definition, ctx);
    if (status.counts) return { counting: waiver, ignored };
    ignored.push({ waiver, reason: status.reason });
  }
  return { counting: undefined, ignored };
}
