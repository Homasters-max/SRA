/**
 * `warrant verify <change> [--transition <FROM->TO>] [--base <ref>] [--paths <a,b>]`
 * (REQ-VER-006, P-20): the checks of the transition (the code of `check`),
 * then the gates (the code of `gate`), then the controller.
 *
 * A failed check (`CHECK_TIMEOUT`, `BUSY`, `CHECK_NOT_CONFIGURED`,
 * `CHECK_LOCAL_FORBIDDEN`) does not stop the gates: its gates are `BLOCKED`,
 * the failure is in `errors[]` and the exit code is the highest of the
 * failure's and the controller's.
 */
import { splitPaths } from "../core/check/placeholders.js";
import { exitCodeOf } from "../core/controller/evaluate.js";
import { EXIT, WarrantError, type ExitCode } from "../core/errors.js";
import { readGitFacts } from "../core/gates/diff.js";
import { openspecAvailable } from "../core/openspec/cli.js";
import { loadPacks } from "../core/packs/loader.js";
import { readChangeRecord } from "../core/record/read.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { checksForTransition, executeChecks } from "./check.js";
import { projectRoot as defaultRoot, requireConfigPath } from "./context.js";
import {
  artifactStatuses,
  conflictDecision,
  decisionFields,
  evaluateTransition,
  gateData,
  projectFacts,
  recordVerdicts,
  resolveRecord,
  transitionOf
} from "./gate.js";

export interface VerifyOptions {
  transition?: string | undefined;
  base?: string | undefined;
  /** `--paths a,b`: checks run their `scoped_command`; their records are then `scoped:` and not admissible (D-12). */
  paths?: string | undefined;
}

export async function runVerify(
  change: string,
  opts: VerifyOptions = {},
  root: string = defaultRoot(),
  env: NodeJS.ProcessEnv = process.env,
  warn: (text: string) => void = (text) => process.stderr.write(text)
): Promise<CommandResult> {
  requireConfigPath(root);
  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) return failures(loaded.errors, EXIT.CONFIG, {}, change);
  const record = readChangeRecord(root, change);
  const transition = transitionOf(record, opts.transition);

  const resolved = resolveRecord(loaded, change, record);
  if (!resolved.ok) {
    if (!resolved.conflict) return failures(resolved.errors, EXIT.CONFIG, {}, change);
    const decision = conflictDecision(loaded, record);
    return failures(
      [resolved.error],
      EXIT.WAIT,
      { transition, checks: [], gates: {}, findings: [], ...decisionFields(decision) },
      change
    );
  }
  const policy = resolved.policy;

  const paths = opts.paths === undefined ? undefined : splitPaths(opts.paths);
  if (paths !== undefined && paths.length === 0) throw new WarrantError("USAGE", "--paths lists no path");

  // One set of git facts for the checks and the gates: both speak of the same commit and base.
  const git = readGitFacts(root, opts.base);
  const run = await executeChecks({
    root,
    change,
    loaded,
    policy,
    selected: checksForTransition(loaded, policy, transition),
    facts: git,
    paths,
    env,
    warn
  });

  const evaluation = evaluateTransition({
    root,
    change,
    record,
    loaded,
    policy,
    transition,
    facts: projectFacts(root, git),
    artifacts: artifactStatuses(root, change, openspecAvailable()),
    env,
    checkFailures: run.failures
  });
  recordVerdicts(root, change, env, evaluation.engine.gates);

  const gate = gateData(evaluation);
  const data: Record<string, unknown> = {
    transition,
    checks: run.entries,
    gates: gate["gates"],
    findings: gate["findings"],
    ...decisionFields(evaluation.decision),
    effective_policy: { hash: policy.hash, risk_level: policy.risk_level }
  };
  if (run.holder !== undefined) data["holder"] = run.holder;

  const exitCode = Math.max(run.exitCode, exitCodeOf(evaluation.decision.controller_action)) as ExitCode;
  if (exitCode === EXIT.OK && run.errors.length === 0) return success(data, change);
  return failures(run.errors, exitCode, data, change);
}
