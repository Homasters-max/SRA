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
 *   and every CI record the verdicts rest on must come from one CI run
 *   (`REF_MISMATCH`, R-6) — the rules of `core/transition/merged.ts` (A-29).
 *   The `--ref` of `APPROVED` and `MERGED` is the URL of the spec-PR and of the
 *   impl-PR (ADR-0037 п. 5), checked here by its form only;
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
import { HUMAN_APPROVAL } from "../core/evidence/approval.js";
import { mergedCommitFacts, readGitFacts, type GitFacts } from "../core/git/facts.js";
import { findChangeDir } from "../core/openspec/changes.js";
import { readChangeRecord, type ChangeRecord } from "../core/record/read.js";
import { confirmationOf, isChangeState, transitionKind } from "../core/record/lifecycle.js";
import { appendTransition, assertNotFrozen, recordPath, stateOfRecord, type TransitionEntry } from "../core/record/write.js";
import { checkPullRequestRef, checkRef } from "../core/roles.js";
import { humanApproval } from "../core/transition/approval.js";
import { judgeGates, prepare, type Prepared } from "../core/transition/evaluate.js";
import { decisionFields, evaluationFindings, type Evaluation } from "../core/transition/gates.js";
import { assertOneRun, mergedCommit } from "../core/transition/merged.js";
import { forwardEntry, gatesNotPassed, gatesNotPassedRefusal, RECORDED_BY } from "../core/transition/outcome.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { requireConfigPath, withDryRun } from "./context.js";

export interface TransitionOptions {
  /** `--ref <url>`: the pull request of the act — spec-PR for `APPROVED`, impl-PR for `MERGED` — required for both. */
  ref?: string | undefined;
  /** `--by <login>`: the human approving, when the transition has gate `human-approval`. */
  by?: string | undefined;
  /** `--commit <sha>`: the commit of the evidence of `MERGED`. */
  commit?: string | undefined;
}

/**
 * The pull request whose URL is the `--ref` of a transition into `target`
 * (REQ-VER-007, ADR-0037 п. 5): the spec-PR of `APPROVED`, the impl-PR of
 * `MERGED`; undefined when `--ref` is not required.
 */
function pullRequestOf(target: string): string | undefined {
  const confirmation = confirmationOf(target);
  return confirmation === undefined ? undefined : `${confirmation.pr}-PR`;
}

/** `data` of a failed forward transition and of a passed one, before the record entry. */
function gateFields(evaluation: Evaluation): Record<string, unknown> {
  return {
    gates: evaluation.engine.gates,
    findings: evaluationFindings(evaluation),
    ...decisionFields(evaluation.decision)
  };
}

/** `--by` and `--ref` of a transition with gate `human-approval`, then its record (design §10). */
function approve(ctx: Ctx, change: string, prepared: Prepared, git: GitFacts, opts: TransitionOptions): ReturnType<typeof humanApproval> {
  const { transition } = prepared;
  if (opts.by === undefined) {
    throw new WarrantError("USAGE", `${transition} has gate ${HUMAN_APPROVAL}: pass --by <login> and --ref <url> of the review`);
  }
  if (opts.ref === undefined) {
    throw new WarrantError("USAGE", `${transition} has gate ${HUMAN_APPROVAL}: pass --ref <url> of the review`);
  }
  return humanApproval(ctx, change, prepared, git, opts.by, opts.ref);
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
  const pr = pullRequestOf(target);
  if (opts.ref === undefined && pr !== undefined) {
    throw new WarrantError("USAGE", `${target} needs --ref <URL of the ${pr}>`, {
      hint: `pass --ref https://github.com/<owner>/<repo>/pull/<N> of the ${pr}`
    });
  }
  if (opts.ref !== undefined) {
    if (pr === undefined) checkRef(opts.ref);
    else checkPullRequestRef(opts.ref, pr);
  }
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
  const { policy } = prepared;

  // The commit and base the gates speak of (design §9).
  let git: GitFacts;
  const data: Record<string, unknown> = { transition };
  if (target === "MERGED") {
    const commit = await mergedCommit(ctx, change, opts.commit, env);
    git = await mergedCommitFacts(ctx, commit);
    data["commit"] = commit;
    data["base"] = git.baseCommit ?? null;
  } else {
    git = await readGitFacts(ctx, undefined);
  }

  // The human act comes first and stays, whatever the gates say (design §10).
  const approval = (policy.gates[transition] ?? []).includes(HUMAN_APPROVAL) ? await approve(ctx, change, prepared, git, opts) : undefined;
  if (approval !== undefined) {
    data["approval"] = { evidence: approval.evidence, reused: approval.reused };
  } else if (opts.by !== undefined) {
    warn(`transition: --by is ignored: ${transition} has no gate ${HUMAN_APPROVAL} in the effective policy\n`);
  }

  const pending = approval?.record === undefined ? [] : [approval.record];
  const evaluation = await judgeGates(ctx, change, prepared, git, undefined, pending);
  Object.assign(data, gateFields(evaluation));

  const failed = gatesNotPassed(evaluation.engine.gates);
  if (failed.length > 0) {
    const refused = gatesNotPassedRefusal(evaluation, failed);
    return failures([refused.error], refused.exitCode, data, change);
  }
  if (target === "MERGED") assertOneRun(root, change, env, evaluation);

  const entry = forwardEntry(target, policy, evaluation, opts.ref);
  appendTransition(ctx, change, record, entry);
  return success({ ...data, change_state: target, recorded: entry }, change);
}
