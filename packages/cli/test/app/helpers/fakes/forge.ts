/**
 * `FakeForge` (ADR-0025 п. 3, design phase-4c §6): the pull requests, run
 * attempts and artifacts of one repository as a model, answered as `ForgeGh`
 * answers GitHub (contract `forge`). `ProjectBuilder.withForge` fills it;
 * `fakePull` and `fakeRun` build the objects with defaults of that repository.
 */
import { forgeUnavailable } from "../../../../src/core/errors.js";
import type { ForgePort, PullRequest, RunFilter, WorkflowRun } from "../../../../src/core/ports/forge.js";

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

/** What `ProjectBuilder.withForge` adds: every attempt of a run is its own entry of `runs`. */
export interface ForgeModel {
  pulls?: PullRequest[];
  runs?: WorkflowRun[];
  artifacts?: FakeArtifact[];
}

export class FakeForge implements ForgePort {
  /** The calls made: `pullRequest 9`, `workflowRun 7 2`, `listRuns {"headSha":…}`, `downloadArtifact 7 evidence-…`. */
  readonly calls: string[] = [];
  readonly pulls = new Map<number, PullRequest>();
  /** Attempts of the runs, by run id. */
  readonly runs = new Map<number, WorkflowRun[]>();
  readonly artifacts = new Map<string, FakeArtifact>();
  /** When set, every call fails as `ForgeGh` without a token: `FORGE_UNAVAILABLE` with the `hint`. */
  unavailable = false;

  add(model: ForgeModel): this {
    for (const pull of model.pulls ?? []) this.pulls.set(pull.number, pull);
    for (const run of model.runs ?? []) {
      const attempts = (this.runs.get(run.id) ?? []).filter((a) => a.attempt !== run.attempt);
      this.runs.set(run.id, [...attempts, run].sort((a, b) => a.attempt - b.attempt));
    }
    for (const artifact of model.artifacts ?? []) this.artifacts.set(`${artifact.runId} ${artifact.name}`, artifact);
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

  /** The run as GitHub shows it without an attempt: the latest attempt, `createdAt` of the first. */
  private static latest(attempts: WorkflowRun[]): WorkflowRun {
    const first = attempts[0] as WorkflowRun;
    return { ...(attempts[attempts.length - 1] as WorkflowRun), createdAt: first.createdAt };
  }

  private answer<T>(call: string, compute: () => T): Promise<T> {
    this.calls.push(call);
    if (this.unavailable) return Promise.reject(forgeUnavailable("gh could not read the forge: HTTP 401: Bad credentials"));
    return Promise.resolve(compute());
  }
}
