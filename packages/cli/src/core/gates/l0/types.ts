/**
 * Calculators of L0 gates (design §8, REQ-VER-004): gates without
 * `requires_evidence` whose verdict the CLI computes from the state of the
 * project. Each calculator is a pure function of the context; an input it
 * needs and cannot have (no git, no `openspec`) gives `BLOCKED` with
 * `NO_INPUT` (P-7), and every `FAIL` names the paths or ids behind it.
 */
import type { EffectivePolicy } from "../../resolve/types.js";
import type { EvidenceInput, Finding, GateSignals, Verdict, WaiverInput } from "../types.js";
import type { WaiverContext } from "../waivers.js";

export interface L0Context {
  gate: string;
  transition: string;
  policy: EffectivePolicy;
  signals: GateSignals;
  /** Records that passed the pre-filter. */
  admissible: readonly EvidenceInput[];
  /** Every record of the Change, before the pre-filter (`evidence-complete`, I-96). */
  records: readonly EvidenceInput[];
  /** Waivers of the project, as read. */
  waivers: readonly WaiverInput[];
  /** What `waiverStatus` judges a waiver by: today and the logins of `roles`. */
  waiverContext: WaiverContext;
  /** Gate documents by id, as loaded. */
  definitions: ReadonlyMap<string, Record<string, unknown>>;
}

export interface L0Result {
  verdict: Verdict;
  findings: Finding[];
}

export type Calculator = (ctx: L0Context) => L0Result;

export function pass(): L0Result {
  return { verdict: "PASS", findings: [] };
}

export function noInput(gate: string, reason: string): L0Result {
  return { verdict: "BLOCKED", findings: [{ code: "NO_INPUT", gate, message: reason }] };
}
