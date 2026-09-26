/**
 * Parsing of `ForgeGh` (design phase-4c §6, task 3.2): the repository from the
 * URL of `origin` (https, ssh) and the answers of `gh api` on bodies recorded
 * from GitHub (trimmed to the keys around the ones read). The calls themselves
 * are the contract's (`test/contract/forge.contract.test.ts`).
 */
import { describe, expect, it } from "vitest";

import { parseLiveArtifacts, parsePullRequest, parseRemoteUrl, parseRunPages, parseWorkflowRun } from "../../../src/adapters/forge-gh.js";
import { FORGE_HINT, WarrantError } from "../../../src/core/errors.js";

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
    expect(error.hint).toBe(FORGE_HINT);
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
