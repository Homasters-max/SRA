/**
 * `FakeForge` (ADR-0025 п. 3, design phase-4c §6): the pull requests, run
 * attempts, artifacts and comments of one repository as a model, answered as
 * `ForgeGh` answers GitHub (contract `forge`). `ProjectBuilder.withForge` fills
 * it; `fakePull` and `fakeRun` build the objects with defaults of that
 * repository, `addComment` adds a comment.
 */
import { forgeAccess, forgeUnavailable, WarrantError } from "../../../../src/core/errors.js";
import type { Comment, CommentRef, ForgePort, PullRequest, RunFilter, WorkflowRun } from "../../../../src/core/ports/forge.js";

/** Repository of the fake forge unless the model names another. */
export const FAKE_REPOSITORY = "kat/project";

/** A merged pull request `number` of `repository`; `fields` override. */
export function fakePull(number: number, fields: Partial<PullRequest> = {}, repository = FAKE_REPOSITORY): PullRequest {
  return {
    number,
    url: `https://github.com/${repository}/pull/${number}`,
    author: "kat",
    merged: true,
    mergedAt: "2026-09-24T10:00:00Z",
    mergedBy: "kat",
    mergeCommit: "a".repeat(40),
    headSha: "b".repeat(40),
    defaultBranch: "main",
    ...fields
  };
}

/** A successful attempt (`fields.attempt`, default 1) of the `pull_request` run `id` of `repository`; `fields` override. */
export function fakeRun(id: number, fields: Partial<WorkflowRun> = {}, repository = FAKE_REPOSITORY): WorkflowRun {
  const attempt = fields.attempt ?? 1;
  return {
    id,
    attempt,
    url: `https://github.com/${repository}/actions/runs/${id}/attempts/${attempt}`,
    repository,
    event: "pull_request",
    headBranch: "worktree/add-search",
    headSha: "b".repeat(40),
    conclusion: "success",
    workflowPath: ".github/workflows/ci.yml",
    createdAt: "2026-09-24T09:00:00Z",
    ...fields
  };
}

/** An artifact: the files of `name` uploaded by the run `runId` (POSIX paths → text or bytes). */
export interface FakeArtifact {
  runId: number;
  name: string;
  files: Record<string, string | Buffer>;
}

/** A comment of the model: `kind` and `id` of its URL, the answer, the repository (default {@link FAKE_REPOSITORY}). */
export interface FakeComment extends Comment {
  kind: CommentRef["kind"];
  id: number;
  repository?: string;
}

/** What `ProjectBuilder.withForge` adds: every attempt of a run is its own entry of `runs`. */
export interface ForgeModel {
  pulls?: PullRequest[];
  runs?: WorkflowRun[];
  artifacts?: FakeArtifact[];
  comments?: FakeComment[];
}

export class FakeForge implements ForgePort {
  /** The calls made: `pullRequest 9`, `workflowRun 7 2`, `listRuns {"headSha":…}`, `downloadArtifact 7 evidence-…`, `comment issue 11`. */
  readonly calls: string[] = [];
  readonly pulls = new Map<number, PullRequest>();
  /** Attempts of the runs, by run id. */
  readonly runs = new Map<number, WorkflowRun[]>();
  readonly artifacts = new Map<string, FakeArtifact>();
  /** Comments by `<repository lower case> <kind> <id>`. */
  readonly comments = new Map<string, Comment>();
  /**
   * When set, every call fails as `ForgeGh` does for that cause (design
   * exit-contract D7): `unavailable` — `FORGE_UNAVAILABLE` (the network, 5xx);
   * `access` — `FORGE_ACCESS` (no token, HTTP 401); `repository` — `USAGE` of a
   * `GITHUB_REPOSITORY` not `<owner>/<repo>`, before any request: no call is recorded.
   */
  failure: "unavailable" | "access" | "repository" | undefined = undefined;

  add(model: ForgeModel): this {
    for (const pull of model.pulls ?? []) this.pulls.set(pull.number, pull);
    for (const run of model.runs ?? []) {
      const attempts = (this.runs.get(run.id) ?? []).filter((a) => a.attempt !== run.attempt);
      this.runs.set(run.id, [...attempts, run].sort((a, b) => a.attempt - b.attempt));
    }
    for (const artifact of model.artifacts ?? []) this.artifacts.set(`${artifact.runId} ${artifact.name}`, artifact);
    for (const comment of model.comments ?? []) this.addComment(comment);
    return this;
  }

  /** Adds the comment `…#issuecomment-<id>` (`kind: "issue"`) or `…#pullrequestreview-<id>` (`"review"`) of its pull request. */
  addComment(comment: FakeComment): this {
    const { kind, id, repository = FAKE_REPOSITORY, ...answer } = comment;
    this.comments.set(`${repository.toLowerCase()} ${kind} ${id}`, answer);
    return this;
  }

  pullRequest(number: number): Promise<PullRequest | null> {
    return this.answer(`pullRequest ${number}`, () => this.pulls.get(number) ?? null);
  }

  workflowRun(id: number, attempt?: number): Promise<WorkflowRun | null> {
    return this.answer(`workflowRun ${id}${attempt === undefined ? "" : ` ${attempt}`}`, () => {
      const attempts = this.runs.get(id);
      if (attempts === undefined) return null;
      return attempt === undefined ? FakeForge.latest(attempts) : (attempts.find((a) => a.attempt === attempt) ?? null);
    });
  }

  listRuns(filter: RunFilter): Promise<WorkflowRun[]> {
    return this.answer(`listRuns ${JSON.stringify(filter)}`, () =>
      [...this.runs.values()]
        .map(FakeForge.latest)
        .filter(
          (run) =>
            (filter.headSha === undefined || run.headSha === filter.headSha) &&
            (filter.event === undefined || run.event === filter.event) &&
            (filter.createdAfter === undefined || run.createdAt >= filter.createdAfter)
        )
        .sort((a, b) => (a.createdAt === b.createdAt ? b.id - a.id : a.createdAt < b.createdAt ? 1 : -1))
    );
  }

  downloadArtifact(runId: number, name: string): Promise<Map<string, Buffer> | null> {
    return this.answer(`downloadArtifact ${runId} ${name}`, () => {
      const artifact = this.artifacts.get(`${runId} ${name}`);
      if (artifact === undefined) return null;
      return new Map(Object.entries(artifact.files).map(([file, content]) => [file, Buffer.from(content)]));
    });
  }

  comment(ref: CommentRef): Promise<Comment | null> {
    return this.answer(`comment ${ref.kind} ${ref.id}`, () => {
      const comment = this.comments.get(`${ref.repository.toLowerCase()} ${ref.kind} ${ref.id}`);
      // A review is read under its pull request (`pulls/<N>/reviews/<id>`): under another one GitHub answers 404.
      if (comment === undefined || (ref.kind === "review" && comment.pullRequest !== ref.pullRequest)) return null;
      return { ...comment };
    });
  }

  /** The run as GitHub shows it without an attempt: the latest attempt, `createdAt` of the first. */
  private static latest(attempts: WorkflowRun[]): WorkflowRun {
    const first = attempts[0] as WorkflowRun;
    return { ...(attempts[attempts.length - 1] as WorkflowRun), createdAt: first.createdAt };
  }

  private answer<T>(call: string, compute: () => T): Promise<T> {
    if (this.failure === "repository") {
      return Promise.reject(
        new WarrantError("USAGE", 'GITHUB_REPOSITORY "not-a-repo" is not <owner>/<repo>', {
          hint: "set `GITHUB_REPOSITORY=<owner>/<repo>`, or add the GitHub repository as the remote `origin`"
        })
      );
    }
    this.calls.push(call);
    if (this.failure === "unavailable") return Promise.reject(forgeUnavailable("gh could not read the forge: gh: HTTP 502"));
    if (this.failure === "access") return Promise.reject(forgeAccess("gh could not read the forge: gh: Bad credentials (HTTP 401)"));
    return Promise.resolve(compute());
  }
}
