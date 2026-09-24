/**
 * The scenario of judging a transition (ADR-0030 п. 3): packs → policy → git
 * facts → checks → gates → controller → verdicts in the manifest. `gate`,
 * `verify` and `archive` call `evaluate`; `transition` calls its two halves
 * around its own git facts and the human act (`prepare`, then `judgeGates`);
 * `status` calls the steps without writing anything.
 *
 * What differs between the commands is an option here, never a merged
 * behaviour: which checks run (none for `gate`), the gate ids named on the
 * command line, `--paths`, `--base`, and a record the command read before the
 * packs (`archive`, `transition` check its state first).
 */
import { executeChecks, type ChecksRun } from "../check/execute.js";
import { splitPaths } from "../check/placeholders.js";
import type { ControllerDecision } from "../controller/evaluate.js";
import type { Ctx } from "../ctx.js";
import { WarrantError, type CliError } from "../errors.js";
import { readGitFacts, type GitFacts } from "../git/facts.js";
import { loadPacks } from "../packs/loader.js";
import type { LoadResult, PackObject } from "../packs/types.js";
import { readChangeRecord, type ChangeRecord } from "../record/read.js";
import type { EffectivePolicy } from "../resolve/index.js";
import { artifactStatuses, projectFacts } from "./facts.js";
import { evaluateTransition, recordVerdicts, type Evaluation } from "./gates.js";
import { checkedIds, conflictDecision, resolveRecord, transitionOf } from "./policy.js";

/** The checks that run before the gates, chosen once the policy is known. */
export type CheckSelection = (loaded: LoadResult, policy: EffectivePolicy, transition: string) => PackObject[];

export interface EvaluateOptions {
  /** `--transition <FROM->TO>`; default — the next forward transition from `change_state`. */
  transition?: string | undefined;
  /** Checks to run before the gates; absent — none run and the gates judge recorded evidence only. */
  checks?: CheckSelection | undefined;
  /** `--base <ref>`; default `merge-base(HEAD, main)`. */
  base?: string | undefined;
  /** `--paths a,b` as given: checks run their `scoped_command` (D-12). */
  paths?: string | undefined;
  env: NodeJS.ProcessEnv;
  /** The record, when the command read it before the packs; read here otherwise. */
  record?: ChangeRecord | undefined;
  /** Gate ids named on the command line: only these are judged. */
  gates?: string[] | undefined;
}

/**
 * Why no evaluation took place: the packs or the policy layers are broken
 * (exit 3), or the policy could not be composed — the controller's decision
 * on the conflict comes with it (`policy-conflict`, exit 2).
 */
export type Refusal =
  | { ok: false; conflict: false; errors: CliError[] }
  | { ok: false; conflict: true; error: CliError; transition: string; decision: ControllerDecision };

/** Everything known before git: packs, record, transition, effective policy. */
export interface Prepared {
  ok: true;
  loaded: LoadResult;
  record: ChangeRecord;
  transition: string;
  policy: EffectivePolicy;
  /** Gate ids to judge; undefined — all gates of the transition. */
  only: string[] | undefined;
  paths: string[] | undefined;
  env: NodeJS.ProcessEnv;
}

export interface Evaluated<Run extends ChecksRun | undefined = ChecksRun | undefined> {
  ok: true;
  loaded: LoadResult;
  record: ChangeRecord;
  policy: EffectivePolicy;
  /** The checks run before the gates; undefined when none were asked for. */
  run: Run;
  evaluation: Evaluation;
}

/**
 * Packs, record, transition and policy. Throws what the steps throw (USAGE
 * for a transition, gate id or `--paths` that cannot be used,
 * CHANGE_NOT_FOUND for a missing record); a broken configuration or a policy
 * conflict is returned.
 */
export function prepare(ctx: Ctx, change: string, opts: EvaluateOptions): Prepared | Refusal {
  const loaded = loadPacks(ctx.root);
  if (loaded.errors.length > 0) return { ok: false, conflict: false, errors: loaded.errors };
  const record = opts.record ?? readChangeRecord(ctx.root, change);
  const transition = transitionOf(record, opts.transition);

  const resolved = resolveRecord(loaded, change, record);
  if (!resolved.ok) {
    if (!resolved.conflict) return { ok: false, conflict: false, errors: resolved.errors };
    return { ok: false, conflict: true, error: resolved.error, transition, decision: conflictDecision(loaded, record) };
  }
  const only = opts.gates === undefined ? undefined : checkedIds(opts.gates, loaded, resolved.policy, transition);

  const paths = opts.paths === undefined ? undefined : splitPaths(opts.paths);
  if (paths !== undefined && paths.length === 0) throw new WarrantError("USAGE", "--paths lists no path");

  return { ok: true, loaded, record, transition, policy: resolved.policy, only, paths, env: opts.env };
}

/**
 * Gates and controller on the given git facts, after the checks of `run`
 * (their failures block the gates they feed); the verdicts are written into
 * the manifest of the Change.
 */
export async function judgeGates(ctx: Ctx, change: string, prepared: Prepared, git: GitFacts, run: ChecksRun | undefined): Promise<Evaluation> {
  const evaluation = await evaluateTransition({
    ctx,
    change,
    record: prepared.record,
    loaded: prepared.loaded,
    policy: prepared.policy,
    transition: prepared.transition,
    facts: await projectFacts(ctx, git),
    artifacts: await artifactStatuses(ctx, change),
    env: prepared.env,
    only: prepared.only,
    ...(run === undefined ? {} : { checkFailures: run.failures })
  });
  recordVerdicts(ctx.root, change, prepared.env, evaluation.engine.gates);
  return evaluation;
}

/** The whole scenario: prepare → git facts (one set for checks and gates) → checks → judgeGates. */
export async function evaluate(ctx: Ctx, change: string, opts: EvaluateOptions & { checks: CheckSelection }): Promise<Evaluated<ChecksRun> | Refusal>;
export async function evaluate(ctx: Ctx, change: string, opts: EvaluateOptions): Promise<Evaluated | Refusal>;
export async function evaluate(ctx: Ctx, change: string, opts: EvaluateOptions): Promise<Evaluated | Refusal> {
  const prepared = prepare(ctx, change, opts);
  if (!prepared.ok) return prepared;
  const { loaded, policy, transition } = prepared;

  const git = await readGitFacts(ctx, opts.base);
  const run =
    opts.checks === undefined
      ? undefined
      : await executeChecks({
          ctx,
          change,
          loaded,
          policy,
          selected: opts.checks(loaded, policy, transition),
          facts: git,
          paths: prepared.paths,
          env: prepared.env
        });

  const evaluation = await judgeGates(ctx, change, prepared, git, run);
  return { ok: true, loaded, record: prepared.record, policy, run, evaluation };
}
