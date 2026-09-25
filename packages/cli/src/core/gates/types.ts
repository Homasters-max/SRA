/**
 * Shapes of the gate engine (design §8, 06 section 3, REQ-VER-003).
 *
 * The engine is a pure function over data already read: gate definitions,
 * evidence records, waivers and `signals` — facts about the project that the
 * command layer gathered (git, OpenSpec, ids). Nothing in `core/gates/`
 * besides `diff.ts` reads the disk or starts a process.
 */
import type { CliError } from "../errors.js";
import type { ArtifactStatuses } from "../ports/openspec.js";
import type { EffectivePolicy } from "../resolve/types.js";
import type { Availability, BlobTree, DiffEntry } from "../git/facts.js";
import type { WaiverInput } from "../waivers/read.js";

export type { Availability, BlobTree, DiffEntry } from "../git/facts.js";

/** Verdict axis of a gate (02 section 2); there is no INCONCLUSIVE verdict. */
export type Verdict = "PASS" | "FAIL" | "WAIVED" | "NOT_APPLICABLE" | "BLOCKED";

/** Worst first: the order `gate_verdict` of the controller takes the maximum in (REQ-VER-005). */
export const VERDICT_ORDER: readonly Verdict[] = ["FAIL", "BLOCKED", "WAIVED", "NOT_APPLICABLE", "PASS"];

/** Verdicts a forward transition passes with (REQ-VER-007). */
export const PASSING_VERDICTS: ReadonlySet<Verdict> = new Set<Verdict>(["PASS", "WAIVED", "NOT_APPLICABLE"]);

/** Worst verdicts no controller rule may answer with `CONTINUE` (R-13). */
export const NOT_CONTINUABLE_VERDICTS: ReadonlySet<unknown> = new Set(["FAIL", "BLOCKED"]);

/** The transition that asks for attested evidence by default (06a section 3, INV-10). */
export const MERGE_TRANSITION = "VERIFYING->MERGED";

/**
 * One entry of `data.findings[]`: why a record was set aside or why a gate got
 * its verdict. `code` names the reason; the optional fields name the gate,
 * record, waiver, check, paths or ids involved; `message` says it in words.
 */
export interface Finding {
  code: string;
  gate?: string;
  evidence?: string;
  kind?: string;
  reason?: string;
  waiver?: string;
  check?: string;
  error?: string;
  paths?: string[];
  items?: string[];
  /** Controller rule id (`CONTROLLER_RULE_IGNORED`, R-13). */
  rule?: string;
  message: string;
}

/** One stored evidence record. */
export interface EvidenceInput {
  id: string;
  json: Record<string, unknown>;
}

/** A failed check of `verify`: its gates are `BLOCKED` whatever the records say (REQ-VER-006). */
export interface CheckFailure {
  check: string;
  /** `errors[].code` of the failure: `CHECK_TIMEOUT`, `BUSY`, `CHECK_NOT_CONFIGURED`, … */
  code: string;
  /** Kinds the check produces. */
  kinds: string[];
}

/**
 * The contract of a Change on the approval commit and on the evaluated one
 * (`spec-approved`, phase-3b design §6, ADR-0024).
 */
export interface ContractTrees {
  /** Id of the `human-approval` record of the last `APPROVED` transition. */
  evidence: string;
  /** Its `subject.commit` and the contract there. */
  approved: { commit: string; tree: BlobTree };
  /** The evaluated commit and the contract there. */
  evaluated: { commit: string; tree: BlobTree };
}

/** Facts about the project the calculators and the pre-filter read (design §8). */
export interface GateSignals {
  change: string;
  /** UTC calendar date `YYYY-MM-DD` (I-75); a waiver is in force while `expires_at >= today`. */
  today: string;
  /** Commit the records must be on: HEAD, or `nogit` outside git. */
  commit: string;
  /** Current base commit; absent when unknown (then a record must not carry one either). */
  base?: string;
  /** Changed paths `base...commit`. */
  diff: Availability<DiffEntry[]>;
  /** The checked-out branch (`HEAD` when detached). */
  branch: Availability<string>;
  /** Artifact statuses of `openspec status --json`. */
  artifacts: Availability<ArtifactStatuses>;
  /** Findings of check (5) of `validate` without placement (`scanIds`, design §8). */
  ids: Availability<CliError[]>;
  /** `unknowns[]` of the record, as stored. */
  unknowns: unknown[];
  /** `classification.profiles` of the record. */
  profiles: string[];
  /** Policy paths: `match.paths` of profile `factory-change`, when a pack declares it (D-15). */
  policyPaths: string[];
  /** Effective thresholds by evidence kind; phase 3 has none (D-12). */
  thresholds?: Record<string, number>;
  /** Checks of this `verify` that failed (REQ-VER-006). */
  checkFailures?: CheckFailure[];
  /** Contract trees of `spec-approved`; gathered only when the evaluated gates include it. */
  contract?: Availability<ContractTrees>;
}

export interface GateEngineInput {
  policy: EffectivePolicy;
  transition: string;
  /** Gates to evaluate; default — every gate of the transition in the policy. */
  only?: string[];
  /** Gate documents by id, as loaded (override in force). */
  definitions: ReadonlyMap<string, Record<string, unknown>>;
  records: EvidenceInput[];
  waivers: WaiverInput[];
  /**
   * Logins of `roles` of `warrant.json`: a waiver whose `approved_by` is not
   * one of them waives nothing (R-2). Absent — not checked (pure unit input).
   */
  approvers?: ReadonlySet<string>;
  signals: GateSignals;
}

export interface GateEngineResult {
  /** Gate id → verdict, keys sorted. */
  gates: Record<string, Verdict>;
  findings: Finding[];
  /** Gate id → ids of the records its verdict rests on (for transition records, group 5). */
  evidence: Record<string, string[]>;
}
