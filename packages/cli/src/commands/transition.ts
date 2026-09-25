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
 *
 * `--dry-run` (REQ-KRN-034): the same checks, gates and JSON, with
 * `data.dry_run` and `data.would_write[]`; the record, the `human-approval`
 * record and the manifest are not written — the gates judge the approval
 * record as built — and the directory of an `ABANDONED` Change stays.
 */
import { rmSync } from "node:fs";
import path from "node:path";

import type { Ctx } from "../core/ctx.js";
import { EXIT, WarrantError } from "../core/errors.js";
import { buildApprovalRecord, HUMAN_APPROVAL, isApprovalBy } from "../core/evidence/approval.js";
import { evidenceDir, readRecords } from "../core/evidence/store.js";
import { manifestVersions, storeRecord } from "../core/evidence/write.js";
import {
  isAncestor,
  mergedCommitFacts,
  notMergedHeadReason,
  readGitFacts,
  resolveCommit,
  type GitFacts
} from "../core/git/facts.js";
import { staleReason } from "../core/gates/prefilter.js";
import { freshest } from "../core/gates/verdict.js";
import { allocateUlid } from "../core/ids/allocate.js";
import { findChangeDir } from "../core/openspec/changes.js";
import { isPlainObject } from "../core/json.js";
import { gateDefinitions } from "../core/packs/objects.js";
import type { LoadResult } from "../core/packs/types.js";
import { readChangeRecord, type ChangeRecord } from "../core/record/read.js";
import { isChangeState, REF_REQUIRED_STATES, transitionKind } from "../core/record/lifecycle.js";
import { appendTransition, assertNotFrozen, recordPath, stateOfRecord, type TransitionEntry } from "../core/record/write.js";
import type { EffectivePolicy } from "../core/resolve/index.js";
import { approvalRoles, checkRef, roleMembers } from "../core/roles.js";
import { judgeGates, prepare } from "../core/transition/evaluate.js";
import { decisionFields, evaluationFindings, type Evaluation } from "../core/transition/gates.js";
import { evidenceOf, forwardEntry, gatesNotPassed, gatesNotPassedRefusal, RECORDED_BY } from "../core/transition/outcome.js";
import { readWaivers } from "../core/waivers/read.js";
import { countingWaiverIds } from "../core/waivers/status.js";
import type { PendingRecord } from "../core/evidence/store.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { requireConfigPath, withDryRun } from "./context.js";

export interface TransitionOptions {
  /** `--ref <url>`: the forge artefact of the act (review, CI run); required for `APPROVED` and `MERGED`. */
  ref?: string | undefined;
  /** `--by <login>`: the human approving, when the transition has gate `human-approval`. */
  by?: string | undefined;
  /** `--commit <sha>`: the commit of the evidence of `MERGED`. */
  commit?: string | undefined;
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
  const refused = await notMergedHeadReason(ctx, sha);
  if (refused === null) return;
  throw new WarrantError("COMMIT_NOT_MERGED", `${source}: ${refused.reason}`, refused.hint === undefined ? {} : { hint: refused.hint });
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
    throw new WarrantError("USAGE", `no evidence of "${change}" names a commit`, { hint: "pass --commit <sha>" });
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
async function ensureApproval(params: ApprovalParams): Promise<{ evidence: string; reused: boolean; record?: PendingRecord }> {
  const { ctx, change, env, git, login, ref } = params;
  const { root } = ctx;
  const definitions = gateDefinitions(params.loaded);
  // The same "waiver counts" as the gate engine (A-14): roles, `waivable`, `targets` included.
  const approvers = roleMembers(params.loaded.config);
  const admit = {
    commit: git.commit,
    base: git.baseCommit,
    activeWaivers: countingWaiverIds(readWaivers(root), definitions, { today: ctx.clock.today(), approvers })
  };
  for (const record of readRecords(evidenceDir(root, change, env))) {
    if (isApprovalBy(record.json, login, ref) && staleReason(record.json, admit) === null) {
      return { evidence: record.id, reused: true };
    }
  }

  const gate = definitions.get(HUMAN_APPROVAL);
  const id = allocateUlid("EVID");
  const record = buildApprovalRecord({
    id,
    change,
    transition: params.transition,
    login,
    ref,
    commit: git.commit,
    baseCommit: git.baseCommit,
    level: typeof gate?.["level"] === "string" ? gate["level"] : "L0",
    limitations: git.limitations,
    effectivePolicyHash: params.policy.hash,
    createdAt: new Date().toISOString()
  });
  storeRecord({
    root,
    writes: ctx.writes,
    change,
    env,
    record,
    commit: git.commit,
    versions: await manifestVersions(ctx, params.policy.hash),
    what: `${HUMAN_APPROVAL} by ${login}`
  });
  return { evidence: id, reused: false, record: { id, json: record } };
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

export async function runTransition(
  ctx: Ctx,
  change: string,
  target: string,
  opts: TransitionOptions = {},
  env: NodeJS.ProcessEnv = process.env
): Promise<CommandResult> {
  return withDryRun(ctx, () => recordTransition(ctx, change, target, opts, env));
}

async function recordTransition(
  ctx: Ctx,
  change: string,
  target: string,
  opts: TransitionOptions,
  env: NodeJS.ProcessEnv
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
  if (opts.ref === undefined && (REF_REQUIRED_STATES as readonly string[]).includes(target)) {
    throw new WarrantError("USAGE", `${target} needs --ref <url> of the act (review or CI run)`);
  }
  if (opts.ref !== undefined) checkRef(opts.ref);
  const refPart = opts.ref === undefined ? {} : { ref: opts.ref };

  if (kind === "backward" || kind === "abandon") {
    if (opts.by !== undefined) warn(`transition: --by is ignored on ${transition}: it has no gates\n`);
    const entry: TransitionEntry = { to: target, at: new Date().toISOString(), by: RECORDED_BY, ...refPart };
    appendTransition(ctx, change, record, entry);
    const data: Record<string, unknown> = { transition, change_state: target, recorded: entry };
    if (kind === "abandon") {
      // Record first, then the directory (design §10).
      const location = findChangeDir(root, change);
      const removed = location?.where === "active" ? location.path : null;
      if (removed !== null) ctx.writes.write(removed, () => rmSync(path.join(root, removed), { recursive: true, force: true }));
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
  const prepared = prepare(ctx, change, { transition, env, record });
  if (!prepared.ok) {
    if (!prepared.conflict) return failures(prepared.errors, EXIT.CONFIG, {}, change);
    const { error, decision } = prepared;
    return failures([error], EXIT.WAIT, { transition, gates: {}, findings: [], ...decisionFields(decision) }, change);
  }
  const { loaded, policy } = prepared;

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
  const pending: PendingRecord[] = [];
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
    const approval = await ensureApproval({ ctx, change, env, loaded, policy, transition, git, login: opts.by, ref: opts.ref });
    data["approval"] = { evidence: approval.evidence, reused: approval.reused };
    if (approval.record !== undefined) pending.push(approval.record);
  } else if (opts.by !== undefined) {
    warn(`transition: --by is ignored: ${transition} has no gate ${HUMAN_APPROVAL} in the effective policy\n`);
  }

  const evaluation = await judgeGates(ctx, change, prepared, git, undefined, pending);
  Object.assign(data, gateFields(evaluation));

  const failed = gatesNotPassed(evaluation.engine.gates);
  if (failed.length > 0) {
    const refused = gatesNotPassedRefusal(evaluation, failed);
    return failures([refused.error], refused.exitCode, data, change);
  }
  if (target === "MERGED" && opts.ref !== undefined) assertRunRef(root, change, env, evaluation, opts.ref);

  const entry = forwardEntry(target, policy, evaluation, opts.ref);
  appendTransition(ctx, change, record, entry);
  return success({ ...data, change_state: target, recorded: entry }, change);
}
