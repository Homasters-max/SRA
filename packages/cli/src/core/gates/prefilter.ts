/**
 * Admissibility pre-filter of evidence (D-12, 06 section 3, REQ-VER-003).
 *
 * Before any verdict a record is set aside, with a `STALE` finding, when it
 * does not speak of what is evaluated now: another commit, another base,
 * another threshold, a run narrowed to some paths (`scoped:`, ADR-0017), or a
 * partial waiver it applied that is no longer in force. What is left is the
 * only evidence the verdict algorithm sees.
 */
import { isPlainObject } from "../json.js";
import type { EvidenceInput, Finding } from "./types.js";

export type StaleReason = "commit" | "base" | "threshold" | "scoped" | "waiver";

export interface PrefilterContext {
  /** Commit under evaluation (HEAD, or the commit of `MERGED`). */
  commit: string;
  /** Current base commit; undefined when unknown. */
  base?: string | undefined;
  /** Effective threshold by evidence kind; a kind without one is not compared. */
  thresholds?: Record<string, number> | undefined;
  /** Ids of the waivers that count (`countingWaiverIds` of `core/waivers/status.ts`). */
  activeWaivers: ReadonlySet<string>;
}

/** One record set aside, with the finding that says why. */
export interface Excluded {
  record: EvidenceInput;
  finding: Finding;
}

export interface PrefilterResult {
  admissible: EvidenceInput[];
  excluded: Excluded[];
}

/** The first reason the record is not admissible, or null. */
export function staleReason(record: Record<string, unknown>, ctx: PrefilterContext): { reason: StaleReason; detail: string } | null {
  const subject = isPlainObject(record["subject"]) ? record["subject"] : {};
  const commit = subject["commit"];
  if (commit !== ctx.commit) {
    return { reason: "commit", detail: `made on commit ${String(commit)}, evaluated commit is ${ctx.commit}` };
  }
  const base = typeof subject["base_commit"] === "string" ? subject["base_commit"] : undefined;
  if (base !== ctx.base) {
    return { reason: "base", detail: `made against base ${base ?? "(none)"}, current base is ${ctx.base ?? "(unknown)"}` };
  }
  const metrics = isPlainObject(record["metrics"]) ? record["metrics"] : {};
  const kind = typeof record["kind"] === "string" ? record["kind"] : "";
  const expected = ctx.thresholds?.[kind];
  if (expected !== undefined && metrics["threshold"] !== expected) {
    return {
      reason: "threshold",
      detail: `made with threshold ${JSON.stringify(metrics["threshold"] ?? null)}, the effective one is ${expected}`
    };
  }
  const limitations = Array.isArray(record["limitations"]) ? record["limitations"] : [];
  const scoped = limitations.find((l): l is string => typeof l === "string" && l.startsWith("scoped:"));
  if (scoped !== undefined) return { reason: "scoped", detail: `a narrowed run (${scoped})` };
  const waivers = Array.isArray(metrics["waivers"]) ? metrics["waivers"] : [];
  for (const id of waivers) {
    if (typeof id !== "string" || !ctx.activeWaivers.has(id)) {
      return { reason: "waiver", detail: `applied waiver ${String(id)}, which is not ACTIVE` };
    }
  }
  return null;
}

/** Splits the records into admissible ones and excluded ones with a `STALE` finding each. */
export function prefilter(records: readonly EvidenceInput[], ctx: PrefilterContext): PrefilterResult {
  const admissible: EvidenceInput[] = [];
  const excluded: Excluded[] = [];
  for (const record of records) {
    const stale = staleReason(record.json, ctx);
    if (stale === null) {
      admissible.push(record);
      continue;
    }
    const finding: Finding = { code: "STALE", evidence: record.id, reason: stale.reason, message: `${record.id}: ${stale.detail}` };
    if (typeof record.json["kind"] === "string") finding.kind = record.json["kind"];
    excluded.push({ record, finding });
  }
  return { admissible, excluded };
}
