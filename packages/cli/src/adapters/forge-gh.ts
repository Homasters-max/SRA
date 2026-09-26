/**
 * `ForgePort` over the GitHub CLI `gh` (ADR-0037 п. 6, design phase-4c §6),
 * through `exec`: `gh api` for pull requests, runs and the artifact list,
 * `gh run download` for the files — `gh` unpacks the zip, so the CLI has no
 * zip dependency. The repository is `GITHUB_REPOSITORY`, else the GitHub URL
 * of the remote `origin` (https or ssh), resolved on the first call; the token
 * is `gh`'s own (`gh auth login` or `GH_TOKEN`), there is no `forge` key in
 * `warrant.json` (N45). HTTP 404 is `null`; every other failure is
 * `FORGE_UNAVAILABLE` with the first line `gh` printed.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { forgeUnavailable } from "../core/errors.js";
import { isPlainObject } from "../core/json.js";
import type { ForgePort, PullRequest, RunFilter, WorkflowRun } from "../core/ports/forge.js";
import { exec } from "./exec.js";

const OWNER_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** `hint` when neither `GITHUB_REPOSITORY` nor `origin` names a GitHub repository. */
const REPOSITORY_HINT = "set `GITHUB_REPOSITORY=<owner>/<repo>`, or add the GitHub repository as the remote `origin`";

/**
 * `<owner>/<repo>` of a GitHub remote URL — `https://github.com/o/r(.git)`,
 * `git@github.com:o/r(.git)`, `ssh://git@github.com[:port]/o/r(.git)`; null
 * for any other host or form (`gh` talks to github.com).
 */
export function parseRemoteUrl(url: string): string | null {
  const text = url.trim();
  const match =
    /^https?:\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(text) ??
    /^(?:ssh:\/\/)?[^@/]+@github\.com(?::\d+)?[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(text);
  const repo = match?.[1];
  return repo !== undefined && OWNER_REPO.test(repo) ? repo : null;
}

/** A value of the answer `gh` printed: `what` names it in the failure. */
function field<T>(value: unknown, check: (v: unknown) => v is T, what: string): T {
  if (!check(value)) throw forgeUnavailable(`gh answered without a valid \`${what}\``);
  return value;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

const objectOf = (value: unknown, what: string): Record<string, unknown> => field(value, isPlainObject, what);

/** `login` of a user object. */
const loginOf = (value: unknown, what: string): string => field(objectOf(value, what).login, isString, `${what}.login`);

/** The body of `GET repos/{owner}/{repo}/pulls/{n}`. */
export function parsePullRequest(body: unknown): PullRequest {
  const pr = objectOf(body, "pull request");
  const merged = field(pr.merged, isBoolean, "merged");
  return {
    number: field(pr.number, isNumber, "number"),
    url: field(pr.html_url, isString, "html_url"),
    author: loginOf(pr.user, "user"),
    merged,
    mergedAt: merged ? field(pr.merged_at, isString, "merged_at") : null,
    mergedBy: merged ? loginOf(pr.merged_by, "merged_by") : null,
    mergeCommit: merged ? field(pr.merge_commit_sha, isString, "merge_commit_sha") : null,
    headSha: field(objectOf(pr.head, "head").sha, isString, "head.sha")
  };
}

/** A run object of `GET …/actions/runs/{id}[/attempts/{n}]` or of the run list; `url` names the attempt. */
export function parseWorkflowRun(body: unknown): WorkflowRun {
  const run = objectOf(body, "workflow run");
  const attempt = field(run.run_attempt, isNumber, "run_attempt");
  const html = field(run.html_url, isString, "html_url").replace(/\/attempts\/\d+\/?$/, "");
  return {
    id: field(run.id, isNumber, "id"),
    attempt,
    url: `${html}/attempts/${attempt}`,
    repository: field(objectOf(run.repository, "repository").full_name, isString, "repository.full_name"),
    event: field(run.event, isString, "event"),
    headBranch: field(run.head_branch, isStringOrNull, "head_branch") ?? "",
    headSha: field(run.head_sha, isString, "head_sha"),
    conclusion: field(run.conclusion, isStringOrNull, "conclusion"),
    createdAt: field(run.created_at, isString, "created_at")
  };
}

/** The pages of `gh api --paginate --slurp …/actions/runs`: every run, in the order GitHub listed them. */
export function parseRunPages(body: unknown): WorkflowRun[] {
  return field(body, isArray, "pages").flatMap((page) => field(objectOf(page, "page").workflow_runs, isArray, "workflow_runs").map(parseWorkflowRun));
}

/** Names of the artifacts of `GET …/actions/runs/{id}/artifacts` that have not expired. */
export function parseLiveArtifacts(body: unknown): string[] {
  return field(objectOf(body, "artifact list").artifacts, isArray, "artifacts")
    .map((a) => objectOf(a, "artifact"))
    .filter((a) => field(a.expired, isBoolean, "expired") === false)
    .map((a) => field(a.name, isString, "name"));
}

/** First line of what a failed `gh` call printed; `gh` that did not start prints nothing. */
function firstLine(stderr: Buffer, stdout: Buffer): string {
  const text = (stderr.toString("utf8").trim() || stdout.toString("utf8").trim()).split("\n")[0]?.trim() ?? "";
  return text === "" ? "`gh` did not run: the GitHub CLI is not on PATH" : text;
}

/** Every file under `dir`, POSIX paths relative to it → bytes. */
function filesUnder(dir: string, rel = "", into = new Map<string, Buffer>()): Map<string, Buffer> {
  for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) filesUnder(dir, child, into);
    else into.set(child, readFileSync(path.join(dir, ...child.split("/"))));
  }
  return into;
}

export class ForgeGh implements ForgePort {
  private repo: Promise<string> | undefined;

  /**
   * @param root the project root: `gh` and `git remote get-url origin` run there
   * @param env  where `GITHUB_REPOSITORY` is read
   */
  constructor(
    private readonly root: string,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  async pullRequest(number: number): Promise<PullRequest | null> {
    const repo = await this.repository();
    const body = await this.api(`repos/${repo}/pulls/${number}`, `pull request #${number}`);
    return body === null ? null : parsePullRequest(body);
  }

  async workflowRun(id: number, attempt?: number): Promise<WorkflowRun | null> {
    const repo = await this.repository();
    const suffix = attempt === undefined ? "" : `/attempts/${attempt}`;
    const body = await this.api(`repos/${repo}/actions/runs/${id}${suffix}`, `run ${id}${suffix}`);
    return body === null ? null : parseWorkflowRun(body);
  }

  async listRuns(filter: RunFilter): Promise<WorkflowRun[]> {
    const repo = await this.repository();
    const params = ["per_page=100", "exclude_pull_requests=true"];
    if (filter.headSha !== undefined) params.push(`head_sha=${filter.headSha}`);
    if (filter.event !== undefined) params.push(`event=${filter.event}`);
    if (filter.createdAfter !== undefined) params.push(`created=>=${filter.createdAfter}`);
    const args = ["api", "--method", "GET", `repos/${repo}/actions/runs`, "--paginate", "--slurp"];
    for (const param of params) args.push("-f", param);
    const body = await this.api(args, "the runs");
    if (body === null) throw forgeUnavailable(`the runs of ${repo} are not found`);
    return parseRunPages(body);
  }

  async downloadArtifact(runId: number, name: string): Promise<Map<string, Buffer> | null> {
    const repo = await this.repository();
    const list = await this.api(
      ["api", "--method", "GET", `repos/${repo}/actions/runs/${runId}/artifacts`, "-f", `name=${name}`, "-f", "per_page=100"],
      `the artifacts of run ${runId}`
    );
    if (list === null || !parseLiveArtifacts(list).includes(name)) return null;
    const dir = mkdtempSync(path.join(tmpdir(), "warrant-artifact-"));
    try {
      const run = await exec("gh", ["run", "download", String(runId), "-n", name, "-D", dir, "-R", repo], this.root);
      if (!run.ok) throw forgeUnavailable(`gh run download ${runId} -n ${name}: ${firstLine(run.stderr, run.stdout)}`);
      return filesUnder(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** `<owner>/<repo>`: `GITHUB_REPOSITORY`, else the GitHub URL of `origin`; once per adapter. */
  private repository(): Promise<string> {
    this.repo ??= this.resolveRepository();
    return this.repo;
  }

  private async resolveRepository(): Promise<string> {
    const fromEnv = this.env.GITHUB_REPOSITORY?.trim();
    if (fromEnv !== undefined && fromEnv !== "") {
      if (OWNER_REPO.test(fromEnv)) return fromEnv;
      throw forgeUnavailable(`GITHUB_REPOSITORY "${fromEnv}" is not <owner>/<repo>`, REPOSITORY_HINT);
    }
    const origin = await exec("git", ["remote", "get-url", "origin"], this.root);
    const url = origin.stdout.toString("utf8").trim();
    const repo = origin.ok ? parseRemoteUrl(url) : null;
    if (repo === null) {
      const what = origin.ok ? `the remote origin ${url} is not a GitHub repository` : "the repository has no remote origin";
      throw forgeUnavailable(`the forge repository is unknown: GITHUB_REPOSITORY is not set and ${what}`, REPOSITORY_HINT);
    }
    return repo;
  }

  /** JSON answer of `gh api` (an endpoint, or full argv); null on HTTP 404; `FORGE_UNAVAILABLE` otherwise. */
  private async api(request: string | string[], what: string): Promise<unknown> {
    const args = typeof request === "string" ? ["api", request] : request;
    const run = await exec("gh", args, this.root);
    if (!run.ok) {
      const line = firstLine(run.stderr, run.stdout);
      if (/\(HTTP 404\)|HTTP 404:/.test(run.stderr.toString("utf8"))) return null;
      throw forgeUnavailable(`gh could not read ${what}: ${line}`);
    }
    try {
      return JSON.parse(run.stdout.toString("utf8")) as unknown;
    } catch {
      throw forgeUnavailable(`gh answered ${what} with no JSON`);
    }
  }
}
