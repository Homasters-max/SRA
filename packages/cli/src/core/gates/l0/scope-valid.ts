/**
 * `scope-valid`: every path of the diff `base...commit` lies in the set the
 * transition allows (REQ-VER-004, ADR-0011, ADR-0021, D-15):
 *
 * - `SPECIFIED->APPROVED` (spec-PR): `openspec/changes/<change>/**` and the
 *   record `.warrant/changes/<change>.json`;
 * - `VERIFYING->MERGED` (impl-PR): anything but `openspec/specs/**`,
 *   `openspec/changes/archive/**`, records and evidence of other Changes, and —
 *   unless `factory-change` is among the profiles — the policy paths
 *   (`match.paths` of profile `factory-change`); the Change's own record and
 *   evidence are its own state and stay allowed;
 * - `MERGED->ARCHIVED` (archive-PR): its own archive directory
 *   `openspec/changes/archive/<date>-<change>/**`, `openspec/specs/**`, the
 *   removal of `openspec/changes/<change>/**`, its record and evidence.
 *
 * A rename counts as the removal of its source and the write of its target, so
 * the move made by `openspec archive` is judged path by path.
 */
import picomatch from "picomatch";

import type { DiffEntry } from "../../git/facts.js";
import { noInput, pass, type Calculator } from "./types.js";

export const FACTORY_PROFILE = "factory-change";

/** A path touched by the diff and how. */
interface Touch {
  path: string;
  op: "write" | "remove";
}

function touches(entries: readonly DiffEntry[]): Touch[] {
  const out: Touch[] = [];
  for (const entry of entries) {
    if (entry.status === "D") out.push({ path: entry.path, op: "remove" });
    else out.push({ path: entry.path, op: "write" });
    if (entry.status === "R" && entry.from !== undefined) out.push({ path: entry.from, op: "remove" });
  }
  return out;
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Records and evidence of one Change. */
function ownState(change: string): (p: string) => boolean {
  const record = `.warrant/changes/${change}.json`;
  const evidence = `.warrant/evidence/${change}/`;
  return (p) => p === record || p.startsWith(evidence);
}

/** Records and evidence of any Change. */
function anyState(p: string): boolean {
  return /^\.warrant\/changes\/[^/]+\.json$/.test(p) || /^\.warrant\/evidence\/[^/]+\//.test(p);
}

export interface ScopeInput {
  transition: string;
  change: string;
  profiles: readonly string[];
  policyPaths: readonly string[];
}

/**
 * The paths of `entries` the transition does not allow, sorted and unique;
 * null when the transition has no allowed set (the gate cannot be judged).
 */
export function scopeViolations(entries: readonly DiffEntry[], input: ScopeInput): string[] | null {
  const own = ownState(input.change);
  const changeDir = `openspec/changes/${input.change}/`;
  let allowed: (t: Touch) => boolean;

  switch (input.transition) {
    case "SPECIFIED->APPROVED":
      allowed = (t) => t.path.startsWith(changeDir) || t.path === `.warrant/changes/${input.change}.json`;
      break;
    case "VERIFYING->MERGED": {
      const policy =
        input.profiles.includes(FACTORY_PROFILE) || input.policyPaths.length === 0
          ? () => false
          : picomatch([...input.policyPaths], { dot: true });
      allowed = (t) => {
        if (own(t.path)) return true;
        if (t.path.startsWith("openspec/specs/") || t.path.startsWith("openspec/changes/archive/")) return false;
        if (anyState(t.path)) return false;
        return !policy(t.path);
      };
      break;
    }
    case "MERGED->ARCHIVED": {
      const archive = new RegExp(`^openspec/changes/archive/\\d{4}-\\d{2}-\\d{2}-${escapeRe(input.change)}/`);
      allowed = (t) =>
        archive.test(t.path) ||
        t.path.startsWith("openspec/specs/") ||
        (t.op === "remove" && t.path.startsWith(changeDir)) ||
        own(t.path);
      break;
    }
    default:
      return null;
  }

  const bad = new Set<string>();
  for (const touch of touches(entries)) if (!allowed(touch)) bad.add(touch.path);
  return [...bad].sort();
}

export const scopeValid: Calculator = (ctx) => {
  if (!ctx.signals.diff.ok) return noInput(ctx.gate, `diff unknown: ${ctx.signals.diff.reason}`);
  const violations = scopeViolations(ctx.signals.diff.value, {
    transition: ctx.transition,
    change: ctx.signals.change,
    profiles: ctx.signals.profiles,
    policyPaths: ctx.signals.policyPaths
  });
  if (violations === null) return noInput(ctx.gate, `no allowed path set is defined for ${ctx.transition}`);
  if (violations.length === 0) return pass();
  return {
    verdict: "FAIL",
    findings: [
      {
        code: "SCOPE_VIOLATION",
        gate: ctx.gate,
        paths: violations,
        message: `${ctx.transition} does not allow changes to: ${violations.join(", ")}`
      }
    ]
  };
};
