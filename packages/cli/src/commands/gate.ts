/**
 * `warrant gate <change> [id...] [--transition <FROM->TO>] [--base <ref>]`
 * (REQ-VER-003, REQ-VER-004, REQ-VER-005, design §8, §9, §11).
 *
 * Gathers what the gate engine needs — records, waivers, git facts, artifact
 * statuses, stable ids — evaluates the gates of the transition (default: the
 * next forward one from `change_state`) and the controller over them, and
 * prints `data.transition`, `data.gates`, `data.findings[]`,
 * `data.controller_action`, `data.next`? and `data.rule`. The exit code is the
 * controller's: CONTINUE 0, STOP 1, WAIT and ESCALATE 2.
 *
 * The gathering helpers here are shared with `verify` and `status`: git and
 * OpenSpec are only ever reached through `ctx` from `commands/*` and
 * `core/git/facts.ts`, the engine and the controller stay pure.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { writeJsonFile } from "../core/canon/format-json.js";
import { conflictInputs, controllerInputs } from "../core/controller/inputs.js";
import { controllerRules, evaluateController, exitCodeOf, type ControllerDecision } from "../core/controller/evaluate.js";
import type { Ctx } from "../core/ctx.js";
import { EXIT, WarrantError, type CliError } from "../core/errors.js";
import { NO_GIT_COMMIT } from "../core/evidence/record.js";
import { evidenceDir, MANIFEST_FILE, readManifest, readRecords } from "../core/evidence/store.js";
import {
  changedPaths,
  contractTree,
  currentBranch,
  readGitFacts,
  type Availability,
  type DiffEntry,
  type GitFacts
} from "../core/git/facts.js";
import { FACTORY_PROFILE } from "../core/gates/l0/scope-valid.js";
import { approvalOf, SPEC_APPROVED } from "../core/gates/l0/spec-approved.js";
import type {
  CheckFailure,
  ContractTrees,
  EvidenceInput,
  Finding,
  GateEngineResult,
  GateSignals,
  Verdict
} from "../core/gates/types.js";
import { evaluateGates } from "../core/gates/verdict.js";
import { checkAreas, checkDuplicates, loadAreas, scanIds } from "../core/ids/scan.js";
import { findChangeDir } from "../core/init/scaffold.js";
import { isPlainObject, strings } from "../core/json.js";
import type { ArtifactStatuses } from "../core/ports/openspec.js";
import { openspecAvailable } from "../core/openspec/version.js";
import { loadPacks } from "../core/packs/loader.js";
import type { LoadResult } from "../core/packs/types.js";
import { FORWARD_TRANSITIONS, nextForwardTransition } from "../core/record/lifecycle.js";
import { readChangeRecord, type ChangeRecord } from "../core/record/read.js";
import { resolveForProject, type Classification, type EffectivePolicy } from "../core/resolve/index.js";
import { roleMembers } from "../core/roles.js";
import { readWaivers } from "../core/waivers/read.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { requireConfigPath } from "./context.js";

export interface GateOptions {
  /** `--transition <FROM->TO>`; default — the next forward transition from `change_state`. */
  transition?: string | undefined;
  /** `--base <ref>`; default `merge-base(HEAD, main)`. */
  base?: string | undefined;
}

/** `--transition`, else the next forward transition; USAGE when there is none. */
export function transitionOf(record: ChangeRecord, requested: string | undefined): string {
  if (requested !== undefined) {
    if (!FORWARD_TRANSITIONS.includes(requested)) {
      throw new WarrantError("USAGE", `--transition ${JSON.stringify(requested)} is not one of: ${FORWARD_TRANSITIONS.join(", ")}`);
    }
    return requested;
  }
  const state = String(record["change_state"]);
  const next = nextForwardTransition(state);
  if (next === null) {
    throw new WarrantError("USAGE", `change is ${state}: there is no forward transition to evaluate; pass --transition`);
  }
  return next;
}

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

/** Check (5) of `validate` without placement (design §8); never throws. */
export function idFindings(root: string): Availability<CliError[]> {
  try {
    const scan = scanIds(root);
    return { ok: true, value: [...scan.malformed, ...checkAreas(scan.ids, loadAreas(root)), ...checkDuplicates(scan.ids)] };
  } catch (thrown) {
    return { ok: false, reason: `stable ids could not be scanned: ${(thrown as Error).message}` };
  }
}

/** Artifact statuses of an active change directory; the reason otherwise. */
export async function artifactStatuses(ctx: Ctx, change: string): Promise<Availability<ArtifactStatuses>> {
  const location = findChangeDir(ctx.root, change);
  if (location?.where !== "active") {
    return { ok: false, reason: `openspec/changes/${change}/ is not an active change directory` };
  }
  if (!(await openspecAvailable(ctx.openspec))) return { ok: false, reason: "`openspec` is not on PATH" };
  const run = await ctx.openspec.status(change);
  if (run.warning !== undefined) return { ok: false, reason: run.warning };
  return { ok: true, value: run.artifacts };
}

/** Facts shared by every Change of one command call. */
export interface ProjectFacts {
  git: GitFacts;
  diff: Availability<DiffEntry[]>;
  branch: Availability<string>;
  ids: Availability<CliError[]>;
  waivers: ReturnType<typeof readWaivers>;
  today: string;
}

export async function projectFacts(ctx: Ctx, git: GitFacts): Promise<ProjectFacts> {
  return {
    git,
    diff: await changedPaths(ctx, git),
    branch: await currentBranch(ctx, git),
    ids: idFindings(ctx.root),
    waivers: readWaivers(ctx.root),
    today: ctx.clock.today()
  };
}

/**
 * The contract trees `spec-approved` compares (design §6): the approval commit
 * from the record and its evidence, the evaluated commit from the git facts.
 */
export async function contractTrees(
  ctx: Ctx,
  change: string,
  record: ChangeRecord,
  records: readonly EvidenceInput[],
  git: GitFacts
): Promise<Availability<ContractTrees>> {
  if (git.commonDir === null || git.commit === NO_GIT_COMMIT) {
    return { ok: false, reason: "the project is not a git repository with a commit" };
  }
  const approval = approvalOf(record, records);
  if (!approval.ok) return approval;
  const approved = await contractTree(ctx, approval.value.commit, change);
  if (!approved.ok) return { ok: false, reason: `approval commit of ${approval.value.evidence}: ${approved.reason}` };
  const evaluated = await contractTree(ctx, git.commit, change);
  if (!evaluated.ok) return { ok: false, reason: `evaluated commit: ${evaluated.reason}` };
  return {
    ok: true,
    value: {
      evidence: approval.value.evidence,
      approved: { commit: approval.value.commit, tree: approved.value },
      evaluated: { commit: git.commit, tree: evaluated.value }
    }
  };
}

export interface Evaluation {
  transition: string;
  engine: GateEngineResult;
  decision: ControllerDecision;
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

  const records = readRecords(evidenceDir(params.ctx.root, params.change, params.env)).map((r) => ({ id: r.id, json: r.json }));
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
  return { transition: params.transition, engine, decision: evaluateController(controllerRules(loaded), inputs) };
}

/** The decision of the controller when the policy could not be composed (`policy-conflict`). */
export function conflictDecision(loaded: LoadResult, record: ChangeRecord): ControllerDecision {
  const unknowns = Array.isArray(record["unknowns"]) ? record["unknowns"] : [];
  return evaluateController(controllerRules(loaded), conflictInputs(unknowns));
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
export function recordVerdicts(root: string, change: string, env: NodeJS.ProcessEnv, gates: Record<string, Verdict>): void {
  const dir = evidenceDir(root, change, env);
  if (!existsSync(path.join(dir, MANIFEST_FILE))) return;
  const manifest = readManifest(dir);
  if (manifest === undefined) return;
  const previous = isPlainObject(manifest["gates"]) ? manifest["gates"] : {};
  const merged: Record<string, unknown> = { ...previous, ...gates };
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(merged).sort()) sorted[key] = merged[key];
  writeJsonFile(path.join(dir, MANIFEST_FILE), { ...manifest, gates: sorted });
}

/** Resolved policy of the record, or the conflict / configuration errors. */
export type Resolved =
  | { ok: true; policy: EffectivePolicy }
  | { ok: false; conflict: true; error: CliError }
  | { ok: false; conflict: false; errors: CliError[] };

export function resolveRecord(loaded: LoadResult, change: string, record: ChangeRecord): Resolved {
  const resolved = resolveForProject(loaded, record["classification"] as Classification | undefined);
  if (resolved.errors.length > 0) return { ok: false, conflict: false, errors: resolved.errors };
  if (!resolved.result.ok) {
    return { ok: false, conflict: true, error: { code: "POLICY_CONFLICT", message: `${change}: ${resolved.result.conflict.message}` } };
  }
  return { ok: true, policy: resolved.result.policy };
}

/** Gate ids named on the command line: declared, and part of the transition. */
function checkedIds(ids: string[], loaded: LoadResult, policy: EffectivePolicy, transition: string): string[] | undefined {
  if (ids.length === 0) return undefined;
  const declared = gateDefinitions(loaded);
  const inTransition = new Set(policy.gates[transition] ?? []);
  for (const id of ids) {
    if (!declared.has(id)) throw new WarrantError("USAGE", `no gate "${id}" in the enabled packs or .warrant/local/`);
    if (!inTransition.has(id)) {
      throw new WarrantError("USAGE", `gate "${id}" is not a gate of ${transition} in the effective policy`);
    }
  }
  return [...new Set(ids)];
}

export async function runGate(
  ctx: Ctx,
  change: string,
  ids: string[],
  opts: GateOptions = {},
  env: NodeJS.ProcessEnv = process.env
): Promise<CommandResult> {
  const { root } = ctx;
  requireConfigPath(root);
  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) return failures(loaded.errors, EXIT.CONFIG, {}, change);
  const record = readChangeRecord(root, change);
  const transition = transitionOf(record, opts.transition);

  const resolved = resolveRecord(loaded, change, record);
  if (!resolved.ok) {
    if (!resolved.conflict) return failures(resolved.errors, EXIT.CONFIG, {}, change);
    const decision = conflictDecision(loaded, record);
    return failures([resolved.error], EXIT.WAIT, { transition, gates: {}, findings: [], ...decisionFields(decision) }, change);
  }
  const only = checkedIds(ids, loaded, resolved.policy, transition);

  const facts = await projectFacts(ctx, await readGitFacts(ctx, opts.base));
  const evaluation = await evaluateTransition({
    ctx,
    change,
    record,
    loaded,
    policy: resolved.policy,
    transition,
    facts,
    artifacts: await artifactStatuses(ctx, change),
    env,
    only
  });
  recordVerdicts(root, change, env, evaluation.engine.gates);

  const data = gateData(evaluation);
  const exitCode = exitCodeOf(evaluation.decision.controller_action);
  return exitCode === EXIT.OK ? success(data, change) : failures([], exitCode, data, change);
}

/** `data.findings[]`: the gate engine's, then the controller's (R-13). */
export function evaluationFindings(evaluation: Evaluation): Finding[] {
  return [...evaluation.engine.findings, ...(evaluation.decision.findings ?? [])];
}

/** `data` of `gate` (and the gate half of `verify`). */
export function gateData(evaluation: Evaluation): Record<string, unknown> {
  return {
    transition: evaluation.transition,
    gates: evaluation.engine.gates,
    findings: evaluationFindings(evaluation),
    ...decisionFields(evaluation.decision)
  };
}
