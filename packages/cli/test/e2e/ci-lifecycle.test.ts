// e2e: lifecycle
/**
 * Criterion 4c (13 §2, task 7.3 of phase-4c) on the REAL `git` and `openspec`:
 * the CI records `warrant ci` writes on the merge the job computes are what
 * `transition MERGED --ref <URL impl-PR>` and `warrant archive` accept on the
 * merge commit M of `main`, because the tree of M is the tree of the job's
 * merge — and a `main` moved before the merge makes them `STALE` `tree`, which
 * a recovery run on M heals (ADR-0037 п. 1–4, REQ-VER-001, 003, 007, 011).
 *
 *   main: Change `add-search` (chore) in IMPLEMENTING, `tests-passed` fake,
 *     `spec-approved` waived (no producer in the fixture)
 *   impl-PR `worktree/add-search`: code and the record in VERIFYING (head H)
 *   job: `git merge --no-ff H` into the tip of main in detached HEAD (R) →
 *     `warrant ci` under GitHub Actions → evidence with `subject.tree` = tree R,
 *     kept aside as the artifact `evidence-add-search-1`
 *   GitHub: main merges H by M; archive branch: the records of the artifact as
 *     `ci fetch` lays them → `transition MERGED` → `warrant archive`
 *
 * What needs the forge — `ci fetch` choosing the run by the tree of M, its
 * `NO_CI_EVIDENCE`, `warrant ci` of the archive-PR (run, artifact, replay of
 * archive) — the binary reaches only through `gh`, so it is proven in the test
 * process with `FakeForge` on the same chain: `test/app/commands/ci-fetch.test.ts`
 * («criterion 4c») (ADR-0025 п. 1, 4; I-185).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { makeTempDir, removeDir, runCli, type CliRun } from "../helpers/cli.js";
import { git } from "../helpers/git.js";
import { codes, PACKS, recordDoc, useSyncedProject, write } from "../helpers/synced.js";

// `openspec` and the checks of VERIFYING->MERGED run in every step; slow on Windows.
const TIMEOUT = 180_000;

const hasGit = spawnSync("git", ["--version"]).status === 0;
const project = useSyncedProject();
const artifacts: string[] = [];
afterAll(() => {
  for (const dir of artifacts) removeDir(dir);
});

/** A directory outside the project for one artifact. */
function artifactDir(): string {
  const dir = makeTempDir("warrant-e2e-artifact-");
  artifacts.push(dir);
  return path.join(dir, "evidence");
}

const RECORD = ".warrant/changes/add-search.json";
const ACTIVE = "openspec/changes/add-search";
const EVIDENCE = ".warrant/evidence/add-search";
const IMPL_PR = "https://github.com/o/r/pull/9";
const HASH = `sha256:${"0".repeat(64)}`;

/** A local run: no CI attestation, whatever the environment of the test runner. */
const LOCAL: NodeJS.ProcessEnv = { WARRANT_PACKS_DIR: PACKS, GITHUB_ACTIONS: "" };
/** Attempt `attempt` of run `run` of GitHub Actions: records get `attestation.type: "ci"`. */
function ciEnv(run: number, attempt: number): NodeJS.ProcessEnv {
  return {
    WARRANT_PACKS_DIR: PACKS,
    GITHUB_ACTIONS: "true",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "o/r",
    GITHUB_RUN_ID: String(run),
    GITHUB_RUN_ATTEMPT: String(attempt)
  };
}

/** `tests-passed` of the project: writes a passing junit report into `{out}`. */
const FAKE_TESTS =
  "require('fs').writeFileSync(require('path').join(process.argv[1], 'junit.xml'), " +
  "'<testsuites tests=\"1\" failures=\"0\"><testsuite name=\"demo\" tests=\"1\" failures=\"0\" errors=\"0\" skipped=\"0\"></testsuite></testsuites>')";

const SPEC = `# Spec Delta

## ADDED Requirements

### Requirement: Search by text

The system SHALL return every item whose title contains the query.

#### Scenario: Match
- **WHEN** a user searches for "lamp"
- **THEN** every item with "lamp" in its title is returned
`;

function cli(root: string, args: string[], env: NodeJS.ProcessEnv = LOCAL): Promise<CliRun> {
  return runCli(args, root, env);
}

/** `main` with the Change in IMPLEMENTING; the impl-PR branch `worktree/add-search` with head H; HEAD on main. */
function repo(): { root: string; head: string } {
  const root = project();
  write(root, RECORD, recordDoc("add-search", "IMPLEMENTING", { classification: { profiles: ["chore"] } }));
  write(
    root,
    `${ACTIVE}/proposal.md`,
    "# Proposal: add-search\n\n## Why\n\nUsers cannot find items without browsing every page of the catalogue.\n\n## What Changes\n\n- Add text search.\n\n## Capabilities\n\n### New Capabilities\n\n- `search`: text search over items.\n"
  );
  write(root, `${ACTIVE}/design.md`, "# Design\n\n## Context\n\nA linear scan is enough for the catalogue size.\n");
  write(root, `${ACTIVE}/tasks.md`, "# Tasks\n\n## 1. Search\n\n- [x] 1.1 Implement search and verify the unit test passes\n");
  write(root, `${ACTIVE}/specs/search/spec.md`, SPEC);
  write(root, ".warrant/waivers/WAV-2026-001.json", {
    $schema: "warrant://waiver/1",
    id: "WAV-2026-001",
    change: "add-search",
    gate: "spec-approved",
    reason: "no producer of spec-approved in the fixture",
    owner: "kat",
    approved_by: "human:kat",
    expires_at: "2099-12-31",
    waiver_state: "ACTIVE"
  });
  write(root, ".warrant/local/checks/tests-passed.json", {
    $schema: "warrant://check/1",
    id: "tests-passed",
    version: "1.0.0",
    overrides: "core-sdd:tests-passed",
    level: "L1",
    run: { command: [process.execPath, "-e", FAKE_TESTS, "{out}"] }
  });
  git(root, "-c", "init.defaultBranch=main", "init", "--quiet");
  git(root, "checkout", "--quiet", "-B", "main");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "base");

  git(root, "checkout", "--quiet", "-b", "worktree/add-search");
  write(root, "src/search.ts", "export const search = (items: string[], q: string) => items.filter((i) => i.includes(q));\n");
  const record = JSON.parse(readFileSync(path.join(root, RECORD), "utf8"));
  record.transitions.push({ to: "VERIFYING", at: "2026-09-26T10:00:00Z", by: "cli:local", effective_policy_hash: HASH, gates: {} });
  record.change_state = "VERIFYING";
  write(root, RECORD, record);
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "add-search: impl, transition VERIFYING");
  const head = git(root, "rev-parse", "HEAD").trim();
  git(root, "checkout", "--quiet", "main");
  return { root, head };
}

/**
 * The job of the PR (design §8): the tip of main in detached HEAD, `git merge
 * --no-ff` of the head, `warrant ci`. Returns its output and the artifact —
 * the evidence directory, moved out of the working copy as the upload takes it.
 */
async function job(root: string, head: string, env: NodeJS.ProcessEnv): Promise<{ run: CliRun; merge: string; artifact: string }> {
  git(root, "checkout", "--quiet", "--detach", "main");
  git(root, "merge", "--quiet", "--no-ff", "--no-edit", head);
  const merge = git(root, "rev-parse", "HEAD").trim();
  const run = await cli(root, ["ci"], env);
  const artifact = artifactDir();
  if (existsSync(path.join(root, EVIDENCE))) {
    cpSync(path.join(root, EVIDENCE), artifact, { recursive: true });
    rmSync(path.join(root, EVIDENCE), { recursive: true, force: true });
  }
  git(root, "checkout", "--quiet", "main");
  return { run, merge, artifact };
}

/** GitHub merges the impl-PR into main by M; the archive branch starts at M. */
function mergeOnGitHub(root: string, head: string): string {
  git(root, "checkout", "--quiet", "main");
  git(root, "merge", "--quiet", "--no-ff", "--no-edit", head);
  const m = git(root, "rev-parse", "HEAD").trim();
  git(root, "checkout", "--quiet", "-b", "archive/add-search");
  return m;
}

/** The records of the artifact into the local evidence directory, as `ci fetch` lays them (without `raw/`). */
function layRecords(root: string, artifact: string): string[] {
  const ids = readdirSync(artifact).filter((f) => /^EVID-.*\.json$/.test(f));
  for (const file of ids) cpSync(path.join(artifact, file), path.join(root, EVIDENCE, file));
  cpSync(path.join(artifact, "manifest.json"), path.join(root, EVIDENCE, "manifest.json"));
  return ids.map((f) => f.replace(/\.json$/, ""));
}

describe.skipIf(!hasGit)("criterion 4c: evidence on the result of the merge, MERGED and archive on M", () => {
  it(
    "impl-PR: warrant ci on the job's merge → evidence with tree; M of main → transition MERGED --ref <impl-PR> → archive",
    async () => {
      const { root, head } = repo();
      const base = git(root, "rev-parse", "main").trim();
      const { run, merge, artifact } = await job(root, head, ciEnv(42, 1));
      expect(run.json?.errors).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.json?.change).toBe("add-search");
      expect(run.json?.data.kind).toBe("impl");
      expect(run.json?.data.artifact).toEqual({ name: "evidence-add-search-1", path: EVIDENCE });
      const tree = git(root, "rev-parse", `${merge}^{tree}`).trim();
      const ids = run.json?.data.evidence as string[];
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        const record = JSON.parse(readFileSync(path.join(artifact, `${id}.json`), "utf8"));
        expect(record.subject).toMatchObject({ commit: head, base_commit: base, tree });
        expect(record.attestation).toEqual({ type: "ci", ref: "https://github.com/o/r/actions/runs/42/attempts/1" });
      }
      // CI commits nothing (ADR-0010 п. 1): the job's merge is not on any branch.
      expect(git(root, "branch", "--contains", merge).trim()).toBe("");

      const m = mergeOnGitHub(root, head);
      expect(git(root, "rev-parse", `${m}^{tree}`).trim()).toBe(tree);
      expect(layRecords(root, artifact).sort()).toEqual([...ids].sort());
      const merged = await cli(root, ["transition", "add-search", "MERGED", "--ref", IMPL_PR]);
      expect(merged.json?.errors).toEqual([]);
      expect(merged.status).toBe(0);
      const record = JSON.parse(readFileSync(path.join(root, RECORD), "utf8"));
      expect(record.change_state).toBe("MERGED");
      expect(record.transitions.at(-1)).toMatchObject({ to: "MERGED", ref: IMPL_PR });
      expect(record.transitions.at(-1).gates["tests-passed"]).toBe("PASS");
      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "add-search: ci fetch #9, transition MERGED");

      const archived = await cli(root, ["archive", "add-search"]);
      expect(archived.json?.errors).toEqual([]);
      expect(archived.status).toBe(0);
      expect(existsSync(path.join(root, ACTIVE))).toBe(false);
      expect(existsSync(path.join(root, "openspec", "specs", "search", "spec.md"))).toBe(true);
    },
    TIMEOUT
  );

  it(
    "main moved before the merge: the job's records are STALE tree on M; a recovery run on M heals them",
    async () => {
      const { root, head } = repo();
      const { run, artifact } = await job(root, head, ciEnv(42, 1));
      expect(run.status).toBe(0);
      // Another PR lands first: M of the impl-PR is not the merge the job judged.
      write(root, "docs/note.md", "# Note\n");
      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "docs: note");
      const m = mergeOnGitHub(root, head);

      layRecords(root, artifact);
      const stale = await cli(root, ["transition", "add-search", "MERGED", "--ref", IMPL_PR]);
      expect(codes(stale)).toContain("GATES_NOT_PASSED");
      expect(stale.json?.data.gates["tests-passed"]).toBe("BLOCKED");
      const staleTree = (stale.json?.data.findings as { code: string; reason?: string; kind?: string }[]).filter((f) => f.code === "STALE");
      expect(staleTree.length).toBeGreaterThan(0);
      expect(staleTree.every((f) => f.reason === "tree")).toBe(true);
      expect(staleTree.map((f) => f.kind)).toContain("test-report");
      expect(stale.status).not.toBe(0);
      expect(JSON.parse(readFileSync(path.join(root, RECORD), "utf8")).change_state).toBe("VERIFYING");

      // Recovery (workflow_dispatch with merge_commit = M): the job judges M itself.
      rmSync(path.join(root, EVIDENCE), { recursive: true, force: true });
      git(root, "checkout", "--quiet", "--detach", m);
      const recovery = await cli(root, ["ci"], ciEnv(43, 1));
      expect(recovery.json?.errors).toEqual([]);
      expect(recovery.status).toBe(0);
      const healed = artifactDir();
      cpSync(path.join(root, EVIDENCE), healed, { recursive: true });
      rmSync(path.join(root, EVIDENCE), { recursive: true, force: true });
      git(root, "checkout", "--quiet", "archive/add-search");
      layRecords(root, healed);
      const merged = await cli(root, ["transition", "add-search", "MERGED", "--ref", IMPL_PR]);
      expect(merged.json?.errors).toEqual([]);
      expect(merged.status).toBe(0);
    },
    TIMEOUT
  );
});
