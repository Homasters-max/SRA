/**
 * `warrant ci fetch <pr>` (REQ-VER-012, design §5 of phase-4c, ADR-0034
 * п. 14, ADR-0037 п. 4): the local step of an archive-PR. The impl-PR merged
 * by the merge commit M; its Change is the one whose record `M^1..M` changes,
 * in `VERIFYING` on M. Candidates are the successful attempts of this
 * repository's runs, newest first — `pull_request` runs of the head M^2 and
 * recovery `workflow_dispatch` runs from the default branch created after the
 * merge — each run walked from its latest attempt down to 1 (`workflowRun(id,
 * n)`, I-175). The chosen attempt is the first whose artifact holds records of
 * that attempt, all on M^2 and the tree of M (N41): not the latest run, which
 * may be `STALE` by a moved base. Its records are imported byte for byte
 * (`importRecords`) under the lock `check` takes; `manifest.json` and `raw/` of
 * the artifact stay out.
 */
import type { Ctx } from "../ctx.js";
import { cliError, EXIT, WarrantError, type CliError, type ExitCode } from "../errors.js";
import { acquireLock, lockPath } from "../check/lock.js";
import { parseCiRef } from "../evidence/attestation.js";
import { subjectOf } from "../evidence/record.js";
import { importRecords } from "../evidence/store.js";
import { manifestVersions } from "../evidence/write.js";
import { isPlainObject } from "../json.js";
import type { PullRequest, WorkflowRun } from "../ports/forge.js";
import { readSubjectOf } from "./kind.js";
import { parsePullUrl } from "./refs.js";

/** A record file at the root of an artifact; `raw/` and `manifest.json` are not records. */
const RECORD_FILE_RE = /^EVID-[0-9A-HJKMNP-TV-Z]{26}\.json$/;

export interface FetchSkipped {
  run: string;
  reason: string;
}

export interface FetchVerdict {
  data: Record<string, unknown>;
  errors: CliError[];
  exitCode: ExitCode;
  change?: string;
}

/** `ci fetch` works with the state in `.warrant`: the records travel in the archive-PR (SCN-VER-109). */
export function assertCommittedState(env: NodeJS.ProcessEnv): void {
  if (env["WARRANT_STATE_DIR"] !== undefined && env["WARRANT_STATE_DIR"] !== "") {
    throw new WarrantError("USAGE", "warrant ci fetch writes the evidence the archive-PR commits into .warrant, not into WARRANT_STATE_DIR", {
      hint: "unset WARRANT_STATE_DIR for warrant ci fetch"
    });
  }
}

/** The pull request `<pr>` names — a number or a URL — of the repository of the forge. */
async function pullOf(ctx: Pick<Ctx, "forge">, arg: string): Promise<PullRequest> {
  const byUrl = parsePullUrl(arg);
  const number = /^[1-9][0-9]*$/.test(arg) ? Number.parseInt(arg, 10) : byUrl?.number;
  if (number === undefined) {
    throw new WarrantError("USAGE", `"${arg}" is neither the number nor the URL of a pull request`, { hint: "warrant ci fetch <number | https://github.com/<owner>/<repo>/pull/<number>>" });
  }
  const pr = await ctx.forge.pullRequest(number);
  const own = pr === null ? null : parsePullUrl(pr.url);
  if (byUrl !== null && own !== null && own.repository !== byUrl.repository) {
    throw new WarrantError("USAGE", `${arg} is a pull request of ${byUrl.repository}, not of the repository of the forge ${own.repository}`, {
      hint: `pass the number of the impl-PR of ${own.repository}`
    });
  }
  if (pr === null) throw new WarrantError("PR_NOT_FOUND", `no pull request ${number} in the repository of the forge`, { hint: "pass the number of the merged impl-PR" });
  return pr;
}

/** Records of `files` (an artifact) attested by the attempt `run`, by file name. */
function recordsOf(files: ReadonlyMap<string, Buffer>, run: WorkflowRun): Map<string, { bytes: Buffer; json: Record<string, unknown> }> {
  const out = new Map<string, { bytes: Buffer; json: Record<string, unknown> }>();
  for (const [name, bytes] of files) {
    if (!RECORD_FILE_RE.test(name)) continue;
    let json: unknown;
    try {
      json = JSON.parse(bytes.toString("utf8"));
    } catch {
      continue;
    }
    const attestation = isPlainObject(json) && isPlainObject(json["attestation"]) ? json["attestation"] : {};
    const ref = attestation["type"] === "ci" && typeof attestation["ref"] === "string" ? parseCiRef(attestation["ref"]) : null;
    if (isPlainObject(json) && ref !== null && ref.id === run.id && ref.attempt === run.attempt && ref.repository === run.repository.toLowerCase()) {
      out.set(name, { bytes, json });
    }
  }
  return out;
}

/** Runs that may hold evidence of M, as their latest attempts, newest first. */
async function candidateRuns(ctx: Pick<Ctx, "forge">, pr: PullRequest, head: string): Promise<WorkflowRun[]> {
  const pulls = await ctx.forge.listRuns({ headSha: head, event: "pull_request" });
  const recovery = (await ctx.forge.listRuns({ event: "workflow_dispatch", createdAfter: pr.mergedAt as string })).filter(
    (run) => run.headBranch === pr.defaultBranch
  );
  return [...pulls, ...recovery].sort((a, b) => (a.createdAt === b.createdAt ? b.id - a.id : a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Finds and (unless `ctx.writes` is dry) imports the CI evidence of the merged
 * impl-PR `arg`. Input errors throw `WarrantError` (exit 3); nothing is written.
 */
export async function fetchCiEvidence(ctx: Ctx, arg: string, env: NodeJS.ProcessEnv): Promise<FetchVerdict> {
  assertCommittedState(env);
  const pr = await pullOf(ctx, arg);
  if (!pr.merged || pr.mergeCommit === null || pr.mergedAt === null) {
    throw new WarrantError("PR_NOT_MERGED", `pull request ${pr.number} is not merged`, { hint: "merge the impl-PR with a merge commit, then fetch its evidence" });
  }
  const m = await ctx.git.resolveCommit(pr.mergeCommit);
  if (m === null) {
    throw new WarrantError("COMMIT_NOT_FOUND", `merge commit ${pr.mergeCommit} of pull request ${pr.number} is not in the local repository`, {
      hint: "git fetch origin, then retry"
    });
  }
  const parents = await ctx.git.parents(m);
  if (parents.length !== 2 || parents[1] !== pr.headSha) {
    throw new WarrantError("PR_NOT_MERGED", `pull request ${pr.number} was not merged by a merge commit: ${m} has ${parents.length} parent(s)${parents.length === 2 ? `, the second is not the head ${pr.headSha}` : ""}`, {
      hint: "an impl-PR merges only with a merge commit (I-97): squash and rebase lose the head its evidence was made on"
    });
  }
  const [base, head] = parents as [string, string];

  const subject = await readSubjectOf(ctx, { merge: m, base, head });
  const change = subject.change;
  if (subject.errors.length > 0) return { data: { pr: pr.number, merge_commit: m }, errors: subject.errors, exitCode: EXIT.CONFIG };
  if (change === undefined) {
    throw new WarrantError("TOPOLOGY_VIOLATION", `merge commit ${m} of pull request ${pr.number} changes the record of no Change`, {
      hint: "pass the number of the impl-PR of the Change"
    });
  }
  if (subject.record?.["change_state"] !== "VERIFYING") {
    throw new WarrantError("PR_NOT_IMPL", `the record of ${change} is ${String(subject.record?.["change_state"])} on ${m}: pull request ${pr.number} is not the impl-PR of ${change}`, {
      hint: `pass the number of the impl-PR of ${change}: the pull request that brought the transition VERIFYING`
    });
  }
  const tree = await ctx.git.treeId(m);

  const skipped: FetchSkipped[] = [];
  const data = (found: { run: string; evidence: string[] } | Record<string, never> = {}): Record<string, unknown> => ({
    pr: pr.number,
    change,
    merge_commit: m,
    tree,
    ...found,
    skipped
  });
  let chosen: { run: WorkflowRun; files: Map<string, Buffer> } | undefined;
  for (const listed of await candidateRuns(ctx, pr, head)) {
    for (let n = listed.attempt; n >= 1 && chosen === undefined; n -= 1) {
      const run = await ctx.forge.workflowRun(listed.id, n);
      if (run === null) continue;
      if (run.conclusion !== "success") {
        skipped.push({ run: run.url, reason: `concluded ${String(run.conclusion)}` });
        continue;
      }
      const name = `evidence-${change}-${n}`;
      const artifact = await ctx.forge.downloadArtifact(run.id, name);
      if (artifact === null) {
        skipped.push({ run: run.url, reason: `no artifact ${name} (expired or not uploaded)` });
        continue;
      }
      const records = recordsOf(artifact, run);
      if (records.size === 0) {
        skipped.push({ run: run.url, reason: `artifact ${name} holds no record of this attempt` });
        continue;
      }
      const off = [...records.values()].filter(({ json }) => subjectOf(json)?.commit !== head || subjectOf(json)?.tree !== tree);
      if (off.length > 0) {
        skipped.push({ run: run.url, reason: `its records are not on ${head} with the tree ${String(tree)} of M` });
        continue;
      }
      chosen = { run, files: new Map([...records].map(([file, { bytes }]) => [file, bytes])) };
    }
    if (chosen !== undefined) break;
  }
  if (chosen === undefined) {
    return {
      data: data(),
      errors: [
        cliError("NO_CI_EVIDENCE", `no successful run attempt of pull request ${pr.number} or recovery run holds evidence on the tree ${String(tree)} of M ${m}`, {
          hint: `gh workflow run ci.yml -f merge_commit=${m}, wait for it, then warrant ci fetch ${pr.number}`
        })
      ],
      exitCode: EXIT.CONFIG,
      change
    };
  }

  const selected = chosen;
  const commit = await ctx.git.head();
  if (commit === null) throw new WarrantError("USAGE", "warrant ci fetch needs a git repository with a commit at HEAD");
  const first = [...selected.files.values()][0] as Buffer;
  const policyHash = (JSON.parse(first.toString("utf8")) as Record<string, unknown>)["effective_policy_hash"];
  const versions = await manifestVersions(ctx, typeof policyHash === "string" ? policyHash : "");
  const perform = (): ReturnType<typeof importRecords> =>
    importRecords({ root: ctx.root, writes: ctx.writes, change, env, files: selected.files, commit, versions });

  let imported: ReturnType<typeof importRecords>;
  if (ctx.writes.dryRun) imported = perform();
  else {
    const where = lockPath(ctx.root, await ctx.git.commonDir());
    const lock = acquireLock(where.file, { pid: process.pid, check: "ci fetch", started_at: new Date().toISOString(), cwd: ctx.root }, ctx.signals);
    if (!lock.ok) {
      const pid = isPlainObject(lock.holder) ? lock.holder["pid"] : undefined;
      throw new WarrantError("BUSY", `ci fetch: the lock of check is held${pid === undefined ? "" : ` by pid ${String(pid)}`}: a check may be writing evidence`, {
        hint: "retry when it ends; if that process is gone, delete the lock file"
      });
    }
    try {
      imported = perform();
    } finally {
      lock.release();
    }
  }
  if (imported.errors.length > 0) return { data: data(), errors: imported.errors, exitCode: EXIT.CONFIG, change };
  return { data: data({ run: selected.run.url, evidence: imported.ids }), errors: [], exitCode: EXIT.OK, change };
}
