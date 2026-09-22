/**
 * The verdict algorithm of 06 section 3 as one pure function (design §8,
 * REQ-VER-003, REQ-VER-004):
 *
 *   `evaluateGates({ policy, transition, definitions, records, waivers, signals })`
 *
 * 0. Pre-filter (D-12): records of another commit or base, of another
 *    threshold, narrowed (`scoped:`) or resting on a waiver no longer in force
 *    are set aside with `STALE`.
 * 1. `applies_when.changed_paths` misses the diff, or every required kind's
 *    freshest record is `NOT_APPLICABLE` from a check → `NOT_APPLICABLE`.
 * 2. No input (no git for `applies_when`, a failed check of `verify`, no
 *    admissible record of a required kind, a calculator without its input) →
 *    `BLOCKED` with `NO_INPUT` / `NO_EVIDENCE`; on `VERIFYING->MERGED` a kind
 *    with only unattested records → `BLOCKED` with `ATTESTATION_REQUIRED`.
 * 3. Every required kind's freshest record has the required status and the
 *    L0 calculator (if any) passes → `PASS`.
 * 4. An `ACTIVE` waiver in force for this gate and Change turns a `BLOCKED` or
 *    `FAIL` into `WAIVED` (`WAIVED_BY`) when the gate is `waivable: true`;
 *    otherwise the waiver is reported as `WAIVER_IGNORED`.
 * 5. Anything else → `FAIL`.
 *
 * Step 4 applies to `BLOCKED` as well as to `FAIL`: a waiver is how a gate
 * without a producer passes (SCN-VER-015, P-16).
 */
import picomatch from "picomatch";

import { CALCULATORS, type L0Result } from "./l0/index.js";
import { activeWaiverIds, isWaiverInForce, prefilter } from "./prefilter.js";
import {
  MERGE_TRANSITION,
  VERDICT_ORDER,
  type EvidenceInput,
  type Finding,
  type GateEngineInput,
  type GateEngineResult,
  type Verdict
} from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** The worse of two verdicts in the order `FAIL` > `BLOCKED` > `WAIVED` > `NOT_APPLICABLE` > `PASS`. */
export function worse(a: Verdict, b: Verdict): Verdict {
  return VERDICT_ORDER.indexOf(a) <= VERDICT_ORDER.indexOf(b) ? a : b;
}

/** The worst verdict of a list; null for an empty list. */
export function worstVerdict(verdicts: Iterable<Verdict>): Verdict | null {
  let worst: Verdict | null = null;
  for (const verdict of verdicts) worst = worst === null ? verdict : worse(worst, verdict);
  return worst;
}

export interface Requirement {
  kind: string;
  status: string;
}

/** `requires_evidence` of a gate document. */
export function requirementsOf(gate: Record<string, unknown> | undefined): Requirement[] {
  const list = gate?.["requires_evidence"];
  if (!Array.isArray(list)) return [];
  return list
    .filter(isPlainObject)
    .filter((r) => typeof r["kind"] === "string" && typeof r["status"] === "string")
    .map((r) => ({ kind: r["kind"] as string, status: r["status"] as string }));
}

/**
 * Whether the gate counts a record's attestation on this transition (design §7,
 * 06a section 3): only `VERIFYING->MERGED` is judged; there `accepts_attestation`
 * decides when the gate declares it, else anything but `none`.
 */
export function attestationAccepted(gate: Record<string, unknown> | undefined, transition: string): (record: EvidenceInput) => boolean {
  if (transition !== MERGE_TRANSITION) return () => true;
  const declared = Array.isArray(gate?.["accepts_attestation"]) ? strings(gate?.["accepts_attestation"]) : undefined;
  return (record) => {
    const attestation = record.json["attestation"];
    const type = isPlainObject(attestation) && typeof attestation["type"] === "string" ? attestation["type"] : "none";
    return declared === undefined ? type !== "none" : declared.includes(type);
  };
}

function createdAt(record: EvidenceInput): number {
  const value = record.json["created_at"];
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** The freshest record by `created_at`; the id (a ULID) breaks ties. */
export function freshest(records: readonly EvidenceInput[]): EvidenceInput | undefined {
  let best: EvidenceInput | undefined;
  for (const record of records) {
    if (best === undefined) {
      best = record;
      continue;
    }
    const a = createdAt(record);
    const b = createdAt(best);
    if (a > b || (a === b && record.id > best.id)) best = record;
  }
  return best;
}

const FINDING_KEYS = ["code", "gate", "evidence", "kind", "reason", "waiver", "check", "error", "paths", "items", "message"] as const;

/** A finding with its keys in one fixed order, so output and snapshots are stable. */
function ordered(finding: Finding): Finding {
  const out: Record<string, unknown> = {};
  for (const key of FINDING_KEYS) if (finding[key] !== undefined) out[key] = finding[key];
  return out as unknown as Finding;
}

interface GateOutcome {
  verdict: Verdict;
  findings: Finding[];
  evidence: string[];
}

function evidencePart(
  gate: string,
  requirements: readonly Requirement[],
  admissible: readonly EvidenceInput[],
  accepts: (record: EvidenceInput) => boolean
): GateOutcome {
  const findings: Finding[] = [];
  const chosen: { requirement: Requirement; record: EvidenceInput }[] = [];
  let missing = false;
  for (const requirement of requirements) {
    const candidates = admissible.filter((r) => r.json["kind"] === requirement.kind);
    const accepted = candidates.filter(accepts);
    const record = freshest(accepted);
    if (record !== undefined) {
      chosen.push({ requirement, record });
      continue;
    }
    missing = true;
    if (candidates.length > 0) {
      findings.push({
        code: "ATTESTATION_REQUIRED",
        gate,
        kind: requirement.kind,
        items: candidates.map((r) => r.id).sort(),
        message: `${requirement.kind}: only records with an attestation this gate does not accept on ${MERGE_TRANSITION}; records from CI are needed`
      });
    } else {
      findings.push({
        code: "NO_EVIDENCE",
        gate,
        kind: requirement.kind,
        message: `no admissible ${requirement.kind} record; run the check that produces it`
      });
    }
  }
  const evidence = chosen.map((c) => c.record.id);
  if (missing) return { verdict: "BLOCKED", findings, evidence };
  if (chosen.length > 0 && chosen.every((c) => c.record.json["evidence_status"] === "NOT_APPLICABLE")) {
    return { verdict: "NOT_APPLICABLE", findings: [], evidence };
  }
  for (const { requirement, record } of chosen) {
    const status = record.json["evidence_status"];
    if (status === requirement.status) continue;
    findings.push({
      code: "EVIDENCE_STATUS",
      gate,
      evidence: record.id,
      kind: requirement.kind,
      message: `${record.id} is ${String(status)}, the gate requires ${requirement.status}`
    });
  }
  return { verdict: findings.length === 0 ? "PASS" : "FAIL", findings, evidence };
}

export function evaluateGates(input: GateEngineInput): GateEngineResult {
  const { policy, transition, signals, definitions } = input;
  const inPolicy = [...new Set(policy.gates[transition] ?? [])];
  const ids = (input.only === undefined ? inPolicy : inPolicy.filter((id) => input.only?.includes(id))).sort();

  const active = activeWaiverIds(input.waivers, signals.today);
  const { admissible, excluded } = prefilter(input.records, {
    commit: signals.commit,
    base: signals.base,
    thresholds: signals.thresholds,
    activeWaivers: active
  });

  // STALE is reported for the kinds this evaluation reads, not for every old record.
  const relevant = new Set<string>();
  for (const id of ids) {
    for (const requirement of requirementsOf(definitions.get(id))) relevant.add(requirement.kind);
    if (id === "evidence-complete") for (const kind of policy.evidence.required) relevant.add(kind);
  }
  const findings: Finding[] = excluded
    .filter((e) => relevant.has(String(e.record.json["kind"])))
    .sort((a, b) => (a.record.id < b.record.id ? -1 : 1))
    .map((e) => e.finding);

  const gates: Record<string, Verdict> = {};
  const evidence: Record<string, string[]> = {};
  for (const id of ids) {
    const outcome = evaluateOne(id, input, admissible);
    gates[id] = outcome.verdict;
    evidence[id] = outcome.evidence;
    findings.push(...outcome.findings);
  }
  return { gates, findings: findings.map(ordered), evidence };
}

function evaluateOne(id: string, input: GateEngineInput, admissible: readonly EvidenceInput[]): GateOutcome {
  const definition = input.definitions.get(id);
  if (definition === undefined) {
    return {
      verdict: "BLOCKED",
      findings: [{ code: "NO_INPUT", gate: id, message: `gate ${id} is not declared by any enabled pack or by .warrant/local/` }],
      evidence: []
    };
  }

  const base = baseOutcome(id, definition, input, admissible);
  if (base.verdict !== "BLOCKED" && base.verdict !== "FAIL") return base;
  return applyWaivers(id, definition, base, input);
}

/** Steps 1–3 and 5: the verdict before waivers. */
function baseOutcome(
  id: string,
  definition: Record<string, unknown>,
  input: GateEngineInput,
  admissible: readonly EvidenceInput[]
): GateOutcome {
  const { transition, signals } = input;

  // Step 1: applies_when over the diff.
  const appliesWhen = isPlainObject(definition["applies_when"]) ? definition["applies_when"] : undefined;
  const patterns = strings(appliesWhen?.["changed_paths"]);
  if (appliesWhen !== undefined && patterns.length > 0) {
    if (!signals.diff.ok) {
      return {
        verdict: "BLOCKED",
        findings: [{ code: "NO_INPUT", gate: id, message: `applies_when needs the diff: ${signals.diff.reason}` }],
        evidence: []
      };
    }
    const matchers = patterns.map((p) => globToMatcher(p));
    const hit = signals.diff.value.some((entry) =>
      [entry.path, entry.from].some((p) => p !== undefined && matchers.some((m) => m(p)))
    );
    if (!hit) return { verdict: "NOT_APPLICABLE", findings: [], evidence: [] };
  }

  const requirements = requirementsOf(definition);
  const calculator = CALCULATORS.get(id);
  if (requirements.length === 0 && calculator === undefined) {
    return {
      verdict: "BLOCKED",
      findings: [
        {
          code: "NO_INPUT",
          gate: id,
          message: `gate ${id} has no requires_evidence and this CLI has no calculator for it`
        }
      ],
      evidence: []
    };
  }

  // Step 2: a failed check of this `verify` leaves its gates without input.
  const kinds = new Set(requirements.map((r) => r.kind));
  const failed = (signals.checkFailures ?? []).filter((f) => f.kinds.some((k) => kinds.has(k)));
  if (failed.length > 0) {
    return {
      verdict: "BLOCKED",
      findings: failed.map((f) => ({
        code: "NO_INPUT",
        gate: id,
        check: f.check,
        error: f.code,
        message: `check ${f.check} failed with ${f.code}`
      })),
      evidence: []
    };
  }

  const accepts = attestationAccepted(definition, transition);
  let outcome: GateOutcome = { verdict: "PASS", findings: [], evidence: [] };
  if (requirements.length > 0) {
    outcome = evidencePart(id, requirements, admissible, accepts);
    if (outcome.verdict === "NOT_APPLICABLE" && calculator === undefined) return outcome;
  }
  if (calculator !== undefined) {
    const computed: L0Result = calculator({
      gate: id,
      transition,
      policy: input.policy,
      signals,
      admissible,
      accepts
    });
    outcome = {
      verdict: requirements.length > 0 ? worse(outcome.verdict, computed.verdict) : computed.verdict,
      findings: [...outcome.findings, ...computed.findings],
      evidence: outcome.evidence
    };
  }
  return outcome;
}

/** Step 4: a waiver in force for this gate and Change. */
function applyWaivers(id: string, definition: Record<string, unknown>, base: GateOutcome, input: GateEngineInput): GateOutcome {
  const { signals } = input;
  const matching = input.waivers
    .filter((w) => w.json["gate"] === id && w.json["change"] === signals.change)
    .sort((a, b) => (String(a.json["id"]) < String(b.json["id"]) ? -1 : 1));
  const findings = [...base.findings];
  for (const waiver of matching) {
    const waiverId = String(waiver.json["id"]);
    if (!isWaiverInForce(waiver.json, signals.today)) {
      if (waiver.json["waiver_state"] === "ACTIVE") {
        findings.push({
          code: "WAIVER_IGNORED",
          gate: id,
          waiver: waiverId,
          reason: "expired",
          message: `${waiverId} expired on ${String(waiver.json["expires_at"])}`
        });
      }
      continue;
    }
    if (definition["waivable"] !== true) {
      findings.push({
        code: "WAIVER_IGNORED",
        gate: id,
        waiver: waiverId,
        reason: "not-waivable",
        message: `${waiverId} is ignored: gate ${id} is not waivable`
      });
      continue;
    }
    const targets = waiver.json["targets"];
    if (Array.isArray(targets) && targets.length > 0) {
      // Partial waivers (targets[]) have no semantics before phase-3b: they never waive the whole gate.
      findings.push({
        code: "WAIVER_IGNORED",
        gate: id,
        waiver: waiverId,
        reason: "targets",
        message: `${waiverId} is ignored: a waiver with targets[] does not waive the whole gate`
      });
      continue;
    }
    findings.push({ code: "WAIVED_BY", gate: id, waiver: waiverId, message: `WAIVED_BY: ${waiverId}` });
    return { verdict: "WAIVED", findings, evidence: base.evidence };
  }
  return { verdict: base.verdict, findings, evidence: base.evidence };
}

function globToMatcher(pattern: string): (p: string) => boolean {
  return picomatch(pattern, { dot: true });
}
