/**
 * The gate engine and the controller over one Change and transition (REQ-VER-003,
 * REQ-VER-004, REQ-VER-005): signals from the facts, the verdicts, the
 * decision, and the fields `gate`, `verify`, `archive`, `transition` and
 * `status` print from them.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { writeJsonFile } from "../canon/format-json.js";
import { controllerInputs } from "../controller/inputs.js";
import type { WarrantConfig } from "../config.js";
import { controllerRules, evaluateController, type ControllerDecision } from "../controller/evaluate.js";
import type { Ctx } from "../ctx.js";
import { evidenceDir, MANIFEST_FILE, projectUri, readManifest, readRecords, type PendingRecord } from "../evidence/store.js";
import type { Availability, DiffEntry } from "../git/facts.js";
import { FACTORY_PROFILE } from "../gates/l0/scope-valid.js";
import { SPEC_APPROVED } from "../gates/l0/spec-approved.js";
import type { CheckFailure, Finding, GateEngineResult, GateSignals, Verdict } from "../gates/types.js";
import { evaluateGates } from "../gates/verdict.js";
import { isPlainObject, strings } from "../json.js";
import { hooksInactive } from "../liveness/index.js";
import type { LoadResult } from "../packs/types.js";
import type { ArtifactStatuses } from "../ports/openspec.js";
import type { ChangeRecord } from "../record/read.js";
import type { EffectivePolicy } from "../resolve/index.js";
import { roleMembers } from "../roles.js";
import { readChangeRuns } from "../run/store.js";
import { contractTrees, type ProjectFacts } from "./facts.js";

/** Gate documents by id, override in force. */
export function gateDefinitions(loaded: LoadResult): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const object of loaded.objects) {
    if (object.kind === "gate" && isPlainObject(object.json)) out.set(object.id, object.json);
  }
  return out;
}

/** `match.paths` of profile `factory-change`: the policy paths of D-15. */
export function policyPaths(loaded: LoadResult): string[] {
  const profile = loaded.objects.find((o) => o.kind === "profile" && o.id === FACTORY_PROFILE);
  const match = isPlainObject(profile?.json) ? profile.json["match"] : undefined;
  return isPlainObject(match) ? strings(match["paths"]) : [];
}

export interface Evaluation {
  transition: string;
  engine: GateEngineResult;
  decision: ControllerDecision;
  /** The diff the gates judged (`scope-valid`): the paths `hooksFindings` looks at. */
  diff: Availability<DiffEntry[]>;
}

export interface EvaluateParams {
  ctx: Ctx;
  change: string;
  record: ChangeRecord;
  loaded: LoadResult;
  policy: EffectivePolicy;
  transition: string;
  facts: ProjectFacts;
  artifacts: Availability<ArtifactStatuses>;
  env: NodeJS.ProcessEnv;
  only?: string[] | undefined;
  checkFailures?: CheckFailure[] | undefined;
  /**
   * Records of this run beside those on disk: written already, or only
   * collected under `--dry-run` — the gates judge them the same way (REQ-KRN-034).
   */
  pending?: PendingRecord[] | undefined;
}

/** Gate engine and controller for one Change and transition. Reads, never writes. */
export async function evaluateTransition(params: EvaluateParams): Promise<Evaluation> {
  const { record, loaded, policy, facts } = params;
  const classification = isPlainObject(record["classification"]) ? record["classification"] : {};
  const unknowns = Array.isArray(record["unknowns"]) ? record["unknowns"] : [];
  const signals: GateSignals = {
    change: params.change,
    today: facts.today,
    commit: facts.git.commit,
    diff: facts.diff,
    branch: facts.branch,
    artifacts: params.artifacts,
    ids: facts.ids,
    unknowns,
    profiles: strings(classification["profiles"]),
    policyPaths: policyPaths(loaded)
  };
  if (facts.git.baseCommit !== undefined) signals.base = facts.git.baseCommit;
  if (params.checkFailures !== undefined) signals.checkFailures = params.checkFailures;

  const stored = readRecords(evidenceDir(params.ctx.root, params.change, params.env)).map((r) => ({ id: r.id, json: r.json }));
  const ids = new Set(stored.map((r) => r.id));
  const records = [...stored, ...(params.pending ?? []).filter((r) => !ids.has(r.id))].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
  const evaluated = policy.gates[params.transition] ?? [];
  if (evaluated.includes(SPEC_APPROVED) && (params.only === undefined || params.only.includes(SPEC_APPROVED))) {
    signals.contract = await contractTrees(params.ctx, params.change, record, records, facts.git);
  }

  const definitions = gateDefinitions(loaded);
  const engine = evaluateGates({
    policy,
    transition: params.transition,
    ...(params.only === undefined ? {} : { only: params.only }),
    definitions,
    records,
    waivers: facts.waivers,
    approvers: roleMembers(loaded.config),
    signals
  });
  const inputs = controllerInputs({
    transition: params.transition,
    gates: engine.gates,
    findings: engine.findings,
    definitions,
    unknowns,
    policy,
    artifacts: params.artifacts
  });
  return {
    transition: params.transition,
    engine,
    decision: evaluateController(controllerRules(loaded), inputs),
    diff: facts.diff
  };
}

/** `controller_action`, `next`? and `rule` in the order the output prints them. */
export function decisionFields(decision: ControllerDecision): Record<string, unknown> {
  const out: Record<string, unknown> = { controller_action: decision.controller_action };
  if (decision.next !== undefined) out["next"] = decision.next;
  out["rule"] = decision.rule;
  return out;
}

/**
 * Writes the verdicts into `manifest.gates` of the Change (design §6: the
 * manifest's gates belong to `gate`/`verify`). Only an existing manifest is
 * updated — without a record there is nothing a manifest could list.
 */
export function recordVerdicts(
  ctx: Pick<Ctx, "root" | "writes">,
  change: string,
  env: NodeJS.ProcessEnv,
  gates: Record<string, Verdict>
): void {
  const dir = evidenceDir(ctx.root, change, env);
  if (!existsSync(path.join(dir, MANIFEST_FILE))) return;
  const manifest = readManifest(dir);
  if (manifest === undefined) return;
  const previous = isPlainObject(manifest["gates"]) ? manifest["gates"] : {};
  const merged: Record<string, unknown> = { ...previous, ...gates };
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(merged).sort()) sorted[key] = merged[key];
  const file = path.join(dir, MANIFEST_FILE);
  ctx.writes.write(projectUri(ctx.root, file), () => writeJsonFile(file, { ...manifest, gates: sorted }));
}

/** `data.findings[]`: the gate engine's, then the controller's (R-13). */
export function evaluationFindings(evaluation: Evaluation): Finding[] {
  return [...evaluation.engine.findings, ...(evaluation.decision.findings ?? [])];
}

/**
 * `FRONTEND_HOOKS_INACTIVE` (REQ-VER-009) on the diff of `evaluation` and the
 * Runs of `change` in `<state>/runs/`; none when the diff is unknown. Added
 * after the gates and the controller: it changes no verdict, no
 * `controller_action`, no exit code.
 */
export function hooksFindings(
  ctx: Pick<Ctx, "root">,
  change: string,
  evaluation: Evaluation,
  config: WarrantConfig,
  env: NodeJS.ProcessEnv
): Finding[] {
  if (!evaluation.diff.ok) return [];
  const finding = hooksInactive(evaluation.diff.value, readChangeRuns(ctx.root, change, env), config);
  return finding === undefined ? [] : [finding];
}

/** `data` of `gate` (and the gate half of `verify`); `extra` — findings beside the verdicts (`hooksFindings`). */
export function gateData(evaluation: Evaluation, extra: readonly Finding[] = []): Record<string, unknown> {
  return {
    transition: evaluation.transition,
    gates: evaluation.engine.gates,
    findings: [...evaluationFindings(evaluation), ...extra],
    ...decisionFields(evaluation.decision)
  };
}
