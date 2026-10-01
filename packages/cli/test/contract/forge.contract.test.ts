/**
 * Contract of `ForgePort` (ADR-0025 п. 5, ADR-0037 п. 6, design phase-4c §6,
 * task 3.3): `ForgeGh` against the real GitHub of this repository and
 * `FakeForge` filled with the same objects give the same answers. The objects
 * are historical and stay: PR #53 (the impl-PR of phase-4b, merged by a merge
 * commit), its run 36203233664 and the run 36205628647 with three attempts
 * (Re-run, I-175); the maintainer's issue comment and review naming
 * UNK-KRN-999 in PR #68, the spec-PR of slice-fixes (design slice-fixes §4,
 * task 3.3). Artifacts live 90 days, so `downloadArtifact` reads the run
 * attempt of the CI records of the latest `MERGED` transition of this checkout —
 * the run `ci fetch` took them from (a Re-run of failed jobs or a recovery run
 * holds them, not the latest pull_request attempt, BL-72).
 *
 * No `skipIf`: without a token `gh` has (`gh auth login` locally, `GH_TOKEN`
 * in CI) the real side fails with `FORGE_ACCESS` and its `hint`.
 *
 * The failures of `gh` (design exit-contract D7): the lines the installed `gh`
 * prints for HTTP 401, 403, 404, 429, 5xx, a refused connection and no token
 * are pinned against a local HTTP server, with the class `ghFailure` gives
 * them — a new `gh` that words them otherwise fails here, not in a CI run of a
 * consumer.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { exec } from "../../src/adapters/exec.js";
import { ForgeGh, ghFailure } from "../../src/adapters/forge-gh.js";
import { exitCodeFor, FORGE_HINT, FORGE_RETRY_HINT, WarrantError } from "../../src/core/errors.js";
import { parseCiRef } from "../../src/core/evidence/attestation.js";
import type { Comment, CommentRef, ForgePort, PullRequest, WorkflowRun } from "../../src/core/ports/forge.js";
import { FakeForge } from "../app/helpers/fakes/forge.js";
import { makeTempDir, removeDir, REPO_ROOT } from "../helpers/cli.js";

const REPOSITORY = "Homasters-max/SRA";
const RUN_ID = 36203233664;
const RETRIED_ID = 36205628647;

const PR_53: PullRequest = {
  number: 53,
  url: `https://github.com/${REPOSITORY}/pull/53`,
  author: "Homasters-max",
  merged: true,
  mergedAt: "2026-09-26T00:32:25Z",
  mergedBy: "Homasters-max",
  mergeCommit: "051b91a8394bbfa7b36f83d5201b079d0e4b3371",
  headSha: "c3b6033ce3af943c7b515cd3e79acf1b79125e18",
  defaultBranch: "main"
};

const RUN: WorkflowRun = {
  id: RUN_ID,
  attempt: 1,
  url: `https://github.com/${REPOSITORY}/actions/runs/${RUN_ID}/attempts/1`,
  repository: REPOSITORY,
  event: "pull_request",
  headBranch: "worktree/phase-4b",
  headSha: PR_53.headSha,
  conclusion: "success",
  workflowPath: ".github/workflows/ci.yml",
  createdAt: "2026-09-26T00:01:11Z"
};

/** The attempts of run 36205628647 (archive-PR of phase-4b): two failures, then a Re-run that passed. */
const RETRIED: WorkflowRun[] = [
  ["2026-09-26T00:39:10Z", "failure"],
  ["2026-09-26T00:41:34Z", "failure"],
  ["2026-09-26T00:52:42Z", "success"]
].map(([createdAt, conclusion], index) => ({
  id: RETRIED_ID,
  attempt: index + 1,
  url: `https://github.com/${REPOSITORY}/actions/runs/${RETRIED_ID}/attempts/${index + 1}`,
  repository: REPOSITORY,
  event: "pull_request",
  headBranch: "archive/phase-4b",
  headSha: "f818f322d3d90b52b12ae354e8ab2551e5830614",
  conclusion: conclusion as string,
  workflowPath: ".github/workflows/ci.yml",
  createdAt: createdAt as string
}));

/** The issue comment and the review of PR #68 as `parseCommentUrl` reads their URLs (repository in lower case). */
const ISSUE_COMMENT: CommentRef = { repository: REPOSITORY.toLowerCase(), pullRequest: 68, kind: "issue", id: 5856576133 };
const REVIEW: CommentRef = { repository: REPOSITORY.toLowerCase(), pullRequest: 68, kind: "review", id: 5330605727 };

/** What both answer: the same author, pull request and text. */
const DECISION: Comment = {
  author: "Homasters-max",
  pullRequest: 68,
  body: "Contract fixture for ForgePort.comment (slice-fixes, task 3.3); UNK-KRN-999"
};

interface MergedImpl {
  change: string;
  /** Head of the impl-PR: `subject.commit` of the CI records of the transition `MERGED`. */
  head: string;
  /** The run attempt of those records: their `attestation.ref`. */
  run: { id: number; attempt: number };
  /** Committed evidence of the Change, file name → bytes. */
  evidence: Map<string, Buffer>;
}

/** The Change whose `MERGED` transition is the latest among the records of this checkout. */
function latestMergedImpl(): MergedImpl {
  const changes = path.join(REPO_ROOT, ".warrant", "changes");
  let latest: { change: string; at: string; evidence: string[] } | undefined;
  for (const file of readdirSync(changes).filter((f) => f.endsWith(".json"))) {
    const record = JSON.parse(readFileSync(path.join(changes, file), "utf8")) as {
      change: string;
      transitions: { to: string; at: string; evidence?: string[] }[];
    };
    for (const t of record.transitions) {
      if (t.to === "MERGED" && (latest === undefined || t.at > latest.at)) latest = { change: record.change, at: t.at, evidence: t.evidence ?? [] };
    }
  }
  if (latest === undefined) throw new Error("no record of this checkout has a MERGED transition");
  const dir = path.join(REPO_ROOT, ".warrant", "evidence", latest.change);
  const evidence = new Map(readdirSync(dir).map((f) => [f, readFileSync(path.join(dir, f))]));
  const heads = new Set(
    latest.evidence
      .map((id) => JSON.parse((evidence.get(`${id}.json`) ?? Buffer.from("{}")).toString("utf8")) as { attestation?: { type: string; ref?: string }; subject?: { commit: string } })
      .filter((e) => e.attestation?.type === "ci")
  );
  const commits = new Set([...heads].map((e) => e.subject?.commit));
  const runs = new Set([...heads].map((e) => e.attestation?.ref));
  const [head] = commits;
  const [ref] = runs;
  const run = ref === undefined ? null : parseCiRef(ref);
  if (commits.size !== 1 || head === undefined) throw new Error(`the MERGED transition of ${latest.change} names no single CI head`);
  if (runs.size !== 1 || run === null) throw new Error(`the MERGED transition of ${latest.change} names no single CI run`);
  return { change: latest.change, head, run: { id: run.id, attempt: run.attempt }, evidence };
}

const MERGED_IMPL = latestMergedImpl();

/** Artifact names of a CI run: `evidence-<change>-<attempt>` since phase-4c, `evidence-<change>` before. */
const artifactNames = (change: string, run: WorkflowRun): string[] => [`evidence-${change}-${run.attempt}`, `evidence-${change}`];

/**
 * `FakeForge` with the same objects: the run attempt of the CI records of the
 * latest `MERGED` uploaded the committed evidence.
 */
function fakeForge(): FakeForge {
  const implRun: WorkflowRun = {
    ...RUN,
    id: MERGED_IMPL.run.id,
    attempt: MERGED_IMPL.run.attempt,
    url: `https://github.com/${REPOSITORY}/actions/runs/${MERGED_IMPL.run.id}/attempts/${MERGED_IMPL.run.attempt}`,
    headSha: MERGED_IMPL.head,
    createdAt: "2026-09-26T00:30:00Z"
  };
  const files: Record<string, Buffer> = { "manifest.json": Buffer.from("{}\n") };
  for (const [file, bytes] of MERGED_IMPL.evidence) if (file.startsWith("EVID-")) files[file] = bytes;
  return new FakeForge().add({
    pulls: [PR_53],
    runs: [RUN, ...RETRIED, implRun],
    artifacts: [{ runId: MERGED_IMPL.run.id, name: `evidence-${MERGED_IMPL.change}-${MERGED_IMPL.run.attempt}`, files }],
    comments: [
      { ...DECISION, kind: "issue", id: ISSUE_COMMENT.id, repository: REPOSITORY },
      { ...DECISION, kind: "review", id: REVIEW.id, repository: REPOSITORY }
    ]
  });
}

/** A failure of the forge as the test failure: its message and its `hint`. */
async function authorised(port: ForgePort): Promise<void> {
  try {
    await port.pullRequest(PR_53.number);
  } catch (error) {
    if (error instanceof WarrantError) throw new Error(`${error.code}: ${error.message}; hint: ${error.hint ?? ""}`);
    throw error;
  }
}

async function unavailable(call: Promise<unknown>): Promise<WarrantError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof WarrantError) return error;
    throw error;
  }
  throw new Error("expected a failure of the forge");
}

/** Runs `fn` with `vars` set (undefined — unset) in `process.env`, which `gh` inherits; restores them after. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  const set = (values: Record<string, string | undefined>): void => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  set(vars);
  try {
    return await fn();
  } finally {
    set(saved);
  }
}

const SIDES = [
  { side: "ForgeGh (real GitHub)", port: (): ForgePort => new ForgeGh(REPO_ROOT, { GITHUB_REPOSITORY: REPOSITORY }) },
  { side: "FakeForge", port: (): ForgePort => fakeForge() }
];

describe.each(SIDES)("ForgePort contract: $side", ({ port: portOf }) => {
  const port = portOf();

  beforeAll(() => authorised(port));

  it("pullRequest: a PR merged by a merge commit; null for a PR that does not exist", async () => {
    expect(await port.pullRequest(53)).toEqual(PR_53);
    expect(await port.pullRequest(999_999)).toBeNull();
  });

  it("workflowRun: the run as its latest attempt and as attempt 1; null past the last attempt and for no run", async () => {
    expect(await port.workflowRun(RUN_ID)).toEqual(RUN);
    expect(await port.workflowRun(RUN_ID, 1)).toEqual(RUN);
    expect(await port.workflowRun(RUN_ID, 2)).toBeNull();
    expect(await port.workflowRun(1)).toBeNull();
  });

  it("workflowRun(id, n): attempts walked from the latest down to 1 (I-175)", async () => {
    const latest = await port.workflowRun(RETRIED_ID);
    expect(latest).toEqual({ ...RETRIED[2], createdAt: RETRIED[0]?.createdAt });
    const walked: (WorkflowRun | null)[] = [];
    for (let n = latest?.attempt ?? 0; n >= 1; n -= 1) walked.push(await port.workflowRun(RETRIED_ID, n));
    expect(walked).toEqual([...RETRIED].reverse());
  });

  it("listRuns: by head sha, event and creation time, as the latest attempt", async () => {
    const ids = async (filter: Parameters<ForgePort["listRuns"]>[0]): Promise<number[]> => (await port.listRuns(filter)).map((r) => r.id);
    expect(await port.listRuns({ headSha: PR_53.headSha })).toContainEqual(RUN);
    expect(await ids({ headSha: PR_53.headSha, event: "pull_request", createdAfter: RUN.createdAt })).toContain(RUN_ID);
    expect(await ids({ headSha: PR_53.headSha, event: "pull_request", createdAfter: "2026-09-26T00:01:12Z" })).not.toContain(RUN_ID);
    expect(await ids({ headSha: PR_53.headSha, event: "workflow_dispatch" })).toEqual([]);
    const retried = (await port.listRuns({ headSha: RETRIED[0]?.headSha as string })).find((r) => r.id === RETRIED_ID);
    expect(retried).toEqual({ ...RETRIED[2], createdAt: RETRIED[0]?.createdAt });
  });

  it("comment: an issue comment and a review of the maintainer; null for no such id, a review under another PR, another repository", async () => {
    expect(await port.comment(ISSUE_COMMENT)).toEqual(DECISION);
    expect(await port.comment(REVIEW)).toEqual(DECISION);
    expect(await port.comment({ ...ISSUE_COMMENT, id: 1 })).toBeNull();
    expect(await port.comment({ ...REVIEW, id: 1 })).toBeNull();
    expect(await port.comment({ ...REVIEW, pullRequest: 67 })).toBeNull();
    expect(await port.comment({ ...ISSUE_COMMENT, repository: "octocat/hello-world" })).toBeNull();
  });

  it("downloadArtifact: the evidence of the run attempt of the CI records of the latest MERGED; null for no such artifact", async () => {
    const run = await port.workflowRun(MERGED_IMPL.run.id, MERGED_IMPL.run.attempt);
    expect(run?.conclusion, `run ${MERGED_IMPL.run.id} attempt ${MERGED_IMPL.run.attempt} of ${MERGED_IMPL.change} (head ${MERGED_IMPL.head})`).toBe("success");
    let files: Map<string, Buffer> | null = null;
    for (const name of artifactNames(MERGED_IMPL.change, run as WorkflowRun)) {
      files ??= await port.downloadArtifact((run as WorkflowRun).id, name);
    }
    expect(files, `artifact ${artifactNames(MERGED_IMPL.change, run as WorkflowRun).join(" or ")}`).not.toBeNull();
    const downloaded = files as Map<string, Buffer>;
    expect(downloaded.has("manifest.json")).toBe(true);
    const records = [...downloaded.keys()].filter((file) => /^EVID-[0-9A-Z]{26}\.json$/.test(file));
    expect(records.length).toBeGreaterThan(0);
    // A record committed by the archive-PR is byte for byte the one in the artifact (design §5).
    for (const file of records) {
      const committed = MERGED_IMPL.evidence.get(file);
      if (committed !== undefined) expect(downloaded.get(file)?.equals(committed), file).toBe(true);
    }
    expect(await port.downloadArtifact((run as WorkflowRun).id, "no-such-artifact")).toBeNull();
  });
});

describe("ForgePort contract: a bad token — FORGE_ACCESS with the hint (exit-contract D7)", () => {
  it("ForgeGh with a bad GH_TOKEN, FakeForge refusing access: FORGE_ACCESS, exit 3; FakeForge unavailable: FORGE_UNAVAILABLE, exit 4", async () => {
    const real = await withEnv({ GH_TOKEN: "bad-token-of-the-forge-contract" }, () =>
      unavailable(new ForgeGh(REPO_ROOT, { GITHUB_REPOSITORY: REPOSITORY }).pullRequest(53))
    );
    expect([real.code, real.hint, exitCodeFor([real])]).toEqual(["FORGE_ACCESS", FORGE_HINT, 3]);
    expect(real.message).toContain("gh: Bad credentials (HTTP 401)");
    const fake = fakeForge();
    fake.failure = "access";
    const faked = await unavailable(fake.pullRequest(53));
    expect([faked.code, faked.hint, exitCodeFor([faked])]).toEqual(["FORGE_ACCESS", FORGE_HINT, 3]);
    fake.failure = "unavailable";
    const down = await unavailable(fake.pullRequest(53));
    expect([down.code, down.hint, exitCodeFor([down])]).toEqual(["FORGE_UNAVAILABLE", FORGE_RETRY_HINT, 4]);
    expect(fake.calls).toEqual(["pullRequest 53", "pullRequest 53"]);
  });
});

/** Answers of the local server, as GitHub gives them: status, content type, body. */
const ANSWERS: Record<string, [number, string, string]> = {
  "/401": [401, "application/json", '{"message":"Bad credentials","documentation_url":"https://docs.github.com/rest"}'],
  "/403": [403, "application/json", '{"message":"Resource not accessible by integration","documentation_url":"https://docs.github.com/rest"}'],
  "/403-rate": [403, "application/json", '{"message":"API rate limit exceeded for user ID 1."}'],
  "/403-secondary": [403, "application/json", '{"message":"You have exceeded a secondary rate limit. Please wait a few minutes before you try again."}'],
  "/404": [404, "application/json", '{"message":"Not Found","documentation_url":"https://docs.github.com/rest"}'],
  "/429": [429, "application/json", '{"message":"Too Many Requests"}'],
  "/502": [502, "text/html", "<html><body>502 Bad Gateway</body></html>"],
  "/503": [503, "application/json", '{"message":"Service Unavailable"}']
};

describe("ForgeGh: the failures of the real gh, pinned (exit-contract D7)", () => {
  let server: Server;
  let base = "";
  let refused = "";
  let config = "";
  /** `gh` with a placeholder token and an empty config: the calls go to the local server only. */
  const gh = (args: string[], vars: Record<string, string | undefined> = { GH_TOKEN: "placeholder-of-the-forge-contract" }): ReturnType<typeof exec> =>
    withEnv({ GH_CONFIG_DIR: config, GITHUB_TOKEN: undefined, GH_TOKEN: undefined, ...vars }, () => exec("gh", args, REPO_ROOT));
  const firstLineOf = (run: { stderr: Buffer }): string => run.stderr.toString("utf8").split("\n")[0]?.trim() ?? "";
  const listen = (s: Server): Promise<number> => new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve((s.address() as AddressInfo).port)));

  beforeAll(async () => {
    config = makeTempDir("warrant-gh-config-");
    server = createServer((req, res) => {
      const [status, type, body] = ANSWERS[req.url ?? ""] ?? [500, "text/plain", "no such answer"];
      res.writeHead(status, { "content-type": type });
      res.end(body);
    });
    base = `http://127.0.0.1:${String(await listen(server))}`;
    const closed = createServer();
    refused = `http://127.0.0.1:${String(await listen(closed))}/x`;
    await new Promise((resolve) => closed.close(resolve));
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    removeDir(config);
  });

  it.each([
    ["/401", "gh: Bad credentials (HTTP 401)", "FORGE_ACCESS"],
    ["/403", "gh: Resource not accessible by integration (HTTP 403)", "FORGE_ACCESS"],
    ["/403-rate", "gh: API rate limit exceeded for user ID 1. (HTTP 403)", "FORGE_UNAVAILABLE"],
    ["/403-secondary", "gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)", "FORGE_UNAVAILABLE"],
    ["/404", "gh: Not Found (HTTP 404)", null],
    ["/429", "gh: Too Many Requests (HTTP 429)", "FORGE_UNAVAILABLE"],
    ["/502", "gh: HTTP 502", "FORGE_UNAVAILABLE"],
    ["/503", "gh: Service Unavailable (HTTP 503)", "FORGE_UNAVAILABLE"]
  ] as const)("HTTP %s: gh prints %j — %s", async (endpoint, line, code) => {
    const run = await gh(["api", `${base}${endpoint}`]);
    expect([run.ok, run.started, firstLineOf(run)]).toEqual([false, true, line]);
    expect(ghFailure(run, "x")?.code ?? null).toBe(code);
  });

  it("a refused connection: gh names the request — FORGE_UNAVAILABLE, retryable", async () => {
    const run = await gh(["api", refused]);
    expect(firstLineOf(run).startsWith(`Get "${refused}": dial tcp`)).toBe(true);
    const failure = ghFailure(run, "x");
    expect([failure?.code, failure?.hint]).toEqual(["FORGE_UNAVAILABLE", FORGE_RETRY_HINT]);
  });

  it("no token: gh exits 4 asking for gh auth login, or for GH_TOKEN under GitHub Actions — FORGE_ACCESS with the hint", async () => {
    const run = await gh(["api", `${base}/404`], {});
    expect([run.ok, run.status]).toEqual([false, 4]);
    // The text depends on GITHUB_ACTIONS in the environment of gh; the class rests on exit 4 (D7).
    expect([
      "To get started with GitHub CLI, please run:  gh auth login",
      "gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable. Example:"
    ]).toContain(firstLineOf(run));
    const failure = ghFailure(run, "x");
    expect([failure?.code, failure?.hint, exitCodeFor(failure === null ? [] : [failure])]).toEqual(["FORGE_ACCESS", FORGE_HINT, 3]);
  });

  it("gh not on PATH: the command does not start — FORGE_ACCESS", async () => {
    const run = await exec("gh-not-installed-of-the-forge-contract", ["api", "x"], REPO_ROOT);
    expect([run.ok, run.started]).toEqual([false, false]);
    expect(ghFailure(run, "x")?.code).toBe("FORGE_ACCESS");
  });
});

describe("ForgeGh: the repository from GITHUB_REPOSITORY or origin (N45)", () => {
  it("without GITHUB_REPOSITORY the repository is the URL of origin", async () => {
    expect((await new ForgeGh(REPO_ROOT, {}).pullRequest(53))?.url).toBe(PR_53.url);
  });

  it("without GITHUB_REPOSITORY and origin — USAGE naming both (exit-contract D7)", async () => {
    const dir = makeTempDir("warrant-forge-");
    try {
      expect(existsSync(path.join(dir, ".git"))).toBe(false);
      const error = await unavailable(new ForgeGh(dir, {}).pullRequest(53));
      expect([error.code, exitCodeFor([error])]).toEqual(["USAGE", 3]);
      expect(error.message).toMatch(/GITHUB_REPOSITORY.*origin/);
      expect(error.hint).toMatch(/GITHUB_REPOSITORY=<owner>\/<repo>/);
      const malformed = await unavailable(new ForgeGh(dir, { GITHUB_REPOSITORY: "not a repository" }).pullRequest(53));
      expect(malformed.code).toBe("USAGE");
      expect(malformed.message).toContain("not <owner>/<repo>");
    } finally {
      removeDir(dir);
    }
  });
});
