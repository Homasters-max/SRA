/**
 * `warrant transition <change> <STATE> [--ref <url>] [--by <login>] [--commit <sha>]`
 * (REQ-VER-007, P-6, P-15, P-17, design §9, §10).
 *
 * Writes one transition into the record when 04 section 2 allows it:
 *
 * - forward: the gates of the transition are evaluated by the gate engine of
 *   `gate` (no check is run); every gate must be `PASS`, `WAIVED` or
 *   `NOT_APPLICABLE`, otherwise `GATES_NOT_PASSED` with `data.gates`, the exit
 *   code of the controller and the record untouched. When the policy puts gate
 *   `human-approval` on the transition, `--by` must be a member of a role of
 *   `approvals[]` at that transition (fallback `maintainer`), and the
 *   `human-approval` record is written **before** the gates — the human act
 *   happened, and a repeated `transition` reuses the record while the
 *   pre-filter admits it. `MERGED` is judged on the commit of the evidence
 *   (`--commit`, else the commit of the freshest record), which must be an
 *   ancestor of HEAD and the head of the merged impl-PR (`COMMIT_NOT_MERGED`),
 *   and every CI record the verdicts rest on must come from the run `--ref`
 *   names (`REF_MISMATCH`, R-6);
 * - backward (`VERIFYING->IMPLEMENTING`, `IMPLEMENTING->SPECIFIED`): recorded
 *   without gates;
 * - `ABANDONED` (from any state before `MERGED`): recorded, then
 *   `openspec/changes/<change>/` is removed — record first, so a failure in
 *   between leaves `ABANDONED_DIR_PRESENT`, not a live Change without its
 *   directory (design §10).
 *
 * `ARCHIVED` is entered only through `warrant archive`, which moves the
 * directory first. There is no `--force`.
 */
import { rmSync } from "node:fs";
import path from "node:path";

import { canonicalHash } from "../core/canon/hash.js";
import { exitCodeOf } from "../core/controller/evaluate.js";
import type { Ctx } from "../core/ctx.js";
import { EXIT, WarrantError, type ExitCode } from "../core/errors.js";
import { evidenceDir, readRecords } from "../core/evidence/store.js";
import {
  isAncestor,
  mergedCommitFacts,
  notMergedHeadReason,
  readGitFacts,
  resolveCommit,
  type GitFacts
} from "../core/gates/diff.js";
import { activeWaiverIds, staleReason } from "../core/gates/prefilter.js";
import type { Verdict } from "../core/gates/types.js";
import { freshest } from "../core/gates/verdict.js";
import { allocateUlid } from "../core/ids/allocate.js";
import { findChangeDir } from "../core/init/scaffold.js";
import { loadPacks } from "../core/packs/loader.js";
import type { LoadResult } from "../core/packs/types.js";
import { readChangeRecord, type ChangeRecord } from "../core/record/read.js";
import {
  appendTransition,
  assertNotFrozen,
  isChangeState,
  recordPath,
  stateOfRecord,
  transitionKind,
  type TransitionEntry
} from "../core/record/write.js";
import type { EffectivePolicy } from "../core/resolve/index.js";
import { readWaivers, roleMembers } from "../core/validate/waivers.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { manifestVersions, storeRecord } from "./check.js";
import { requireConfigPath } from "./context.js";
import {
  artifactStatuses,
  conflictDecision,
  decisionFields,
  evaluateTransition,
  evaluationFindings,
  gateDefinitions,
  projectFacts,
  recordVerdicts,
  resolveRecord,
  type Evaluation
} from "./gate.js";

export interface TransitionOptions {
  /** `--ref <url>`: the forge artefact of the act (review, CI run); required for `APPROVED` and `MERGED`. */
  ref?: string | undefined;
  /** `--by <login>`: the human approving, when the transition has gate `human-approval`. */
  by?: string | undefined;
  /** `--commit <sha>`: the commit of the evidence of `MERGED`. */
  commit?: string | undefined;
}

/** Who records a transition made by this command (REQ-VER-007). */
export const RECORDED_BY = "cli:local";

export const HUMAN_APPROVAL = "human-approval";

/** Role asked for when the policy names none at the transition (design §10). */
export const FALLBACK_ROLE = "maintainer";

/** States whose transition needs `--ref` (P-6). */
const REF_REQUIRED = ["APPROVED", "MERGED"];

/**
 * Limitation of every `human-approval` record: `--ref` is only checked to be
 * an http(s) URL and `--by` is a claim; `warrant ci` of phase 4 verifies them
 * through the forge (ADR-0010 point 2, R-10).
 */
export const REF_NOT_VERIFIED = "ref not verified (phase 4: warrant ci)";

/** Verdicts a forward transition passes with (REQ-VER-007). */
const PASSING: ReadonlySet<Verdict> = new Set<Verdict>(["PASS", "WAIVED", "NOT_APPLICABLE"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Gates of an evaluation whose verdict does not let the transition through, sorted. */
export function gatesNotPassed(gates: Record<string, Verdict>): string[] {
  return Object.keys(gates)
    .filter((id) => !PASSING.has(gates[id] as Verdict))
    .sort();
}

/** Ids of the records the verdicts rest on, sorted and unique. */
export function evidenceOf(evaluation: Evaluation): string[] {
  return [...new Set(Object.values(evaluation.engine.evidence).flat())].sort();
}

/** Roles of `approvals[]` at the transition; `maintainer` when there is none. */
export function approvalRoles(policy: EffectivePolicy, transition: string): string[] {
  const roles = [...new Set(policy.approvals.filter((a) => a.at === transition).map((a) => a.role))].sort();
  return roles.length > 0 ? roles : [FALLBACK_ROLE];
}

/** `USAGE` unless `ref` is an http(s) URL (the forge act); also `classify --ref`. */
export function checkRef(ref: string): void {
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    throw new WarrantError("USAGE", `--ref ${JSON.stringify(ref)} is not a URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new WarrantError("USAGE", `--ref ${JSON.stringify(ref)} is not an http(s) URL of the forge`);
  }
}

/** `data` of a failed forward transition and of a passed one, before the record entry. */
function gateFields(evaluation: Evaluation): Record<string, unknown> {
  return {
    gates: evaluation.engine.gates,
    findings: evaluationFindings(evaluation),
    ...decisionFields(evaluation.decision)
  };
}

/** `COMMIT_NOT_MERGED` unless `sha` is the head of a merged impl-PR (review of phase 3, R-1). */
async function assertMergedHead(ctx: Ctx, sha: string, source: string): Promise<void> {
  const reason = await notMergedHeadReason(ctx, sha);
  if (reason !== null) throw new WarrantError("COMMIT_NOT_MERGED", `${source}: ${reason}`);
}

/**
 * The commit of `MERGED` (design §9): `--commit`, else the commit of the
 * freshest record of the Change; it must be an ancestor of HEAD and the head
 * of the impl-PR that brought it in (R-1).
 */
async function mergedCommit(ctx: Ctx, change: string, env: NodeJS.ProcessEnv, requested: string | undefined): Promise<string> {
  if (requested !== undefined) {
    const sha = await resolveCommit(ctx, requested);
    if (sha === null) throw new WarrantError("USAGE", `--commit ${JSON.stringify(requested)} does not name a commit of this repository`);
    if (!(await isAncestor(ctx, sha, "HEAD"))) {
      throw new WarrantError("COMMIT_NOT_MERGED", `commit ${sha} is not an ancestor of HEAD: merge the impl-PR first`);
    }
    await assertMergedHead(ctx, sha, "--commit");
    return sha;
  }
  const records = readRecords(evidenceDir(ctx.root, change, env)).map((r) => ({ id: r.id, json: r.json }));
  const latest = freshest(records);
  const subject = isPlainObject(latest?.json["subject"]) ? latest.json["subject"] : undefined;
  const commit = typeof subject?.["commit"] === "string" ? subject["commit"] : undefined;
  if (latest === undefined || commit === undefined) {
    throw new WarrantError("USAGE", `no evidence of "${change}" names a commit; pass --commit <sha>`);
  }
  const sha = await resolveCommit(ctx, commit);
  if (sha === null || !(await isAncestor(ctx, sha, "HEAD"))) {
    throw new WarrantError(
      "COMMIT_NOT_MERGED",
      `commit ${commit} of the freshest record ${latest.id} is not an ancestor of HEAD: merge the impl-PR first or pass --commit`
    );
  }
  await assertMergedHead(ctx, sha, `freshest record ${latest.id}`);
  return sha;
}

interface ApprovalParams {
  ctx: Ctx;
  change: string;
  env: NodeJS.ProcessEnv;
  loaded: LoadResult;
  policy: EffectivePolicy;
  transition: string;
  git: GitFacts;
  login: string;
  ref: string;
}

/**
 * The `human-approval` record of `login` for this transition (P-17, design
 * §10): an existing one the pre-filter still admits — same commit and base,
 * same login and ref — is reused; otherwise a new one is written.
 */
async function ensureApproval(params: ApprovalParams): Promise<{ evidence: string; reused: boolean }> {
  const { ctx, change, env, git, login, ref } = params;
  const { root } = ctx;
  const admit = {
    commit: git.commit,
    base: git.baseCommit,
    activeWaivers: activeWaiverIds(readWaivers(root), ctx.clock.today())
  };
  for (const record of readRecords(evidenceDir(root, change, env))) {
    const json = record.json;
    const producedBy = isPlainObject(json["produced_by"]) ? json["produced_by"] : {};
    const attestation = isPlainObject(json["attestation"]) ? json["attestation"] : {};
    if (
      json["kind"] === HUMAN_APPROVAL &&
      json["evidence_status"] === "PROVEN" &&
      producedBy["type"] === "human" &&
      producedBy["id"] === login &&
      attestation["type"] === "human-review" &&
      attestation["ref"] === ref &&
      staleReason(json, admit) === null
    ) {
      return { evidence: record.id, reused: true };
    }
  }

  const gate = gateDefinitions(params.loaded).get(HUMAN_APPROVAL);
  const level = typeof gate?.["level"] === "string" ? gate["level"] : "L0";
  const subject: Record<string, unknown> = {
    commit: git.commit,
    spec_revision: `openspec/changes/${change}@${git.commit}`,
    dataset_snapshot: null
  };
  if (git.baseCommit !== undefined) subject["base_commit"] = git.baseCommit;
  const id = allocateUlid("EVID");
  const record: Record<string, unknown> = {
    $schema: "warrant://evidence/1",
    id,
    claim: { text: `${login} approved ${change} for ${params.transition}`, targets: [] },
    kind: HUMAN_APPROVAL,
    level,
    evidence_status: "PROVEN",
    subject,
    produced_by: { type: "human", id: login },
    attestation: { type: "human-review", ref },
    context_hash: canonicalHash({
      change,
      commit: git.commit,
      transition: params.transition,
      by: login,
      ref,
      effective_policy_hash: params.policy.hash
    }),
    effective_policy_hash: params.policy.hash,
    created_at: new Date().toISOString(),
    artifacts: [],
    limitations: [...git.limitations, REF_NOT_VERIFIED]
  };
  storeRecord({
    root,
    change,
    env,
    record,
    commit: git.commit,
    versions: await manifestVersions(ctx, params.policy.hash),
    what: `${HUMAN_APPROVAL} by ${login}`
  });
  return { evidence: id, reused: false };
}

/** A ref without one trailing `/`: `…/runs/1/` and `…/runs/1` name the same run. */
function normalRef(ref: string): string {
  return ref.endsWith("/") ? ref.slice(0, -1) : ref;
}

/**
 * `REF_MISMATCH` unless every CI record the verdicts of `MERGED` rest on names
 * the run of `--ref` (R-6): evidence of two runs is no evidence of one.
 */
function assertRunRef(root: string, change: string, env: NodeJS.ProcessEnv, evaluation: Evaluation, ref: string): void {
  const used = new Set(evidenceOf(evaluation));
  const mismatched: string[] = [];
  for (const record of readRecords(evidenceDir(root, change, env))) {
    if (!used.has(record.id)) continue;
    const attestation = isPlainObject(record.json["attestation"]) ? record.json["attestation"] : {};
    if (attestation["type"] !== "ci") continue;
    const recorded = attestation["ref"];
    if (typeof recorded !== "string" || normalRef(recorded) !== normalRef(ref)) mismatched.push(record.id);
  }
  if (mismatched.length === 0) return;
  mismatched.sort();
  throw new WarrantError(
    "REF_MISMATCH",
    `--ref ${ref} is not the CI run of ${mismatched.join(", ")}: MERGED takes the evidence of one CI run, the one --ref names`
  );
}

/** The entry written for a forward transition that passed its gates. */
export function forwardEntry(to: string, policy: EffectivePolicy, evaluation: Evaluation, ref: string | undefined): TransitionEntry {
  const entry: TransitionEntry = {
    to,
    at: new Date().toISOString(),
    by: RECORDED_BY,
    effective_policy_hash: policy.hash,
    gates: evaluation.engine.gates,
    evidence: evidenceOf(evaluation)
  };
  if (ref !== undefined) entry.ref = ref;
  return entry;
}

/**
 * `GATES_NOT_PASSED` with the verdicts; the exit code is the controller's, and
 * never 0 — a gate that did not pass always keeps the transition out.
 */
export function gatesNotPassedResult(change: string, data: Record<string, unknown>, evaluation: Evaluation, failed: string[]): CommandResult {
  let code: ExitCode = exitCodeOf(evaluation.decision.controller_action);
  if (code === EXIT.OK) code = EXIT.WAIT;
  const message = `${evaluation.transition}: gates not passed: ${failed.map((id) => `${id} ${String(evaluation.engine.gates[id])}`).join(", ")}`;
  return failures([{ code: "GATES_NOT_PASSED", message }], code, data, change);
}

export async function runTransition(
  ctx: Ctx,
  change: string,
  target: string,
  opts: TransitionOptions = {},
  env: NodeJS.ProcessEnv = process.env
): Promise<CommandResult> {
  const { root, warn } = ctx;
  requireConfigPath(root);
  if (!isChangeState(target)) throw new WarrantError("USAGE", `${JSON.stringify(target)} is not a change_state`);
  const record = readChangeRecord(root, change);
  assertNotFrozen(record, change);

  const from = stateOfRecord(record);
  const transition = `${from}->${target}`;
  const kind = transitionKind(from, target);
  if (kind === null) {
    throw new WarrantError(
      "STATE_INVALID",
      `${transition} is not a transition of 04 section 2 (forward to the next state, VERIFYING->IMPLEMENTING, IMPLEMENTING->SPECIFIED, ABANDONED before MERGED)`,
      { path: recordPath(change) }
    );
  }
  if (target === "ARCHIVED") throw new WarrantError("USAGE", `ARCHIVED is entered through \`warrant archive ${change}\``);
  if (opts.commit !== undefined && target !== "MERGED") throw new WarrantError("USAGE", "--commit applies to MERGED only");
  if (opts.ref === undefined && REF_REQUIRED.includes(target)) {
    throw new WarrantError("USAGE", `${target} needs --ref <url> of the act (review or CI run)`);
  }
  if (opts.ref !== undefined) checkRef(opts.ref);
  const refPart = opts.ref === undefined ? {} : { ref: opts.ref };

  if (kind === "backward" || kind === "abandon") {
    if (opts.by !== undefined) warn(`transition: --by is ignored on ${transition}: it has no gates\n`);
    const entry: TransitionEntry = { to: target, at: new Date().toISOString(), by: RECORDED_BY, ...refPart };
    appendTransition(root, change, record, entry);
    const data: Record<string, unknown> = { transition, change_state: target, recorded: entry };
    if (kind === "abandon") {
      // Record first, then the directory (design §10).
      const location = findChangeDir(root, change);
      const removed = location?.where === "active" ? location.path : null;
      rmSync(path.join(root, "openspec", "changes", change), { recursive: true, force: true });
      data["removed"] = removed;
    }
    return success(data, change);
  }

  return forward({ ctx, change, record, from, target, transition, opts, env });
}

interface ForwardParams {
  ctx: Ctx;
  change: string;
  record: ChangeRecord;
  from: string;
  target: string;
  transition: string;
  opts: TransitionOptions;
  env: NodeJS.ProcessEnv;
}

async function forward(params: ForwardParams): Promise<CommandResult> {
  const { ctx, change, record, target, transition, opts, env } = params;
  const { root, warn } = ctx;
  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) return failures(loaded.errors, EXIT.CONFIG, {}, change);
  const resolved = resolveRecord(loaded, change, record);
  if (!resolved.ok) {
    if (!resolved.conflict) return failures(resolved.errors, EXIT.CONFIG, {}, change);
    const decision = conflictDecision(loaded, record);
    return failures([resolved.error], EXIT.WAIT, { transition, gates: {}, findings: [], ...decisionFields(decision) }, change);
  }
  const policy = resolved.policy;

  // The commit and base the gates speak of (design §9).
  let git: GitFacts;
  const data: Record<string, unknown> = { transition };
  if (target === "MERGED") {
    const commit = await mergedCommit(ctx, change, env, opts.commit);
    git = await mergedCommitFacts(ctx, commit);
    data["commit"] = commit;
    data["base"] = git.baseCommit ?? null;
  } else {
    git = await readGitFacts(ctx, undefined);
  }

  // The human act comes first and stays, whatever the gates say (design §10).
  if ((policy.gates[transition] ?? []).includes(HUMAN_APPROVAL)) {
    if (opts.by === undefined) {
      throw new WarrantError("USAGE", `${transition} has gate ${HUMAN_APPROVAL}: pass --by <login> and --ref <url> of the review`);
    }
    if (opts.ref === undefined) {
      throw new WarrantError("USAGE", `${transition} has gate ${HUMAN_APPROVAL}: pass --ref <url> of the review`);
    }
    const roles = approvalRoles(policy, transition);
    if (!roleMembers(loaded.config, roles).has(opts.by)) {
      throw new WarrantError(
        "ROLE_REQUIRED",
        `${opts.by} is not listed in roles ${roles.map((r) => `"${r}"`).join(", ")} of .warrant/warrant.json, required to approve ${transition}`,
        { path: ".warrant/warrant.json" }
      );
    }
    data["approval"] = await ensureApproval({ ctx, change, env, loaded, policy, transition, git, login: opts.by, ref: opts.ref });
  } else if (opts.by !== undefined) {
    warn(`transition: --by is ignored: ${transition} has no gate ${HUMAN_APPROVAL} in the effective policy\n`);
  }

  const evaluation = await evaluateTransition({
    ctx,
    change,
    record,
    loaded,
    policy,
    transition,
    facts: await projectFacts(ctx, git),
    artifacts: await artifactStatuses(ctx, change),
    env
  });
  recordVerdicts(root, change, env, evaluation.engine.gates);
  Object.assign(data, gateFields(evaluation));

  const failed = gatesNotPassed(evaluation.engine.gates);
  if (failed.length > 0) return gatesNotPassedResult(change, data, evaluation, failed);
  if (target === "MERGED" && opts.ref !== undefined) assertRunRef(root, change, env, evaluation, opts.ref);

  const entry = forwardEntry(target, policy, evaluation, opts.ref);
  appendTransition(root, change, record, entry);
  return success({ ...data, change_state: target, recorded: entry }, change);
}
