/** Shapes of the resolver (design D-6, 05 sections 3-6). */

/** The five risk dimensions, in the order 05 section 4 lists them. */
export const RISK_DIMENSIONS = [
  "data_loss",
  "reversibility",
  "blast_radius",
  "security_impact",
  "compatibility"
] as const;

export type RiskDimension = (typeof RISK_DIMENSIONS)[number];

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/** One dimension of `classification.risk`: a value and where it came from. */
export interface RiskEntry {
  value: string;
  from: string;
  /** URL of the approval of a value below the floor; only with `from: human:<login>` (REQ-KRN-028). */
  ref?: string;
}

/** `classification` of a change record, or the document passed to `--classification`. */
export interface Classification {
  profiles?: string[];
  risk?: Partial<Record<RiskDimension, RiskEntry>>;
  risk_level?: RiskLevel;
}

/** `warrant://risk-levels/1`, as far as the resolver reads it. */
export interface RiskLevelsDoc {
  /** Object id, used in the explain note; the file base name for this kind (I-9). */
  id: string;
  high?: { when_any?: Partial<Record<RiskDimension, string[]>> };
  low?: { when_all?: Partial<Record<RiskDimension, string[]>> };
  default?: RiskLevel;
}

/** The policy fields a profile or overlay contributes (`policy_body` of `warrant://common/1`). */
export interface PolicyBody {
  artifacts?: { required?: string[]; recommended?: string[]; forbidden?: string[] };
  gates?: Record<string, string[]>;
  capabilities?: { forbidden?: string[] };
  approvals?: { role: string; at: string }[];
  evidence?: { required?: string[] };
}

/** One layer taking part in the composition. */
export interface PolicyLayer {
  /** Entry written into `sources[]` (05 section 6). */
  source: string;
  /** Short origin shown in `explain[].from`, for example `profile/feature`. */
  label: string;
  body: PolicyBody;
}

/** The four layer groups of 05 section 5, applied in this order. */
export interface Layers {
  default: PolicyLayer[];
  project: PolicyLayer[];
  profiles: PolicyLayer[];
  risk: PolicyLayer[];
}

export const LAYER_ORDER = ["default", "project", "profiles", "risk"] as const;

export interface ExplainEntry {
  item: string;
  from: string;
}

export interface Approval {
  role: string;
  at: string;
}

/** The computed effective policy (REQ-KRN-026). Every key is always present. */
export interface EffectivePolicy {
  hash: string;
  sources: string[];
  risk_level: RiskLevel;
  artifacts: { required: string[]; recommended: string[]; forbidden: string[] };
  gates: Record<string, string[]>;
  capabilities: { forbidden: string[] };
  approvals: Approval[];
  evidence: { required: string[] };
  explain: ExplainEntry[];
}

/** One artifact that is both required and forbidden after the merge. */
export interface ArtifactClash {
  item: string;
  required_by: string[];
  forbidden_by: string[];
}

/**
 * A kind of `evidence.required` that no gate of the effective policy reads
 * (R-7): nothing would judge its freshness or attestation.
 */
export interface UngatedKind {
  code: "EVIDENCE_KIND_UNGATED";
  kind: string;
}

export type ConflictItem = ArtifactClash | UngatedKind;

export interface PolicyConflict {
  code: "POLICY_CONFLICT";
  message: string;
  items: ConflictItem[];
}
