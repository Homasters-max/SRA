/**
 * `warrant archive <change>` (REQ-VER-008, ADR-0021, 04 section 7): the only
 * way into `ARCHIVED`.
 *
 * 1. The record must be `MERGED` (`STATE_INVALID` otherwise; `RECORD_FROZEN`
 *    once `ARCHIVED` / `ABANDONED`).
 * 2. `openspec validate <change> --strict --json` runs as check
 *    `openspec-validate` together with the other checks of `MERGED->ARCHIVED`
 *    (the code of `verify`), so its result is the `spec-report` record gate
 *    `spec-valid` judges.
 * 3. The gates of `MERGED->ARCHIVED` are evaluated on HEAD with base
 *    `merge-base(HEAD, main)`, **before** anything moves: the diff is what the
 *    archive branch already committed (records, evidence), the change directory
 *    is still active for `required-artifacts-present`. The move itself is made
 *    by `openspec archive` and judged by CI on the archive-PR, where the same
 *    gates see it in the diff.
 * 4. Only when every gate is `PASS`, `WAIVED` or `NOT_APPLICABLE`:
 *    `openspec archive <change> --yes --json`, then the transition `ARCHIVED`
 *    (`by: "cli:local"`, `gates{}`, `evidence[]`). On `GATES_NOT_PASSED`
 *    OpenSpec is not called, nothing moves and the record is unchanged.
 */
import type { Ctx } from "../core/ctx.js";
import { EXIT, WarrantError, type ExitCode } from "../core/errors.js";
import { readGitFacts } from "../core/gates/diff.js";
import { findChangeDir } from "../core/init/scaffold.js";
import { loadPacks } from "../core/packs/loader.js";
import type { PackObject } from "../core/packs/types.js";
import { readChangeRecord } from "../core/record/read.js";
import { appendTransition, assertNotFrozen, recordPath, stateOfRecord } from "../core/record/write.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { checksForTransition, executeChecks } from "./check.js";
import { requireConfigPath } from "./context.js";
import {
  artifactStatuses,
  conflictDecision,
  decisionFields,
  evaluateTransition,
  evaluationFindings,
  projectFacts,
  recordVerdicts,
  resolveRecord
} from "./gate.js";
import { forwardEntry, gatesNotPassed, gatesNotPassedResult } from "./transition.js";

export const ARCHIVE_TRANSITION = "MERGED->ARCHIVED";

/** The check whose command is `openspec validate <change> --strict --json` (core-sdd). */
export const OPENSPEC_VALIDATE_CHECK = "openspec-validate";

export async function runArchive(ctx: Ctx, change: string, env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  const { root, warn } = ctx;
  requireConfigPath(root);
  const record = readChangeRecord(root, change);
  assertNotFrozen(record, change);
  const state = stateOfRecord(record);
  if (state !== "MERGED") {
    throw new WarrantError("STATE_INVALID", `archive needs change_state MERGED; "${change}" is ${state}`, { path: recordPath(change) });
  }
  if (findChangeDir(root, change)?.where !== "active") {
    throw new WarrantError("CHANGE_NOT_FOUND", `openspec/changes/${change}/ is not an active change directory`, {
      path: `openspec/changes/${change}`
    });
  }

  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) return failures(loaded.errors, EXIT.CONFIG, {}, change);
  const transition = ARCHIVE_TRANSITION;
  const resolved = resolveRecord(loaded, change, record);
  if (!resolved.ok) {
    if (!resolved.conflict) return failures(resolved.errors, EXIT.CONFIG, {}, change);
    const decision = conflictDecision(loaded, record);
    return failures([resolved.error], EXIT.WAIT, { transition, checks: [], gates: {}, findings: [], ...decisionFields(decision) }, change);
  }
  const policy = resolved.policy;

  // Checks of the transition, and always the strict OpenSpec validation (REQ-VER-008).
  const selected: PackObject[] = checksForTransition(loaded, policy, transition);
  const validateCheck = loaded.objects.find((o) => o.kind === "check" && o.id === OPENSPEC_VALIDATE_CHECK);
  if (validateCheck !== undefined && !selected.some((o) => o.id === OPENSPEC_VALIDATE_CHECK)) selected.push(validateCheck);
  selected.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const git = await readGitFacts(ctx, undefined);
  const run = await executeChecks({ ctx, change, loaded, policy, selected, facts: git, paths: undefined, env });

  const evaluation = await evaluateTransition({
    ctx,
    change,
    record,
    loaded,
    policy,
    transition,
    facts: await projectFacts(ctx, git),
    artifacts: await artifactStatuses(ctx, change),
    env,
    checkFailures: run.failures
  });
  recordVerdicts(root, change, env, evaluation.engine.gates);

  const data: Record<string, unknown> = {
    transition,
    checks: run.entries,
    gates: evaluation.engine.gates,
    findings: evaluationFindings(evaluation),
    ...decisionFields(evaluation.decision),
    effective_policy: { hash: policy.hash, risk_level: policy.risk_level }
  };

  const failed = gatesNotPassed(evaluation.engine.gates);
  if (failed.length > 0) {
    const refused = gatesNotPassedResult(change, data, evaluation, failed);
    const code = Math.max(refused.exitCode, run.exitCode) as ExitCode;
    return failures([...run.errors, ...refused.errors], code, data, change);
  }
  for (const error of run.errors) warn(`archive: ${error.code}: ${error.message}\n`);

  const archived = await ctx.openspec.archive(change);
  const location = findChangeDir(root, change);
  // The move is the act: once the directory is in archive/, the transition is written.
  if (location?.where !== "archive") {
    const detail = archived.output.trim().split("\n")[0] ?? "";
    return failures(
      [
        {
          code: "OPENSPEC_FAILED",
          message: `openspec archive ${change} --yes --json did not archive the change${detail === "" ? "" : `: ${detail}`}`,
          path: `openspec/changes/${change}`
        }
      ],
      EXIT.CONFIG,
      data,
      change
    );
  }

  if (!archived.ok) warn(`archive: openspec archive exited with an error, but ${location.path} exists; recording ARCHIVED\n`);

  const entry = forwardEntry("ARCHIVED", policy, evaluation, undefined);
  appendTransition(root, change, record, entry);
  return success({ ...data, archive: location.path, change_state: "ARCHIVED", recorded: entry }, change);
}
