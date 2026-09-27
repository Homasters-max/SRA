/**
 * The scenario of `warrant ci` (REQ-VER-011, design §4 of phase-4c) over the
 * subject (`kind.ts`) and the base of requirements (`base.ts`): the structure
 * of the record (`record.ts`), refs through the forge (`refs.ts`), path rules
 * (`paths.ts`), the informational gates of a spec-PR, the merge verdict of an
 * impl-PR (`impl.ts`), the CI evidence and the repeated archive of an
 * archive-PR (`archive.ts`); or, under `--dry-run`, only the plan.
 */
import { checksForTransition } from "../check/execute.js";
import type { Ctx } from "../ctx.js";
import { EXIT, WarrantError, type CliError, type ExitCode } from "../errors.js";
import { evidenceDir } from "../evidence/store.js";
import { reportPath } from "../fs.js";
import { MERGE_TRANSITION, type Finding } from "../gates/types.js";
import { CONFIRMED_BY } from "../record/lifecycle.js";
import type { ChangeRecord } from "../record/read.js";
import { evaluate, prepare } from "../transition/evaluate.js";
import { createWrites } from "../writes.js";
import { replayArchive, verifyCiEvidence } from "./archive.js";
import type { BaseContext } from "./base.js";
import { judgeImpl, mergeFacts } from "./impl.js";
import type { CiSubject } from "./kind.js";
import { judgePaths, type Skipped } from "./paths.js";
import { judgeRecord, type NewTransition } from "./record.js";
import { judgeRefs } from "./refs.js";

/** The transition whose gates a spec-PR shows: the one its merge confirms. */
const APPROVAL_TRANSITION = CONFIRMED_BY.APPROVED.transition;

export interface CiVerdict {
  /** `data` in the order of REQ-VER-011. */
  data: Record<string, unknown>;
  errors: CliError[];
  exitCode: ExitCode;
}

/** The gates of `SPECIFIED->APPROVED` of a spec-PR, informational (REQ-VER-011 «spec»): nothing is written. */
async function specGates(ctx: Ctx, subject: CiSubject, base: BaseContext, env: NodeJS.ProcessEnv, skipped: Skipped[]): Promise<Record<string, string> | undefined> {
  try {
    const evaluated = await evaluate({ ...ctx, writes: createWrites(true) }, subject.change as string, {
      transition: APPROVAL_TRANSITION,
      env,
      record: subject.record as ChangeRecord,
      loaded: base.loaded,
      git: await mergeFacts(ctx, subject)
    });
    if (evaluated.ok) return evaluated.evaluation.engine.gates;
    skipped.push({ rule: "gates", reason: evaluated.conflict ? evaluated.error.message : evaluated.errors.map((e) => e.message).join("; ") });
  } catch (thrown) {
    if (!(thrown instanceof WarrantError)) throw thrown;
    skipped.push({ rule: "gates", reason: thrown.message });
  }
  return undefined;
}

function head(subject: CiSubject): Record<string, unknown> {
  const data: Record<string, unknown> = { kind: subject.kind };
  if (subject.change !== undefined) data["change"] = subject.change;
  return data;
}

/** `--dry-run`: the kind, the Change, the checks of an impl-PR and the directory they would write; no check, no forge. */
export function planPullRequest(ctx: Ctx, subject: CiSubject, base: BaseContext, env: NodeJS.ProcessEnv): CiVerdict {
  const data = head(subject);
  const change = subject.change;
  let checks: string[] = [];
  const wouldWrite: string[] = [];
  if (subject.kind === "impl" && change !== undefined) {
    const prepared = prepare(ctx, change, { transition: MERGE_TRANSITION, env, record: subject.record as ChangeRecord, loaded: base.loaded });
    if (!prepared.ok) return { data, errors: prepared.conflict ? [prepared.error] : prepared.errors, exitCode: EXIT.CONFIG };
    checks = checksForTransition(base.loaded, prepared.policy, MERGE_TRANSITION).map((o) => o.id);
    wouldWrite.push(`${reportPath(evidenceDir(ctx.root, change, env), ctx.root)}/`);
  }
  Object.assign(data, { checks, findings: [], skipped: [], dry_run: true, would_write: wouldWrite });
  return { data, errors: [], exitCode: EXIT.OK };
}

/** The new transitions as `data.transitions[]` prints them. */
function transitionData(transitions: readonly NewTransition[]): Record<string, unknown>[] {
  return transitions.map((t) => {
    const out: Record<string, unknown> = { to: t.to, at: t.entry["at"] };
    if (typeof t.entry["ref"] === "string") out["ref"] = t.entry["ref"];
    return out;
  });
}

/** Judges the pull request of `subject` by the requirements of `base`. Throws `FORGE_UNAVAILABLE` (exit 3). */
export async function judgePullRequest(ctx: Ctx, subject: CiSubject, base: BaseContext, env: NodeJS.ProcessEnv): Promise<CiVerdict> {
  const errors: CliError[] = [];
  const findings: Finding[] = [];
  const skipped: Skipped[] = [];
  const data = head(subject);
  const change = subject.change;

  let transitions: NewTransition[] = [];
  let evidence: ReadonlyMap<string, Record<string, unknown>> = new Map();
  if (change !== undefined) {
    const record = await judgeRecord(ctx, subject, base, env);
    transitions = record.transitions;
    evidence = record.evidence;
    errors.push(...record.errors);
    const refs = await judgeRefs(ctx, subject, base, record.transitions, record.evidence);
    errors.push(...refs.errors);
    findings.push(...refs.findings);
  }
  data["transitions"] = transitionData(transitions);
  const paths = await judgePaths(ctx, subject, base, transitions, env);
  errors.push(...paths.errors);
  skipped.push(...paths.skipped);

  let configExit: ExitCode = EXIT.OK;
  let verified: string[] | undefined;
  if (subject.kind === "archive" && change !== undefined) {
    const ci = await verifyCiEvidence(ctx, subject, transitions, evidence);
    errors.push(...ci.errors);
    verified = ci.verified;
    // R-16: only a new ARCHIVED repeats the archive; an archive-PR with MERGED alone has no main specs to compare (SCN-VER-106).
    if (transitions.some((t) => t.to === "ARCHIVED")) {
      const replay = await replayArchive(ctx, subject, base);
      errors.push(...replay.errors);
      if (replay.exitCode === EXIT.CONFIG) configExit = EXIT.CONFIG;
    }
  }
  let exitCode: ExitCode = configExit === EXIT.CONFIG ? EXIT.CONFIG : errors.length > 0 ? EXIT.FAIL : EXIT.OK;

  if (subject.kind === "spec" && change !== undefined) {
    const gates = await specGates(ctx, subject, base, env, skipped);
    if (gates !== undefined) data["gates"] = gates;
  }
  let impl: Awaited<ReturnType<typeof judgeImpl>> | undefined;
  if (subject.kind === "impl" && change !== undefined) {
    impl = await judgeImpl(ctx, subject, base, env);
    errors.push(...impl.errors);
    exitCode = Math.max(exitCode, impl.exitCode) as ExitCode;
    if ("gates" in impl) {
      data["gates"] = impl.gates;
      data["deferred"] = impl.deferred;
      findings.push(...impl.findings);
    }
  }
  data["findings"] = findings;
  data["skipped"] = skipped;
  if (impl !== undefined && "gates" in impl) {
    data["evidence"] = impl.evidence;
    data["artifact"] = impl.artifact;
  }
  if (verified !== undefined) data["evidence"] = verified;
  return { data, errors, exitCode };
}
