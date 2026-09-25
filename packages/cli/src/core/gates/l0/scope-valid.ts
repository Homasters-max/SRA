/**
 * `scope-valid`: every path of the diff `base...commit` lies in the set the
 * transition allows (REQ-VER-004, ADR-0011, ADR-0021, D-15). The own state of
 * the Change — record, evidence, Run files and their envelopes
 * (`core/run/state.ts`, N27) — is allowed on each of the three transitions and
 * is never a policy path; the state of other Changes is allowed on none.
 * Beyond the own state:
 *
 * - `SPECIFIED->APPROVED` (spec-PR): `openspec/changes/<change>/**`;
 * - `VERIFYING->MERGED` (impl-PR): anything but `openspec/specs/**`,
 *   `openspec/changes/archive/**` and — unless `factory-change` is among the
 *   profiles — the policy paths (`match.paths` of profile `factory-change`);
 * - `MERGED->ARCHIVED` (archive-PR): its own archive directory
 *   `openspec/changes/archive/<date>-<change>/**`, `openspec/specs/**` and the
 *   removal of `openspec/changes/<change>/**`.
 *
 * A rename counts as the removal of its source and the write of its target, so
 * the move made by `openspec archive` is judged path by path.
 */
import type { DiffEntry } from "../../git/facts.js";
import { pathMatcher } from "../../glob.js";
import { FACTORY_PROFILE } from "../../packs/objects.js";
import type { StateMatchers } from "../types.js";
import { noInput, pass, type Calculator } from "./types.js";

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

export interface ScopeInput {
  transition: string;
  change: string;
  profiles: readonly string[];
  policyPaths: readonly string[];
  /** Own state of the Change and state of any Change (`GateSignals.state`). */
  state: StateMatchers;
}

/**
 * The paths of `entries` the transition does not allow, sorted and unique;
 * null when the transition has no allowed set (the gate cannot be judged).
 */
export function scopeViolations(entries: readonly DiffEntry[], input: ScopeInput): string[] | null {
  const { own, other } = input.state;
  const changeDir = `openspec/changes/${input.change}/`;
  let allowed: (t: Touch) => boolean;

  switch (input.transition) {
    case "SPECIFIED->APPROVED":
      allowed = (t) => own(t.path) || t.path.startsWith(changeDir);
      break;
    case "VERIFYING->MERGED": {
      const policy =
        input.profiles.includes(FACTORY_PROFILE) || input.policyPaths.length === 0
          ? () => false
          : pathMatcher(input.policyPaths);
      allowed = (t) => {
        if (own(t.path)) return true;
        if (t.path.startsWith("openspec/specs/") || t.path.startsWith("openspec/changes/archive/")) return false;
        if (other(t.path)) return false;
        return !policy(t.path);
      };
      break;
    }
    case "MERGED->ARCHIVED": {
      const archive = new RegExp(`^openspec/changes/archive/\\d{4}-\\d{2}-\\d{2}-${escapeRe(input.change)}/`);
      allowed = (t) =>
        own(t.path) ||
        archive.test(t.path) ||
        t.path.startsWith("openspec/specs/") ||
        (t.op === "remove" && t.path.startsWith(changeDir));
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
    policyPaths: ctx.signals.policyPaths,
    state: ctx.signals.state
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
