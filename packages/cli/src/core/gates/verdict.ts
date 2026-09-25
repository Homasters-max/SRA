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
 *    freshest record is `NOT_APPLICABLE` from a check → `NOT_APPLICABLE`;
 *    `NOT_APPLICABLE` of any other producer is untrusted and counts as not
 *    proven (`NOT_APPLICABLE_UNTRUSTED`, R-9).
 * 2. No input (no git for `applies_when`, a failed check of `verify`, no
 *    admissible record of a required kind, a calculator without its input) →
 *    `BLOCKED` with `NO_INPUT` / `NO_EVIDENCE`; on `VERIFYING->MERGED` a kind
 *    with only unattested records → `BLOCKED` with `ATTESTATION_REQUIRED`.
 * 3. Every required kind's freshest record has the required status and the
 *    L0 calculator (if any) passes → `PASS`.
 * 4. A waiver of this gate and Change that counts (`waiverStatus`, design §1:
 *    `ACTIVE`, in force, approved by a login of `roles`, gate `waivable: true`,
 *    no `targets[]`) turns a `BLOCKED` or `FAIL` into `WAIVED` (`WAIVED_BY`);
 *    any other waiver of the gate is reported as `WAIVER_IGNORED` with the
 *    reason.
 * 5. Anything else → `FAIL`.
 *
 * Step 4 applies to `BLOCKED` as well as to `FAIL`: a waiver is how a gate
 * without a producer passes (SCN-VER-015, P-16).
 */
import { pathMatcher } from "../glob.js";
import { isPlainObject, strings } from "../json.js";
import { CALCULATORS, type L0Result } from "./l0/index.js";
import { prefilter } from "./prefilter.js";
import {
  MERGE_TRANSITION,
  VERDICT_ORDER,
  type EvidenceInput,
  type Finding,
  type GateEngineInput,
  type GateEngineResult,
  type Verdict
} from "./types.js";
import { waiverStatus, type WaiverContext, type WaiverIgnoredReason } from "../waivers/status.js";

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

const FINDING_KEYS = ["code", "gate", "evidence", "kind", "reason", "waiver", "check", "error", "paths", "items", "rule", "message"] as const;

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

function producerType(record: EvidenceInput): string {
  const producedBy = record.json["produced_by"];
  return isPlainObject(producedBy) && typeof producedBy["type"] === "string" ? producedBy["type"] : "(no producer)";
}

/** Whether the record was produced by a check (`produced_by.type: "check"`). */
function fromCheck(record: EvidenceInput): boolean {
  return producerType(record) === "check";
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
  if (chosen.length > 0 && chosen.every((c) => c.record.json["evidence_status"] === "NOT_APPLICABLE" && fromCheck(c.record))) {
    return { verdict: "NOT_APPLICABLE", findings: [], evidence };
  }
  for (const { requirement, record } of chosen) {
    const status = record.json["evidence_status"];
    if (status === "NOT_APPLICABLE" && !fromCheck(record)) {
      // Only a check establishes that the subject is absent (D-11); anybody
      // else's NOT_APPLICABLE is a claim nothing proved (R-9).
      findings.push({
        code: "NOT_APPLICABLE_UNTRUSTED",
        gate,
        evidence: record.id,
        kind: requirement.kind,
        message: `${record.id} is NOT_APPLICABLE from ${producerType(record)}, not from a check; it counts as not proven`
      });
      continue;
    }
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

  // A waiver that does not count waives nothing anywhere: not a gate (step 4),
  // not a kind of `evidence-complete`, not a record's `metrics.waivers`
  // (review of phase 3, R-2, R-8; design §1).
  const waiverCtx = waiverContext(input);
  const active = new Set<string>();
  for (const waiver of input.waivers) {
    const gate = waiver.json["gate"];
    const status = waiverStatus(waiver.json, typeof gate === "string" ? definitions.get(gate) : undefined, waiverCtx);
    if (status.counts && typeof waiver.json["id"] === "string") active.add(waiver.json["id"]);
  }
  const { admissible, excluded } = prefilter(input.records, {
    commit: signals.commit,
    base: signals.base,
    thresholds: signals.thresholds,
    activeWaivers: active
  });

  // STALE is reported for the kinds this evaluation reads, not for every old record;
  // `evidence-complete` reads records of any commit (I-96), so it adds none.
  const relevant = new Set<string>();
  for (const id of ids) {
    for (const requirement of requirementsOf(definitions.get(id))) relevant.add(requirement.kind);
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

/** What `waiverStatus` needs from the engine input. */
function waiverContext(input: GateEngineInput): WaiverContext {
  return { today: input.signals.today, approvers: input.approvers };
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
    const matches = pathMatcher(patterns);
    const hit = signals.diff.value.some((entry) => [entry.path, entry.from].some((p) => p !== undefined && matches(p)));
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
      records: input.records,
      waivers: input.waivers,
      waiverContext: waiverContext(input),
      definitions: input.definitions
    });
    outcome = {
      verdict: requirements.length > 0 ? worse(outcome.verdict, computed.verdict) : computed.verdict,
      findings: [...outcome.findings, ...computed.findings],
      evidence: outcome.evidence
    };
  }
  return outcome;
}

/** Why `waiverStatus` did not count a waiver, in words. */
const IGNORED_MESSAGE: Record<WaiverIgnoredReason, (waiver: Record<string, unknown>, gate: string) => string> = {
  state: (w) => `it is ${String(w["waiver_state"])}, not ACTIVE`,
  expired: (w) => `it expired on ${String(w["expires_at"])}`,
  approver: (w) => `approved_by ${JSON.stringify(w["approved_by"])} is not listed in roles of .warrant/warrant.json`,
  waivable: (_w, gate) => `gate ${gate} is not waivable`,
  // Partial waivers (targets[]) have no semantics before phase 5 (D-10).
  targets: () => "a waiver with targets[] does not waive the whole gate"
};

/** Step 4: a waiver of this gate and Change that counts (design §1). */
function applyWaivers(id: string, definition: Record<string, unknown>, base: GateOutcome, input: GateEngineInput): GateOutcome {
  const ctx = waiverContext(input);
  const matching = input.waivers
    .filter((w) => w.json["gate"] === id && w.json["change"] === input.signals.change)
    .sort((a, b) => (String(a.json["id"]) < String(b.json["id"]) ? -1 : 1));
  const findings = [...base.findings];
  for (const waiver of matching) {
    const waiverId = String(waiver.json["id"]);
    const status = waiverStatus(waiver.json, definition, ctx);
    if (!status.counts) {
      findings.push({
        code: "WAIVER_IGNORED",
        gate: id,
        waiver: waiverId,
        reason: status.reason,
        message: `${waiverId} is ignored: ${IGNORED_MESSAGE[status.reason](waiver.json, id)}`
      });
      continue;
    }
    findings.push({ code: "WAIVED_BY", gate: id, waiver: waiverId, message: `WAIVED_BY: ${waiverId}` });
    return { verdict: "WAIVED", findings, evidence: base.evidence };
  }
  return { verdict: base.verdict, findings, evidence: base.evidence };
}
