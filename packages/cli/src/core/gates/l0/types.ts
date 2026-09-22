/**
 * Calculators of L0 gates (design §8, REQ-VER-004): gates without
 * `requires_evidence` whose verdict the CLI computes from the state of the
 * project. Each calculator is a pure function of the context; an input it
 * needs and cannot have (no git, no `openspec`) gives `BLOCKED` with
 * `NO_INPUT` (P-7), and every `FAIL` names the paths or ids behind it.
 */
import type { EffectivePolicy } from "../../resolve/types.js";
import type { EvidenceInput, Finding, GateSignals, Verdict } from "../types.js";

export interface L0Context {
  gate: string;
  transition: string;
  policy: EffectivePolicy;
  signals: GateSignals;
  /** Records that passed the pre-filter. */
  admissible: readonly EvidenceInput[];
  /** Whether this gate accepts the attestation of a record on this transition (06a section 3). */
  accepts: (record: EvidenceInput) => boolean;
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
