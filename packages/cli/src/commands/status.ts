/**
 * `warrant status [change]` (REQ-KRN-027): the record of a Change next to the
 * signals derived from the working tree.
 *
 * What is reported per Change is `change_state` and `classification` from the
 * record, the hash, sources and `risk_level` of the effective policy, the
 * OpenSpec artifact statuses, `stale[]`, the computed back-links
 * `amended_by[]` / `superseded_by[]` (ADR-0021 point 5) and `verification`:
 * the gates of the next forward transition judged by the evidence already
 * recorded — the gate engine without the runner, no check is started
 * (design §12). A Change without a next transition (`ARCHIVED`, `ABANDONED`)
 * has `verification: null`. Without an argument `data.rules` counts the path
 * rules and those without `enforced_by` (ADR-0022 point 4).
 *
 * Nothing here fails because a derived signal is missing: a Change whose
 * directory is gone still gets its record printed, with `artifacts: {}` and the
 * reason in `stale[]`; a gate whose input is missing (no git, no `openspec`)
 * is `BLOCKED` with a finding, not an error of the command.
 */
import { EXIT, type CliError } from "../core/errors.js";
import { readGitFacts, type Availability } from "../core/gates/diff.js";
import type { Finding, Verdict } from "../core/gates/types.js";
import { findChangeDir } from "../core/init/scaffold.js";
import { openspecAvailable } from "../core/openspec/cli.js";
import { openspecStatus, type ArtifactStatuses } from "../core/openspec/status.js";
import { loadPacks } from "../core/packs/loader.js";
import {
  listChangeNames,
  readAllRecords,
  readChangeRecord,
  type ChangeRecord,
  type RecordFile
} from "../core/record/read.js";
import { backLinks } from "../core/validate/links.js";
import { rulesSummary } from "../core/validate/rules.js";
import { computeStale, type StaleEntry } from "../core/status/stale.js";
import { resolveForProject, type Classification } from "../core/resolve/index.js";
import type { LoadResult } from "../core/packs/types.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { nextForwardTransition } from "./check.js";
import { projectRoot, requireConfigPath } from "./context.js";
import { conflictDecision, decisionFields, evaluateTransition, evaluationFindings, projectFacts, type ProjectFacts } from "./gate.js";

/** One Change as `data` (single form) or as one entry of `data.changes[]`. */
export interface ChangeStatus {
  change: string;
  change_state: string;
  /** The record's classification, or `null` when it has none — the key is always present. */
  classification: Record<string, unknown> | null;
  /** `null` only when the policy could not be resolved; the conflict is then in `errors[]`. */
  effective_policy: { hash: string; sources: unknown; risk_level: string } | null;
  artifacts: ArtifactStatuses;
  stale: StaleEntry[];
  /** Records whose `amends` names this Change; computed, never stored in the record. */
  amended_by: string[];
  /** Records whose `supersedes` names this Change; computed, never stored in the record. */
  superseded_by: string[];
  /** Gates of the next forward transition by recorded evidence; null without a next transition. */
  verification: Verification | null;
}

/** `status.verification` (REQ-KRN-027): `transition`, `gates`, `findings[]`, `controller_action`, `next`?, `rule`. */
export interface Verification {
  transition: string;
  gates: Record<string, Verdict>;
  findings: Finding[];
  controller_action: string;
  next?: string;
  rule: string | null;
}

function statusOf(
  root: string,
  change: string,
  record: ChangeRecord,
  loaded: LoadResult,
  warn: (text: string) => void,
  hasOpenspec: boolean,
  records: ReadonlyMap<string, RecordFile>,
  facts: () => ProjectFacts,
  env: NodeJS.ProcessEnv
): { status: ChangeStatus; errors: CliError[] } {
  const changeState = String(record["change_state"]);
  const location = findChangeDir(root, change);
  const stale = computeStale(change, location, changeState);

  // OpenSpec can only answer for a directory it still owns; for a missing or
  // archived change the call would fail and `stale[]` already says why.
  let artifacts: ArtifactStatuses = {};
  let known: Availability<ArtifactStatuses> = {
    ok: false,
    reason: `openspec/changes/${change}/ is not an active change directory`
  };
  if (location?.where === "active") {
    if (!hasOpenspec) {
      warn("status: artifacts skipped: `openspec` is not on PATH\n");
      known = { ok: false, reason: "`openspec` is not on PATH" };
    } else {
      const run = openspecStatus(change, root);
      artifacts = run.artifacts;
      if (run.warning !== undefined) {
        warn(`status: ${run.warning}\n`);
        known = { ok: false, reason: run.warning };
      } else {
        known = { ok: true, value: run.artifacts };
      }
    }
  }
  const transition = nextForwardTransition(changeState);

  const errors: CliError[] = [];
  let effectivePolicy: ChangeStatus["effective_policy"] = null;
  let verification: Verification | null = null;
  const resolved = resolveForProject(loaded, record["classification"] as Classification | undefined);
  if (resolved.errors.length > 0) {
    errors.push(...resolved.errors);
  } else if (!resolved.result.ok) {
    // A conflict is never hidden: same code and escalation as `resolve` (SCN-KRN-067).
    errors.push({ code: "POLICY_CONFLICT", message: `${change}: ${resolved.result.conflict.message}` });
    if (transition !== null) {
      verification = {
        transition,
        gates: {},
        findings: [],
        ...(decisionFields(conflictDecision(loaded, record)) as Pick<Verification, "controller_action" | "rule">)
      };
    }
  } else {
    const policy = resolved.result.policy;
    effectivePolicy = { hash: policy.hash, sources: policy.sources, risk_level: policy.risk_level };
    if (transition !== null) {
      const evaluation = evaluateTransition({
        root,
        change,
        record,
        loaded,
        policy,
        transition,
        facts: facts(),
        artifacts: known,
        env
      });
      verification = {
        transition,
        gates: evaluation.engine.gates,
        findings: evaluationFindings(evaluation),
        ...(decisionFields(evaluation.decision) as Pick<Verification, "controller_action" | "rule">)
      };
    }
  }

  return {
    status: {
      change,
      change_state: changeState,
      classification: (record["classification"] as Record<string, unknown> | undefined) ?? null,
      effective_policy: effectivePolicy,
      artifacts,
      stale,
      ...backLinks(change, records),
      verification
    },
    errors
  };
}

export function runStatus(
  change: string | undefined,
  root: string = projectRoot(),
  warn: (text: string) => void = (text) => process.stderr.write(text),
  env: NodeJS.ProcessEnv = process.env
): CommandResult {
  requireConfigPath(root);

  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) return failures(loaded.errors, EXIT.CONFIG, {}, change);

  const hasOpenspec = openspecAvailable();
  const names = change === undefined || change === "" ? listChangeNames(root) : [change];
  // `readChangeRecord` throws CHANGE_NOT_FOUND (exit 3) for the single form;
  // in the list form every name came from a file, so it cannot throw that.
  const records = names.map((name) => ({ name, record: readChangeRecord(root, name) }));

  // Back-links look at every record, also in the single form.
  const all = readAllRecords(root);

  // Git facts, ids and waivers are the same for every Change: read once, and
  // only when some Change has a transition to judge.
  let facts: ProjectFacts | undefined;
  const sharedFacts = (): ProjectFacts => (facts ??= projectFacts(root, readGitFacts(root, undefined)));

  const statuses: ChangeStatus[] = [];
  const errors: CliError[] = [];
  for (const { name, record } of records) {
    const one = statusOf(root, name, record, loaded, warn, hasOpenspec, all, sharedFacts, env);
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

  const data = { changes: statuses, rules: rulesSummary(loaded.rules) };
  if (errors.length > 0) return failures(errors, exitCode, { ...data, ...escalation });
  return success(data);
}
