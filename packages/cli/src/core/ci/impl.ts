/**
 * The merge verdict of an impl-PR (REQ-VER-011 «impl», N34, design §4 of
 * phase-4c): the checks of `VERIFYING->MERGED` run on the working tree of HEAD
 * (the result of the merge) and write evidence into the working copy — commit
 * HEAD^2, `base_commit` HEAD^1, `tree` the tree of HEAD — then the gates judge
 * HEAD^2 against `merge-base(HEAD^1, HEAD^2)` by the policy of the base. The
 * kinds the checks produce count only from this run (ADR-0010 п. 3). A gate
 * `FAIL` or `BLOCKED` is a violation, except a gate that only `warrant
 * transition` can feed (`human-approval`): it is deferred.
 */
import { checksForTransition, executeChecks, type ChecksRun } from "../check/execute.js";
import { canonicalHash } from "../canon/hash.js";
import { loadConfig } from "../config.js";
import type { Ctx } from "../ctx.js";
import { cliError, EXIT, type CliError, type ExitCode } from "../errors.js";
import { HUMAN_APPROVAL } from "../evidence/approval.js";
import { artifactName } from "../evidence/attestation.js";
import { evidenceDir } from "../evidence/store.js";
import { reportPath } from "../fs.js";
import { MERGE_TRANSITION, PASSING_VERDICTS, type Finding, type Verdict } from "../gates/types.js";
import type { GitFacts } from "../git/facts.js";
import { isPlainObject, strings } from "../json.js";
import { effectiveCheck, gateDefinitions } from "../packs/objects.js";
import type { ChangeRecord } from "../record/read.js";
import { judgeGates, prepare, type Prepared } from "../transition/evaluate.js";
import { evaluationFindings, hooksFindings } from "../transition/gates.js";
import type { BaseContext } from "./base.js";
import type { CiSubject } from "./kind.js";

export interface ImplJudgement {
  gates: Record<string, Verdict>;
  deferred: string[];
  findings: Finding[];
  /** Ids of the records this run wrote. */
  evidence: string[];
  artifact: { name: string; path: string };
  /** Violations (exit 1) and failures of checks or configuration (exit 3). */
  errors: CliError[];
  exitCode: ExitCode;
}

/** The attempt of the run the workflow uploads the artifact of (`GITHUB_RUN_ATTEMPT`, else 1). */
function runAttempt(env: NodeJS.ProcessEnv): string {
  const attempt = env["GITHUB_RUN_ATTEMPT"];
  return attempt !== undefined && attempt !== "" ? attempt : "1";
}

/** Gates whose `requires_evidence` holds only kinds `warrant transition` writes (`human-approval`). */
function transitionFed(loaded: Prepared["loaded"], gate: string): boolean {
  const required = gateDefinitions(loaded).get(gate)?.["requires_evidence"];
  const kinds = Array.isArray(required) ? required.map((r) => (isPlainObject(r) ? r["kind"] : undefined)) : [];
  return kinds.length > 0 && kinds.every((k) => k === HUMAN_APPROVAL);
}

/** `ROLES_CHANGED` when the pull request changes `roles` of `warrant.json`: waivers are still judged by the base. */
function rolesFinding(ctx: Pick<Ctx, "root">, base: BaseContext): Finding[] {
  let head;
  try {
    head = loadConfig(ctx.root);
  } catch {
    return [];
  }
  const same = canonicalHash(Object.fromEntries(base.loaded.config.roles)) === canonicalHash(Object.fromEntries(head.roles));
  return same
    ? []
    : [{ code: "ROLES_CHANGED", message: "the pull request changes roles of .warrant/warrant.json: approvers are those of the base until it is merged" }];
}

/** The git facts of the head of the pull request inside the result of its merge. */
export async function mergeFacts(ctx: Pick<Ctx, "git">, subject: CiSubject): Promise<GitFacts> {
  const facts: GitFacts = { commonDir: await ctx.git.commonDir(), commit: subject.head, limitations: [] };
  const base = await ctx.git.mergeBase(subject.base, subject.head);
  if (base !== null) facts.baseCommit = base;
  else facts.limitations.push(`no base: merge-base(${subject.base}, ${subject.head}) unknown`);
  const tree = await ctx.git.treeId(subject.merge);
  if (tree !== null) facts.mergeResult = { tree, baseTip: subject.base };
  return facts;
}

/**
 * Checks and gates of `VERIFYING->MERGED` of the Change of `subject` by the
 * packs of `base`. Throws what `prepare` throws; a broken configuration of the
 * base or a policy conflict comes back as errors with exit 3.
 */
export async function judgeImpl(ctx: Ctx, subject: CiSubject, base: BaseContext, env: NodeJS.ProcessEnv): Promise<ImplJudgement | { errors: CliError[]; exitCode: ExitCode }> {
  const change = subject.change as string;
  const record = subject.record as ChangeRecord;
  const prepared = prepare(ctx, change, { transition: MERGE_TRANSITION, env, record, loaded: base.loaded });
  if (!prepared.ok) return { errors: prepared.conflict ? [prepared.error] : prepared.errors, exitCode: EXIT.CONFIG };

  const git = await mergeFacts(ctx, subject);
  const selected = checksForTransition(base.loaded, prepared.policy, MERGE_TRANSITION);
  const run: ChecksRun = await executeChecks({ ctx, change, loaded: base.loaded, policy: prepared.policy, selected, facts: git, paths: undefined, env });
  const produced = new Set(selected.flatMap((o) => strings(effectiveCheck(o)["produces"])));
  const written = new Set(run.records.map((r) => r.id));
  const admit = (r: { id: string; json: Record<string, unknown> }): boolean => !produced.has(String(r.json["kind"])) || written.has(r.id);
  const evaluation = await judgeGates(ctx, change, { ...prepared, admit }, git, run);

  const gates = evaluation.engine.gates;
  const deferred: string[] = [];
  const errors: CliError[] = [...run.errors];
  for (const [gate, verdict] of Object.entries(gates)) {
    if (PASSING_VERDICTS.has(verdict)) continue;
    if (transitionFed(base.loaded, gate)) {
      deferred.push(gate);
      continue;
    }
    errors.push(
      cliError("GATE_NOT_PASSED", `gate ${gate} of ${MERGE_TRANSITION} is ${verdict}`, {
        hint: `see data.findings[] for ${gate}; fix the pull request and re-run the job`
      })
    );
  }
  const state = record["change_state"];
  if (state !== "VERIFYING") {
    errors.push(
      cliError("CHANGE_NOT_VERIFYING", `${change} is ${String(state)}: an impl-PR is ready to merge in VERIFYING`, {
        hint: `run \`warrant transition ${change} VERIFYING\` when the implementation is complete`
      })
    );
  }
  const findings = [
    ...evaluationFindings(evaluation),
    ...hooksFindings(ctx, change, evaluation, base.loaded.config, env),
    ...rolesFinding(ctx, base)
  ];
  const exitCode = (run.exitCode > EXIT.OK ? run.exitCode : errors.length > 0 ? EXIT.FAIL : EXIT.OK) as ExitCode;
  return {
    gates,
    deferred: deferred.sort(),
    findings,
    evidence: [...written].sort(),
    artifact: { name: artifactName(change, runAttempt(env)), path: reportPath(evidenceDir(ctx.root, change, env), ctx.root) },
    errors,
    exitCode
  };
}
