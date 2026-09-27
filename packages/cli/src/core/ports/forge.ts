/**
 * Port to the forge (ADR-0037 п. 6, design phase-4c §6): the pull requests,
 * workflow runs, artifacts and pull request comments of this repository on
 * GitHub. Five methods, the ones `warrant ci` and `ci fetch` use — `comment`
 * reads the maintainer's decision of an UNKNOWN (ADR-0040 п. 3, design
 * slice-fixes §4); `reviews` is not introduced (ADR-0025: a port has only the
 * methods in use). The adapter (`adapters/forge-gh.ts`)
 * talks through `gh`: the repository is `GITHUB_REPOSITORY` or the URL of the
 * remote `origin`, the token is `gh`'s own (N45). A failure of authorisation,
 * of the network or of `gh` itself throws `FORGE_UNAVAILABLE` with a `hint`
 * (`forgeUnavailable` of `core/errors.ts`); what the forge does not have is `null`.
 */

/** A pull request of this repository (`GET repos/{owner}/{repo}/pulls/{n}`). */
export interface PullRequest {
  number: number;
  /** `html_url`: `https://github.com/<owner>/<repo>/pull/<n>`. */
  url: string;
  /** Login of the author. */
  author: string;
  merged: boolean;
  /** ISO time of the merge; null when not merged. */
  mergedAt: string | null;
  /** Login of who merged it; null when not merged. */
  mergedBy: string | null;
  /** `merge_commit_sha` of a merged PR (a merge, squash or rebase commit); null when not merged. */
  mergeCommit: string | null;
  headSha: string;
  /**
   * `base.repo.default_branch`: the default branch of the repository, the only
   * branch a recovery run `workflow_dispatch` is accepted from (N49).
   */
  defaultBranch: string;
}

/** One attempt of a workflow run (`GET …/actions/runs/{id}[/attempts/{n}]`). */
export interface WorkflowRun {
  id: number;
  /** `run_attempt`, from 1. */
  attempt: number;
  /** URL of this attempt: `https://github.com/<owner>/<repo>/actions/runs/<id>/attempts/<n>`, attempt 1 included. */
  url: string;
  /** `<owner>/<repo>` of the repository the run belongs to. */
  repository: string;
  /** `pull_request`, `workflow_dispatch`, `push`, … */
  event: string;
  headBranch: string;
  headSha: string;
  /** `success`, `failure`, …; null while the attempt is not completed. */
  conclusion: string | null;
  /**
   * `path` of the workflow file the run ran, `.github/workflows/<file>` (BL-53):
   * the recovery `gh workflow run <file>` names it.
   */
  workflowPath: string;
  /**
   * ISO `created_at` as GitHub answers it: of the run in `listRuns` and
   * `workflowRun(id)`, of the attempt in `workflowRun(id, n)`.
   */
  createdAt: string;
}

/** Filter of `listRuns`; an absent key does not filter. */
export interface RunFilter {
  headSha?: string;
  event?: string;
  /** ISO time: runs created (their first attempt) at or after it (GitHub `created=>=`). */
  createdAfter?: string;
}

/**
 * A comment of a pull request named by URL (REQ-VER-013): `…/pull/<N>#issuecomment-<id>`
 * — a comment of the conversation (issues API) — or `…#pullrequestreview-<id>`
 * — a review.
 */
export interface CommentRef {
  /** `<owner>/<repo>` the URL names, lower case. */
  repository: string;
  /** `<N>` the URL names. */
  pullRequest: number;
  kind: "issue" | "review";
  id: number;
}

/** A comment of a pull request as the forge answers it. */
export interface Comment {
  /** Login of the author. */
  author: string;
  /**
   * Number of the pull request the comment belongs to, by the answer of the
   * forge: the id of an issue comment is unique in the repository, not in the
   * pull request, so `<N>` of the URL is not a fact (I-189).
   */
  pullRequest: number;
  /** Text; `""` for a review without one. */
  body: string;
}

export interface ForgePort {
  /** The pull request `number` of this repository; null when there is none. */
  pullRequest(number: number): Promise<PullRequest | null>;
  /**
   * The run `id` of this repository: its attempt `attempt`, or the latest
   * attempt when absent; null when there is no such run or attempt. Attempts of
   * a run are walked from the latest down to 1 by calling it with each `n`
   * (I-175).
   */
  workflowRun(id: number, attempt?: number): Promise<WorkflowRun | null>;
  /** Runs of this repository matching `filter`, each as its latest attempt, newest first. */
  listRuns(filter: RunFilter): Promise<WorkflowRun[]>;
  /**
   * Files of the artifact `name` of the run `runId`, unpacked: POSIX paths
   * relative to the artifact root → bytes; null when the run has no such
   * artifact or it expired.
   */
  downloadArtifact(runId: number, name: string): Promise<Map<string, Buffer> | null>;
  /**
   * The comment `ref` of this repository; null when there is none — no such
   * id, a review of another pull request, or `ref.repository` not the
   * repository of the forge.
   */
  comment(ref: CommentRef): Promise<Comment | null>;
}
