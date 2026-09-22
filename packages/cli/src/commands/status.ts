/**
 * `warrant status [change]` (REQ-KRN-027): the record of a Change next to the
 * signals derived from the working tree.
 *
 * Phase 1 reports, it does not judge: gate verdicts and `next` are out of scope
 * and the keys are absent rather than empty (REQ-KRN-027). What is reported per
 * Change is `change_state` and `classification` from the record, the hash and
 * sources of the effective policy, the OpenSpec artifact statuses and `stale[]`.
 *
 * Nothing here fails because a derived signal is missing: a Change whose
 * directory is gone still gets its record printed, with `artifacts: {}` and the
 * reason in `stale[]`.
 */
import { EXIT, type CliError } from "../core/errors.js";
import { findChangeDir } from "../core/init/scaffold.js";
import { openspecAvailable } from "../core/openspec/cli.js";
import { openspecStatus, type ArtifactStatuses } from "../core/openspec/status.js";
import { loadPacks } from "../core/packs/loader.js";
import { listChangeNames, readChangeRecord, type ChangeRecord } from "../core/record/read.js";
import { computeStale, type StaleEntry } from "../core/status/stale.js";
import { resolveForProject, type Classification } from "../core/resolve/index.js";
import type { LoadResult } from "../core/packs/types.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { projectRoot, requireConfigPath } from "./context.js";

/** One Change as `data` (single form) or as one entry of `data.changes[]`. */
export interface ChangeStatus {
  change: string;
  change_state: string;
  /** The record's classification, or `null` when it has none — the key is always present. */
  classification: Record<string, unknown> | null;
  /** `null` only when the policy could not be resolved; the conflict is then in `errors[]`. */
  effective_policy: { hash: string; sources: unknown } | null;
  artifacts: ArtifactStatuses;
  stale: StaleEntry[];
}

function statusOf(
  root: string,
  change: string,
  record: ChangeRecord,
  loaded: LoadResult,
  warn: (text: string) => void,
  hasOpenspec: boolean
): { status: ChangeStatus; errors: CliError[] } {
  const changeState = String(record["change_state"]);
  const location = findChangeDir(root, change);
  const stale = computeStale(change, location, changeState);

  // OpenSpec can only answer for a directory it still owns; for a missing or
  // archived change the call would fail and `stale[]` already says why.
  let artifacts: ArtifactStatuses = {};
  if (location?.where === "active") {
    if (!hasOpenspec) {
      warn("status: artifacts skipped: `openspec` is not on PATH\n");
    } else {
      const run = openspecStatus(change, root);
      artifacts = run.artifacts;
      if (run.warning !== undefined) warn(`status: ${run.warning}\n`);
    }
  }

  const errors: CliError[] = [];
  let effectivePolicy: ChangeStatus["effective_policy"] = null;
  const resolved = resolveForProject(loaded, record["classification"] as Classification | undefined);
  if (resolved.errors.length > 0) {
    errors.push(...resolved.errors);
  } else if (!resolved.result.ok) {
    // A conflict is never hidden: same code and escalation as `resolve` (SCN-KRN-067).
    errors.push({ code: "POLICY_CONFLICT", message: `${change}: ${resolved.result.conflict.message}` });
  } else {
    effectivePolicy = { hash: resolved.result.policy.hash, sources: resolved.result.policy.sources };
  }

  return {
    status: {
      change,
      change_state: changeState,
      classification: (record["classification"] as Record<string, unknown> | undefined) ?? null,
      effective_policy: effectivePolicy,
      artifacts,
      stale
    },
    errors
  };
}

export function runStatus(
  change: string | undefined,
  root: string = projectRoot(),
  warn: (text: string) => void = (text) => process.stderr.write(text)
): CommandResult {
  requireConfigPath(root);

  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) return failures(loaded.errors, EXIT.CONFIG, {}, change);

  const hasOpenspec = openspecAvailable();
  const names = change === undefined || change === "" ? listChangeNames(root) : [change];
  // `readChangeRecord` throws CHANGE_NOT_FOUND (exit 3) for the single form;
  // in the list form every name came from a file, so it cannot throw that.
  const records = names.map((name) => ({ name, record: readChangeRecord(root, name) }));

  const statuses: ChangeStatus[] = [];
  const errors: CliError[] = [];
  for (const { name, record } of records) {
    const one = statusOf(root, name, record, loaded, warn, hasOpenspec);
    statuses.push(one.status);
    errors.push(...one.errors);
  }

  // A conflict escalates (exit 2); a broken layer is a configuration fault (exit 3).
  const onlyConflicts = errors.every((error) => error.code === "POLICY_CONFLICT");
  const exitCode = onlyConflicts ? EXIT.WAIT : EXIT.CONFIG;
  const escalation = onlyConflicts ? { controller_action: "ESCALATE" } : {};

  if (change !== undefined && change !== "") {
    const only = statuses[0] as ChangeStatus;
    // The payload stays: `status` must report the stale signals it found even
    // when the policy escalates.
    if (errors.length > 0) return failures(errors, exitCode, { ...only, ...escalation }, change);
    return success({ ...only }, change);
  }

  const data = { changes: statuses };
  if (errors.length > 0) return failures(errors, exitCode, { ...data, ...escalation });
  return success(data);
}
