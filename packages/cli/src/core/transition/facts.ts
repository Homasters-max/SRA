/**
 * Facts a transition is judged on, gathered through `ctx` (design §8, §9):
 * git facts of the project, stable-id findings, waivers, the artifact
 * statuses of OpenSpec, the contract trees `spec-approved` compares, the spec
 * tree the pre-filter compares `subject.spec_tree` with, the tree of the merge
 * it compares `subject.tree` with and the findings of `analyze`
 * `analyze-clean` judges by.
 */
import { analyze, type AnalyzeResult } from "../analyze/index.js";
import { analyzePaths, readAnalyzeInput } from "../analyze/input.js";
import type { WarrantConfig } from "../config.js";
import type { Ctx } from "../ctx.js";
import type { CliError } from "../errors.js";
import { NO_GIT_COMMIT, subjectOf } from "../evidence/record.js";
import {
  changedPaths,
  contractTree,
  currentBranch,
  mergeTreeOf,
  specTreeHash,
  type Availability,
  type DiffEntry,
  type GitFacts
} from "../git/facts.js";
import { commitFiles } from "../git/files.js";
import { approvalOf } from "../gates/l0/spec-approved.js";
import type { ContractTrees, EvidenceInput } from "../gates/types.js";
import { checkAreas, checkDuplicates, loadAreas, scanIds } from "../ids/scan.js";
import { findChangeDir } from "../openspec/changes.js";
import { openspecAvailable } from "../openspec/version.js";
import type { ArtifactStatuses } from "../ports/openspec.js";
import type { ChangeRecord } from "../record/read.js";
import { readWaivers } from "../waivers/read.js";

/** Check (5) of `validate` without placement (design §8); never throws. */
export function idFindings(root: string): Availability<CliError[]> {
  try {
    const scan = scanIds(root);
    return { ok: true, value: [...scan.malformed, ...checkAreas(scan.ids, loadAreas(root)), ...checkDuplicates(scan.ids)] };
  } catch (thrown) {
    return { ok: false, reason: `stable ids could not be scanned: ${(thrown as Error).message}` };
  }
}

/** Artifact statuses of an active change directory; the reason otherwise. */
export async function artifactStatuses(ctx: Ctx, change: string): Promise<Availability<ArtifactStatuses>> {
  const location = findChangeDir(ctx.root, change);
  if (location?.where !== "active") {
    return { ok: false, reason: `openspec/changes/${change}/ is not an active change directory` };
  }
  if (!(await openspecAvailable(ctx.openspec))) return { ok: false, reason: "`openspec` is not on PATH" };
  const run = await ctx.openspec.status(change);
  if (run.warning !== undefined) return { ok: false, reason: run.warning };
  return { ok: true, value: run.artifacts };
}

/** Facts shared by every Change of one command call. */
export interface ProjectFacts {
  git: GitFacts;
  diff: Availability<DiffEntry[]>;
  branch: Availability<string>;
  ids: Availability<CliError[]>;
  waivers: ReturnType<typeof readWaivers>;
  today: string;
}

export async function projectFacts(ctx: Ctx, git: GitFacts): Promise<ProjectFacts> {
  return {
    git,
    diff: await changedPaths(ctx, git),
    branch: await currentBranch(ctx, git),
    ids: idFindings(ctx.root),
    waivers: readWaivers(ctx.root),
    today: ctx.clock.today()
  };
}

/**
 * The contract trees `spec-approved` compares (design §6): the approval commit
 * from the record and its evidence, the evaluated commit from the git facts.
 */
export async function contractTrees(
  ctx: Ctx,
  change: string,
  record: ChangeRecord,
  records: readonly EvidenceInput[],
  git: GitFacts
): Promise<Availability<ContractTrees>> {
  if (git.commonDir === null || git.commit === NO_GIT_COMMIT) {
    return { ok: false, reason: "the project is not a git repository with a commit" };
  }
  const approval = approvalOf(record, records);
  if (!approval.ok) return approval;
  const approved = await contractTree(ctx, approval.value.commit, change);
  if (!approved.ok) return { ok: false, reason: `approval commit of ${approval.value.evidence}: ${approved.reason}` };
  const evaluated = await contractTree(ctx, git.commit, change);
  if (!evaluated.ok) return { ok: false, reason: `evaluated commit: ${evaluated.reason}` };
  return {
    ok: true,
    value: {
      evidence: approval.value.evidence,
      approved: { commit: approval.value.commit, tree: approved.value },
      evaluated: { commit: git.commit, tree: evaluated.value }
    }
  };
}

/**
 * The spec tree of the Change on the evaluated commit (design §5, REQ-VER-003),
 * when some record carries `subject.spec_tree`; undefined when none does —
 * git is not asked for nothing. Never throws.
 */
export async function specTreeFacts(
  ctx: Ctx,
  change: string,
  records: readonly EvidenceInput[],
  git: GitFacts
): Promise<Availability<string> | undefined> {
  const bound = records.some((r) => subjectOf(r.json)?.specTree !== undefined);
  if (!bound) return undefined;
  if (git.commonDir === null || git.commit === NO_GIT_COMMIT) {
    return { ok: false, reason: "the project is not a git repository with a commit" };
  }
  return specTreeHash(ctx, git.commit, change);
}

/**
 * The tree of the result of the merge of the evaluated commit (ADR-0037 п. 2,
 * design §3 of phase-4c: M on the first-parent line of HEAD), when some record
 * carries `subject.tree`; undefined when none does. Never throws.
 */
export async function mergeTreeFacts(ctx: Ctx, records: readonly EvidenceInput[], git: GitFacts): Promise<Availability<string> | undefined> {
  const bound = records.some((r) => subjectOf(r.json)?.tree !== undefined);
  if (!bound) return undefined;
  if (git.commonDir === null || git.commit === NO_GIT_COMMIT) {
    return { ok: false, reason: "the project is not a git repository with a commit" };
  }
  return mergeTreeOf(ctx, git.commit);
}

/**
 * `analyze` of an active Change on the diff `scope-valid` judges (design §5,
 * REQ-VER-004), over the files of the evaluated commit, not the working tree
 * (R-21: on `transition MERGED` in an archive branch the working tree is not
 * the head of the impl-PR). Unavailable without that diff or the change
 * directory at the commit; never throws.
 */
export async function analyzeFacts(
  ctx: Ctx,
  change: string,
  config: WarrantConfig,
  git: GitFacts,
  diff: Availability<DiffEntry[]>
): Promise<Availability<AnalyzeResult>> {
  if (!diff.ok) return { ok: false, reason: `diff unknown: ${diff.reason}` };
  try {
    const files = await commitFiles(ctx, git.commit, analyzePaths(change, config));
    if (files === null) return { ok: false, reason: `the files of commit ${git.commit} could not be listed` };
    if (files.list(`openspec/changes/${change}`).length === 0) {
      return { ok: false, reason: `openspec/changes/${change}/ is not an active change directory at commit ${git.commit}` };
    }
    return { ok: true, value: analyze(readAnalyzeInput(files, change, config, diff)) };
  } catch (thrown) {
    return { ok: false, reason: `the Change could not be analyzed: ${(thrown as Error).message}` };
  }
}
