/**
 * The resolver proper (design D-6, 05 section 5): a pure function from layers
 * to an effective policy, or to a `POLICY_CONFLICT`.
 *
 * Every field merges as a set union; `recommended` loses whatever became
 * `required`; `approvals` unify on the pair `(role, at)`. There is no
 * "last one wins" branch, and no layer can remove anything, so the result does
 * not depend on the order of layers inside a group. Output arrays are sorted
 * for exactly that reason: the `hash` must depend on the content only.
 *
 * Two outcomes are conflicts rather than policies (fail closed, the controller
 * escalates): an artifact both required and forbidden, and — when the gate
 * documents are known — a kind of `evidence.required` that no gate of any
 * transition lists in `requires_evidence` (`EVIDENCE_KIND_UNGATED`, R-7).
 */
import { canonicalHash } from "../canon/hash.js";
import { strings } from "../json.js";
import {
  LAYER_ORDER,
  type Approval,
  type ArtifactClash,
  type EffectivePolicy,
  type ExplainEntry,
  type Layers,
  type PolicyConflict,
  type PolicyLayer,
  type RiskLevel,
  type UngatedKind
} from "./types.js";

export interface ResolveInput {
  layers: Layers;
  sources: string[];
  riskLevel: RiskLevel;
  /** Note recorded as `explain[].from` of the `risk_level:<L>` entry. */
  riskLevelFrom: string;
  /**
   * Kinds of `requires_evidence` by gate id, as loaded (overrides in force).
   * Absent — the gate documents are unknown and `EVIDENCE_KIND_UNGATED` is not
   * checked (pure unit input).
   */
  gateKinds?: ReadonlyMap<string, readonly string[]>;
}

export type ResolveResult =
  | { ok: true; policy: EffectivePolicy }
  | { ok: false; conflict: PolicyConflict };

function sortStrings(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Contributions of one item, kept in layer application order for `explain[]`. */
class Contributions {
  private readonly byItem = new Map<string, string[]>();

  add(item: string, label: string): void {
    const existing = this.byItem.get(item);
    if (existing === undefined) {
      this.byItem.set(item, [label]);
      // Duplicate (item, layer) pairs are collapsed: a layer contributes an item once.
    } else if (!existing.includes(label)) {
      existing.push(label);
    }
  }

  items(): string[] {
    return sortStrings(this.byItem.keys());
  }

  has(item: string): boolean {
    return this.byItem.has(item);
  }

  from(item: string): string[] {
    return this.byItem.get(item) ?? [];
  }
}

function applyLayer(
  layer: PolicyLayer,
  required: Contributions,
  recommended: Contributions,
  forbidden: Contributions,
  capabilities: Contributions,
  evidence: Contributions,
  approvals: Contributions,
  gates: Map<string, Contributions>
): void {
  const body = layer.body;
  for (const item of strings(body.artifacts?.required)) required.add(item, layer.label);
  for (const item of strings(body.artifacts?.recommended)) recommended.add(item, layer.label);
  for (const item of strings(body.artifacts?.forbidden)) forbidden.add(item, layer.label);
  for (const item of strings(body.capabilities?.forbidden)) capabilities.add(item, layer.label);
  for (const item of strings(body.evidence?.required)) evidence.add(item, layer.label);

  for (const approval of body.approvals ?? []) {
    if (typeof approval?.role !== "string" || typeof approval?.at !== "string") continue;
    approvals.add(`${approval.role}@${approval.at}`, layer.label);
  }

  for (const [transition, list] of Object.entries(body.gates ?? {})) {
    if (transition === "$comment") continue;
    let bucket = gates.get(transition);
    if (bucket === undefined) {
      bucket = new Contributions();
      gates.set(transition, bucket);
    }
    for (const gate of strings(list)) bucket.add(gate, layer.label);
  }
}

/** Kinds of `evidence.required` that no gate of any transition reads (R-7). */
function ungatedKinds(
  kinds: readonly string[],
  gates: ReadonlyMap<string, Contributions>,
  gateKinds: ReadonlyMap<string, readonly string[]> | undefined
): UngatedKind[] {
  if (gateKinds === undefined) return [];
  const read = new Set<string>();
  for (const bucket of gates.values()) {
    for (const gate of bucket.items()) for (const kind of gateKinds.get(gate) ?? []) read.add(kind);
  }
  return kinds.filter((kind) => !read.has(kind)).map((kind) => ({ code: "EVIDENCE_KIND_UNGATED", kind }));
}

export function resolve(input: ResolveInput): ResolveResult {
  const required = new Contributions();
  const recommended = new Contributions();
  const forbidden = new Contributions();
  const capabilities = new Contributions();
  const evidence = new Contributions();
  const approvals = new Contributions();
  const gates = new Map<string, Contributions>();

  for (const group of LAYER_ORDER) {
    for (const layer of input.layers[group]) {
      applyLayer(layer, required, recommended, forbidden, capabilities, evidence, approvals, gates);
    }
  }

  // `forbidden` is absolute, so a clash with `required` is not resolvable here:
  // fail closed and let the controller escalate (05 section 5, SCN-KRN-067).
  const clashes: ArtifactClash[] = required
    .items()
    .filter((item) => forbidden.has(item))
    .map((item) => ({ item, required_by: required.from(item), forbidden_by: forbidden.from(item) }));

  // A required kind no gate reads would never be judged for freshness or attestation (R-7).
  const ungated = ungatedKinds(evidence.items(), gates, input.gateKinds);
  if (clashes.length > 0 || ungated.length > 0) {
    const message = [
      ...clashes.map(
        (c) => `artifact "${c.item}" is required by ${c.required_by.join(", ")} and forbidden by ${c.forbidden_by.join(", ")}`
      ),
      ...ungated.map(
        (u) =>
          `evidence kind "${u.kind}" is required by ${evidence.from(u.kind).join(", ")}, but no gate of the policy requires it (EVIDENCE_KIND_UNGATED)`
      )
    ].join("; ");
    return { ok: false, conflict: { code: "POLICY_CONFLICT", message, items: [...clashes, ...ungated] } };
  }

  const requiredList = required.items();
  const requiredSet = new Set(requiredList);
  // 05 section 5: an artifact that became `required` is no longer merely recommended.
  const recommendedList = recommended.items().filter((item) => !requiredSet.has(item));
  const forbiddenList = forbidden.items();
  const capabilityList = capabilities.items();
  const evidenceList = evidence.items();
  const approvalKeys = approvals.items();

  const gateTransitions = sortStrings(gates.keys());
  const gatesOut: Record<string, string[]> = {};
  for (const transition of gateTransitions) {
    gatesOut[transition] = (gates.get(transition) as Contributions).items();
  }

  const approvalList: Approval[] = approvalKeys.map((key) => {
    const at = key.slice(key.indexOf("@") + 1);
    return { role: key.slice(0, key.indexOf("@")), at };
  });

  const explain: ExplainEntry[] = [{ item: `risk_level:${input.riskLevel}`, from: input.riskLevelFrom }];
  const push = (prefix: string, list: string[], source: Contributions): void => {
    for (const item of list) for (const from of source.from(item)) explain.push({ item: `${prefix}${item}`, from });
  };
  push("artifact.required:", requiredList, required);
  push("artifact.recommended:", recommendedList, recommended);
  push("artifact.forbidden:", forbiddenList, forbidden);
  for (const transition of gateTransitions) {
    const bucket = gates.get(transition) as Contributions;
    push("gate:", bucket.items(), bucket);
  }
  push("capability.forbidden:", capabilityList, capabilities);
  push("approval:", approvalKeys, approvals);
  push("evidence:", evidenceList, evidence);

  // `hash` covers the policy content only: `explain` and `sources` describe
  // where it came from, not what it requires (design D-6).
  const content = {
    risk_level: input.riskLevel,
    artifacts: { required: requiredList, recommended: recommendedList, forbidden: forbiddenList },
    gates: gatesOut,
    capabilities: { forbidden: capabilityList },
    approvals: approvalList,
    evidence: { required: evidenceList }
  };

  return {
    ok: true,
    policy: {
      hash: canonicalHash(content),
      sources: input.sources,
      ...content,
      explain
    }
  };
}
