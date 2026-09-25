/**
 * Inputs of the controller (04 section 4, REQ-VER-005, design §11), computed
 * from the gate verdicts, the record and the effective policy. Pure.
 *
 * `BLOCKED` gates fall into exactly one of three counts, in this order: a gate
 * waiting for a human approval (`pending_approvals`), a gate on
 * `VERIFYING->MERGED` that local evidence cannot close (`gates_awaiting_attestation`),
 * and everything else (`unevaluated_gates`).
 */
import { HUMAN_APPROVAL } from "../evidence/approval.js";
import { openBlockingUnknowns } from "../gates/l0/blocking-unknowns-resolved.js";
import { missingArtifacts } from "../gates/l0/required-artifacts-present.js";
import { requirementsOf, worstVerdict } from "../gates/verdict.js";
import { MERGE_TRANSITION, type Availability, type Finding, type Verdict } from "../gates/types.js";
import type { ArtifactStatuses } from "../ports/openspec.js";
import type { EffectivePolicy } from "../resolve/types.js";

export interface ControllerInputs {
  policy_conflict: boolean;
  /** Worst verdict of the transition; null when it has no gates. */
  gate_verdict: Verdict | null;
  /** Whether every gate with the worst verdict is waivable; null when there are no gates. */
  gate_waivable: boolean | null;
  blocking_unknowns: number;
  pending_approvals: number;
  gates_awaiting_attestation: number;
  unevaluated_gates: number;
  missing_required_artifacts: number;
}

export interface InputsSource {
  transition: string;
  gates: Record<string, Verdict>;
  findings: readonly Finding[];
  definitions: ReadonlyMap<string, Record<string, unknown>>;
  unknowns: readonly unknown[];
  policy: EffectivePolicy;
  artifacts: Availability<ArtifactStatuses>;
}

/** Inputs when the policy could not be composed: only the conflict is known. */
export function conflictInputs(unknowns: readonly unknown[]): ControllerInputs {
  return {
    policy_conflict: true,
    gate_verdict: null,
    gate_waivable: null,
    blocking_unknowns: openBlockingUnknowns(unknowns).length,
    pending_approvals: 0,
    gates_awaiting_attestation: 0,
    unevaluated_gates: 0,
    missing_required_artifacts: 0
  };
}

function acceptsNone(definition: Record<string, unknown> | undefined): boolean {
  const declared = definition?.["accepts_attestation"];
  return Array.isArray(declared) && declared.includes("none");
}

export function controllerInputs(source: InputsSource): ControllerInputs {
  const ids = Object.keys(source.gates);
  const worst = worstVerdict(ids.map((id) => source.gates[id] as Verdict));
  const worstGates = ids.filter((id) => source.gates[id] === worst);
  const gateWaivable = worst === null ? null : worstGates.every((id) => source.definitions.get(id)?.["waivable"] === true);

  const attestationFindings = new Set(
    source.findings.filter((f) => f.code === "ATTESTATION_REQUIRED" && f.gate !== undefined).map((f) => f.gate as string)
  );

  let pending = 0;
  let awaiting = 0;
  let unevaluated = 0;
  for (const id of ids) {
    if (source.gates[id] !== "BLOCKED") continue;
    const definition = source.definitions.get(id);
    const requirements = requirementsOf(definition);
    if (requirements.some((r) => r.kind === HUMAN_APPROVAL)) {
      pending += 1;
    } else if (
      attestationFindings.has(id) ||
      (source.transition === MERGE_TRANSITION && requirements.length > 0 && !acceptsNone(definition))
    ) {
      awaiting += 1;
    } else {
      unevaluated += 1;
    }
  }

  return {
    policy_conflict: false,
    gate_verdict: worst,
    gate_waivable: gateWaivable,
    blocking_unknowns: openBlockingUnknowns(source.unknowns).length,
    pending_approvals: pending,
    gates_awaiting_attestation: awaiting,
    unevaluated_gates: unevaluated,
    missing_required_artifacts: source.artifacts.ok ? missingArtifacts(source.policy.artifacts.required, source.artifacts.value).length : 0
  };
}
