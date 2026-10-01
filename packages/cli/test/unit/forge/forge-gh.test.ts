/**
 * Parsing of `ForgeGh` (design phase-4c §6, task 3.2; design slice-fixes §4,
 * task 3.1): the repository from the URL of `origin` (https, ssh) and the
 * answers of `gh api` on bodies recorded from GitHub (trimmed to the keys
 * around the ones read); the class of a failure of `gh` by what it printed
 * (`ghFailure`, design exit-contract D7). The calls themselves
 * are the contract's (`test/contract/forge.contract.test.ts`).
 */
import { describe, expect, it } from "vitest";

import { ForgeGh, ghFailure, parseComment, parseLiveArtifacts, parsePullRequest, parseRemoteUrl, parseRunPages, parseWorkflowRun } from "../../../src/adapters/forge-gh.js";
import { FORGE_HINT, FORGE_RETRY_HINT, WarrantError } from "../../../src/core/errors.js";

const USER = { id: 94626159, login: "Homasters-max", type: "User" };

/** `gh api repos/Homasters-max/SRA/pulls/53`, trimmed. */
const PR_53 = {
  url: "https://api.github.com/repos/Homasters-max/SRA/pulls/53",
  id: 4643746254,
  html_url: "https://github.com/Homasters-max/SRA/pull/53",
  number: 53,
  state: "closed",
  title: "phase-4b: impl-PR — producers analyze-clean и adversarial-review (run submit, warrant-reviewer)",
  user: USER,
  created_at: "2026-09-26T00:01:08Z",
  merged_at: "2026-09-26T00:32:25Z",
  merge_commit_sha: "051b91a8394bbfa7b36f83d5201b079d0e4b3371",
  head: { label: "Homasters-max:worktree/phase-4b", ref: "worktree/phase-4b", sha: "c3b6033ce3af943c7b515cd3e79acf1b79125e18" },
  base: { ref: "main", sha: "5170ed0b81e48007717a61c9b5f9657ddca5194e", repo: { full_name: "Homasters-max/SRA", default_branch: "main" } },
  merged: true,
  mergeable: null,
  merged_by: USER
};

/** `gh api repos/Homasters-max/SRA/actions/runs/36205628647/attempts/1`, trimmed. */
const RUN_ATTEMPT_1 = {
  id: 36205628647,
  name: "ci",
  head_branch: "archive/phase-4b",
  head_sha: "f818f322d3d90b52b12ae354e8ab2551e5830614",
  path: ".github/workflows/ci.yml",
  run_number: 116,
  event: "pull_request",
  status: "completed",
  conclusion: "failure",
  url: "https://api.github.com/repos/Homasters-max/SRA/actions/runs/36205628647",
  html_url: "https://github.com/Homasters-max/SRA/actions/runs/36205628647",
  created_at: "2026-09-26T00:39:10Z",
  updated_at: "2026-09-26T00:39:15Z",
  run_attempt: 1,
  run_started_at: "2026-09-26T00:39:10Z",
  repository: { id: 1381447122, name: "SRA", full_name: "Homasters-max/SRA", private: false },
  head_repository: { full_name: "Homasters-max/SRA" }
};

/** `gh api repos/Homasters-max/SRA/actions/runs/36203233664/artifacts`, trimmed. */
const ARTIFACTS = {
  total_count: 2,
  artifacts: [
    { id: 10893062043, name: "evidence-phase-4b", size_in_bytes: 60089, expired: false, expires_at: "2026-12-25T00:01:11Z" },
    { id: 10893062044, name: "evidence-old", size_in_bytes: 100, expired: true, expires_at: "2026-06-25T00:01:11Z" }
  ]
};

/** `gh api repos/Homasters-max/SRA/issues/comments/5856576133` (PR 68, the spec-PR of slice-fixes), trimmed. */
const ISSUE_COMMENT = {
  url: "https://api.github.com/repos/Homasters-max/SRA/issues/comments/5856576133",
  html_url: "https://github.com/Homasters-max/SRA/pull/68#issuecomment-5856576133",
  issue_url: "https://api.github.com/repos/Homasters-max/SRA/issues/68",
  id: 5856576133,
  user: USER,
  created_at: "2026-09-27T14:08:35Z",
  author_association: "OWNER",
  body: "Contract fixture for ForgePort.comment (slice-fixes, task 3.3); UNK-KRN-999"
};

/** `gh api repos/Homasters-max/SRA/pulls/68/reviews/5330605727`, trimmed. */
const REVIEW = {
  id: 5330605727,
  user: USER,
  body: "Contract fixture for ForgePort.comment (slice-fixes, task 3.3); UNK-KRN-999",
  state: "COMMENTED",
  html_url: "https://github.com/Homasters-max/SRA/pull/68#pullrequestreview-5330605727",
  pull_request_url: "https://api.github.com/repos/Homasters-max/SRA/pulls/68",
  author_association: "OWNER",
  submitted_at: "2026-09-27T14:08:36Z",
  commit_id: "991b5fb3b4ac1d7f3440d40d05ea6eb77255996e"
};

function forgeError(fn: () => unknown): WarrantError {
  try {
    fn();
  } catch (error) {
    if (error instanceof WarrantError) return error;
    throw error;
  }
  throw new Error("expected FORGE_UNAVAILABLE");
}

describe("parseRemoteUrl: <owner>/<repo> of a GitHub origin (N45)", () => {
  it("https and ssh forms, with and without .git", () => {
    for (const url of [
      "https://github.com/Homasters-max/SRA.git",
      "https://github.com/Homasters-max/SRA",
      "https://github.com/Homasters-max/SRA/",
      "https://Homasters-max@github.com/Homasters-max/SRA.git\n",
      "git@github.com:Homasters-max/SRA.git",
      "git@github.com:Homasters-max/SRA",
      "ssh://git@github.com/Homasters-max/SRA.git",
      "ssh://git@github.com:22/Homasters-max/SRA"
    ]) {
      expect(parseRemoteUrl(url), url).toBe("Homasters-max/SRA");
    }
    expect(parseRemoteUrl("https://github.com/o/my.repo.git")).toBe("o/my.repo");
  });

  it("another host or form is not a GitHub repository", () => {
    for (const url of [
      "https://gitlab.com/Homasters-max/SRA.git",
      "git@gitlab.com:Homasters-max/SRA.git",
      "https://github.com/Homasters-max",
      "https://github.com/Homasters-max/SRA/tree/main",
      "D:/project/SRA",
      "../SRA.git",
      ""
    ]) {
      expect(parseRemoteUrl(url), url).toBeNull();
    }
  });
});

describe("parsePullRequest: the body of pulls/{n}", () => {
  it("a PR merged by a merge commit", () => {
    expect(parsePullRequest(PR_53)).toEqual({
      number: 53,
      url: "https://github.com/Homasters-max/SRA/pull/53",
      author: "Homasters-max",
      merged: true,
      mergedAt: "2026-09-26T00:32:25Z",
      mergedBy: "Homasters-max",
      mergeCommit: "051b91a8394bbfa7b36f83d5201b079d0e4b3371",
      headSha: "c3b6033ce3af943c7b515cd3e79acf1b79125e18",
      defaultBranch: "main"
    });
  });

  it("an open PR: its test merge commit is not a merge", () => {
    const open = { ...PR_53, state: "open", merged: false, merged_at: null, merged_by: null, merge_commit_sha: "9".repeat(40) };
    expect(parsePullRequest(open)).toMatchObject({ merged: false, mergedAt: null, mergedBy: null, mergeCommit: null });
  });

  it("a body without a field the port gives is FORGE_UNAVAILABLE naming the field", () => {
    const error = forgeError(() => parsePullRequest({ ...PR_53, head: {} }));
    expect(error.code).toBe("FORGE_UNAVAILABLE");
    expect(error.message).toContain("head.sha");
    expect(error.hint).toBe(FORGE_RETRY_HINT);
    expect(forgeError(() => parsePullRequest([])).code).toBe("FORGE_UNAVAILABLE");
  });
});

describe("parseWorkflowRun: a run or one attempt of it", () => {
  it("url names the attempt, attempt 1 included (I-175)", () => {
    expect(parseWorkflowRun(RUN_ATTEMPT_1)).toEqual({
      id: 36205628647,
      attempt: 1,
      url: "https://github.com/Homasters-max/SRA/actions/runs/36205628647/attempts/1",
      repository: "Homasters-max/SRA",
      event: "pull_request",
      headBranch: "archive/phase-4b",
      headSha: "f818f322d3d90b52b12ae354e8ab2551e5830614",
      conclusion: "failure",
      workflowPath: ".github/workflows/ci.yml",
      createdAt: "2026-09-26T00:39:10Z"
    });
    const third = parseWorkflowRun({ ...RUN_ATTEMPT_1, run_attempt: 3, conclusion: "success" });
    expect(third.url).toBe("https://github.com/Homasters-max/SRA/actions/runs/36205628647/attempts/3");
    const attemptUrl = parseWorkflowRun({ ...RUN_ATTEMPT_1, run_attempt: 2, html_url: `${RUN_ATTEMPT_1.html_url}/attempts/2` });
    expect(attemptUrl.url).toBe("https://github.com/Homasters-max/SRA/actions/runs/36205628647/attempts/2");
  });

  it("a run in progress has no conclusion", () => {
    expect(parseWorkflowRun({ ...RUN_ATTEMPT_1, status: "in_progress", conclusion: null }).conclusion).toBeNull();
  });

  it("a body without the repository is FORGE_UNAVAILABLE", () => {
    const { repository: _, ...without } = RUN_ATTEMPT_1;
    expect(forgeError(() => parseWorkflowRun(without)).message).toContain("repository");
  });
});

describe("parseRunPages: gh api --paginate --slurp …/actions/runs", () => {
  it("runs of every page, in the order listed", () => {
    const pages = [
      { total_count: 3, workflow_runs: [{ ...RUN_ATTEMPT_1, id: 3 }, { ...RUN_ATTEMPT_1, id: 2 }] },
      { total_count: 3, workflow_runs: [{ ...RUN_ATTEMPT_1, id: 1 }] }
    ];
    expect(parseRunPages(pages).map((run) => run.id)).toEqual([3, 2, 1]);
    expect(parseRunPages([{ total_count: 0, workflow_runs: [] }])).toEqual([]);
  });

  it("a single page object is not the slurped form", () => {
    expect(forgeError(() => parseRunPages({ total_count: 0, workflow_runs: [] })).code).toBe("FORGE_UNAVAILABLE");
  });
});

describe("parseLiveArtifacts: …/actions/runs/{id}/artifacts", () => {
  it("names of the artifacts not expired", () => {
    expect(parseLiveArtifacts(ARTIFACTS)).toEqual(["evidence-phase-4b"]);
    expect(parseLiveArtifacts({ total_count: 0, artifacts: [] })).toEqual([]);
  });
});

describe("parseComment: issues/comments/{id} and pulls/{n}/reviews/{id}", () => {
  it("an issue comment: the pull request from issue_url", () => {
    expect(parseComment(ISSUE_COMMENT, "issue")).toEqual({
      author: "Homasters-max",
      pullRequest: 68,
      body: "Contract fixture for ForgePort.comment (slice-fixes, task 3.3); UNK-KRN-999"
    });
  });

  it("a review: the pull request from pull_request_url; a review without text has the body empty", () => {
    expect(parseComment(REVIEW, "review")).toEqual({
      author: "Homasters-max",
      pullRequest: 68,
      body: "Contract fixture for ForgePort.comment (slice-fixes, task 3.3); UNK-KRN-999"
    });
    expect(parseComment({ ...REVIEW, state: "APPROVED", body: null }, "review").body).toBe("");
  });

  it("a body without the URL of its pull request is FORGE_UNAVAILABLE naming the field", () => {
    expect(forgeError(() => parseComment(REVIEW, "issue")).message).toContain("issue_url");
    expect(forgeError(() => parseComment({ ...ISSUE_COMMENT, issue_url: "https://api.github.com/repos/o/r" }, "issue")).message).toContain("issue_url");
    expect(forgeError(() => parseComment({ ...ISSUE_COMMENT, user: null }, "issue")).code).toBe("FORGE_UNAVAILABLE");
  });
});

/** A failed `gh` call as `exec` gives it: started, the exit code, what `gh` printed. */
function failed(stderr: string, status: number | null = 1, started = true): Parameters<typeof ghFailure>[0] {
  return { started, status, stderr: Buffer.from(stderr), stdout: Buffer.alloc(0) };
}

/** Code and `hint` kind of a failure; null — HTTP 404. */
function classOf(run: Parameters<typeof ghFailure>[0]): [string, string] | null {
  const error = ghFailure(run, "gh could not read pull request #53");
  if (error === null) return null;
  return [error.code, error.hint === FORGE_HINT ? "auth" : error.hint === FORGE_RETRY_HINT ? "retry" : String(error.hint)];
}

describe("ghFailure: what gh printed → null, FORGE_ACCESS or FORGE_UNAVAILABLE (exit-contract D7)", () => {
  // Lines of gh 2.101.0, the same the contract test pins against the real `gh`.
  it("HTTP 404 — null: not found, or invisible to the token", () => {
    expect(classOf(failed("gh: Not Found (HTTP 404)\n"))).toBeNull();
  });

  it("a refusal of access: gh not on PATH, no token (exit 4), HTTP 401, HTTP 403 not of a rate limit — FORGE_ACCESS with the hint of gh auth login", () => {
    expect(classOf(failed("", null, false))).toEqual(["FORGE_ACCESS", "auth"]);
    expect(ghFailure(failed("", null, false), "x")?.message).toContain("not on PATH");
    const noToken = "To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n";
    expect(classOf(failed(noToken, 4))).toEqual(["FORGE_ACCESS", "auth"]);
    expect(classOf(failed("gh: Bad credentials (HTTP 401)\n"))).toEqual(["FORGE_ACCESS", "auth"]);
    expect(classOf(failed("gh: Resource not accessible by integration (HTTP 403)\n"))).toEqual(["FORGE_ACCESS", "auth"]);
  });

  it("anything else — FORGE_UNAVAILABLE with the hint to retry: rate limits, 5xx, the network, an unknown failure", () => {
    for (const stderr of [
      "gh: API rate limit exceeded for user ID 1. (HTTP 403)\n",
      "gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)\n",
      "gh: Too Many Requests (HTTP 429)\n",
      "gh: HTTP 502\n",
      "gh: Service Unavailable (HTTP 503)\n",
      'Get "https://api.github.com/repos/o/r/pulls/53": dial tcp 127.0.0.1:9: connect: connection refused\n',
      "error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n",
      "something gh never printed before\n",
      ""
    ]) {
      expect(classOf(failed(stderr)), stderr).toEqual(["FORGE_UNAVAILABLE", "retry"]);
    }
    expect(ghFailure(failed("gh: HTTP 502\n"), "gh could not read pull request #53")?.message).toBe("gh could not read pull request #53: gh: HTTP 502");
  });
});

describe("ForgeGh: GITHUB_REPOSITORY not <owner>/<repo> (SCN-VER-138)", () => {
  it("USAGE with the hint of the form, before any call of gh (no process at the unit level)", async () => {
    let error: unknown;
    try {
      await new ForgeGh(".", { GITHUB_REPOSITORY: "not-a-repo" }).pullRequest(53);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(WarrantError);
    expect([(error as WarrantError).code, (error as WarrantError).hint]).toEqual(["USAGE", expect.stringContaining("GITHUB_REPOSITORY=<owner>/<repo>")]);
    expect((error as WarrantError).message).toContain('"not-a-repo" is not <owner>/<repo>');
  });
});
