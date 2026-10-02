/**
 * `warrant ci fetch <pr>` in the test process (REQ-VER-012, task 5.3 of
 * phase-4c): the run on the tree of M — SCN-VER-086, 087, 096, 103 — input
 * errors — SCN-VER-088, 104, 109 — `--dry-run` and a repeated fetch —
 * SCN-VER-089, 097 — and the import: conflict, lock, an interrupted import.
 *
 * Each case merges the impl-PR of `add-search` into `main` of `FakeGit` by M,
 * runs `warrant ci` on M as the job does (run 42, attempt 1), keeps its
 * evidence directory aside as the artifact the fake forge serves and cleans
 * the working copy: the local archive branch before `ci fetch`.
 *
 * «criterion 4c» (task 7.3): the whole chain with the forge — the job's merge
 * R apart from M, `ci fetch`, `transition MERGED --ref <URL impl-PR>`,
 * `archive`, `warrant ci` of the archive-PR; the binary on the real git —
 * `test/e2e/ci-lifecycle.test.ts` (I-185).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runArchive } from "../../../src/commands/archive.js";
import { runCi, runCiFetch } from "../../../src/commands/ci.js";
import { runTransition } from "../../../src/commands/transition.js";
import { canonicalText } from "../../../src/core/canon/format-json.js";
import { acquireLock, lockPath } from "../../../src/core/check/lock.js";
import type { Ctx } from "../../../src/core/ctx.js";
import type { Json } from "../../../src/core/schemas/loader.js";
import { toEnvelope, type CommandResult } from "../../../src/io/output.js";
import { advance, artifactOf, AT, pullRequest, RECORD } from "../helpers/ci.js";
import { FAKE_REPOSITORY, fakePull, fakeRun, type FakeArtifact } from "../helpers/fakes/forge.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { validateErrors } from "../helpers/validate.js";

const project = useProjectBuilder();

type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

const EVIDENCE = ".warrant/evidence/add-search";
const RUNS = `https://github.com/${FAKE_REPOSITORY}/actions/runs`;
const CI_ENV: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: FAKE_REPOSITORY,
  GITHUB_RUN_ID: "42"
};
const OTHER_TREE = "f".repeat(40);

const junit =
  '<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites tests="1" failures="0">\n' +
  '  <testsuite name="fake" tests="1" failures="0" errors="0" skipped="0">\n  </testsuite>\n</testsuites>\n';

function fetch(p: ProjectBuilder, pr = "9", env: NodeJS.ProcessEnv = {}, ctx: Ctx = p.ctx): Promise<Result> {
  return invoke(() => runCiFetch(ctx, pr, env)) as Promise<Result>;
}

interface Merged {
  p: ProjectBuilder;
  m: string;
  head: string;
  tree: string;
  /** The artifact `evidence-add-search-1` of run 42: records with the ref `…/runs/42` (attempt 1). */
  files: Record<string, Buffer>;
  evidence: string[];
}

/** `add-search` (chore) in `state` on `main`: `tests-passed` fake, `spec-approved` waived; one commit. */
async function baseRepo(state: string): Promise<ProjectBuilder> {
  const p = project().withOpenspecValidate();
  p.withChange("add-search", { design: "# Design\n", tasks: "# Tasks\n", specs: { search: [] } }).withRecord("add-search", state, {
    classification: { profiles: ["chore"] }
  });
  p.withWaiver({
    id: "WAV-2026-001",
    change: "add-search",
    gate: "spec-approved",
    reason: "no producer in the fixture",
    owner: "kat",
    approved_by: "human:kat",
    expires_at: "2099-12-31",
    waiver_state: "ACTIVE"
  });
  p.withCheck(
    "fake-tests",
    { effect: (spec) => writeFileSync(path.resolve(spec.cwd, spec.argv[1] as string, "junit.xml"), junit, "utf8") },
    { id: "tests-passed", args: ["{out}"] }
  );
  await p.synced();
  p.commit("base");
  return p;
}

/** `add-search` in `state` on `main`: an impl-PR brings `to` and is merged by M; the job's evidence is the artifact. */
async function merged(state = "IMPLEMENTING", to = "VERIFYING"): Promise<Merged> {
  const p = await baseRepo(state);
  const { head, merge } = pullRequest(p, "worktree/add-search", (b) => {
    b.write("src/search.ts", "export const search = 1;\n");
    advance(b, to, { gates: { "tests-passed": "PASS" } });
  });
  const run = (await invoke(() => runCi(p.ctx, {}, CI_ENV))) as Result;
  const files = to === "VERIFYING" ? artifactOf(p, run.data["artifact"].path) : {};
  p.remove(EVIDENCE);
  return { p, m: merge, head, tree: (await p.git.treeId(merge)) as string, files, evidence: (run.data["evidence"] as string[] | undefined) ?? [] };
}

/** The artifact `files` as another attempt made it: every record with `ref`, and `tree` when given. */
function remade(files: Record<string, Buffer>, ref: string, tree?: string): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const [file, bytes] of Object.entries(files)) {
    if (!/^EVID-[^/]+\.json$/.test(file)) {
      out[file] = bytes;
      continue;
    }
    const json = JSON.parse(bytes.toString("utf8"));
    json.attestation = { type: "ci", ref };
    if (tree !== undefined) json.subject.tree = tree;
    out[file] = Buffer.from(canonicalText(json as Json).text, "utf8");
  }
  return out;
}

function artifact(runId: number, attempt: number, files: Record<string, Buffer>): FakeArtifact {
  return { runId, name: `evidence-add-search-${attempt}`, files };
}

/** Records of the working copy, by file name, as bytes. */
function imported(p: ProjectBuilder): Record<string, Buffer> {
  const dir = path.join(p.root, EVIDENCE);
  const out: Record<string, Buffer> = {};
  for (const name of readdirSync(dir).filter((n) => n.startsWith("EVID-"))) out[name] = readFileSync(path.join(dir, name));
  return out;
}

const recordsOf = (files: Record<string, Buffer>): Record<string, Buffer> =>
  Object.fromEntries(Object.entries(files).filter(([file]) => /^EVID-[^/]+\.json$/.test(file)));

describe("warrant ci fetch: the run on the tree of M", () => {
  it("of two successful runs of the head, the older one on the tree of M, not the latest (SCN-VER-086)", async () => {
    const { p, m, head, tree, files, evidence } = await merged();
    p.withForge({
      pulls: [fakePull(9, { mergeCommit: m, headSha: head })],
      runs: [fakeRun(42, { headSha: head }), fakeRun(43, { headSha: head, createdAt: "2026-09-24T09:30:00Z" })],
      artifacts: [artifact(42, 1, files), artifact(43, 1, remade(files, `${RUNS}/43/attempts/1`, OTHER_TREE))]
    });
    const result = await fetch(p);
    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({ pr: 9, change: "add-search", merge_commit: m, tree, run: `${RUNS}/42/attempts/1`, evidence });
    expect(result.data["skipped"]).toEqual([{ run: `${RUNS}/43/attempts/1`, reason: expect.stringContaining(tree) }]);
    expect(imported(p)).toEqual(recordsOf(files));
    const manifest = p.json(`${EVIDENCE}/manifest.json`);
    expect(manifest.evidence).toEqual(evidence);
    expect(manifest.commit).toBe(await p.git.head());
  });

  it("no run on the tree of M: NO_CI_EVIDENCE with the hint of the recovery run, nothing written (SCN-VER-087)", async () => {
    const { p, m, head, files } = await merged();
    p.withForge({
      pulls: [fakePull(9, { mergeCommit: m, headSha: head })],
      runs: [fakeRun(43, { headSha: head })],
      artifacts: [artifact(43, 1, remade(files, `${RUNS}/43/attempts/1`, OTHER_TREE))]
    });
    const before = p.tree();
    const result = await fetch(p);
    expect(result.errors[0]?.code).toBe("NO_CI_EVIDENCE");
    expect(result.errors[0]?.hint).toContain(`gh workflow run ci.yml -f merge_commit=${m}`);
    expect(result.exitCode).toBe(3);
    expect(p.tree()).toEqual(before);
  });

  it("the recovery hint names the workflow of the run, not a literal; without a run of the job — a placeholder (BL-53)", async () => {
    const { p, m, head, files } = await merged();
    p.withForge({
      pulls: [fakePull(9, { mergeCommit: m, headSha: head })],
      runs: [fakeRun(43, { headSha: head, workflowPath: ".github/workflows/warrant.yml" })],
      artifacts: [artifact(43, 1, remade(files, `${RUNS}/43/attempts/1`, OTHER_TREE))]
    });
    const named = await fetch(p);
    expect(named.errors[0]?.code).toBe("NO_CI_EVIDENCE");
    expect(named.errors[0]?.hint).toBe(`gh workflow run warrant.yml -f merge_commit=${m}, wait for it, then warrant ci fetch 9`);

    const bare = await merged();
    bare.p.withForge({ pulls: [fakePull(9, { mergeCommit: bare.m, headSha: bare.head })] });
    const result = await fetch(bare.p);
    expect(result.errors[0]?.code).toBe("NO_CI_EVIDENCE");
    expect(result.errors[0]?.hint).toBe(`gh workflow run <workflow file of the job warrant> -f merge_commit=${bare.m}, wait for it, then warrant ci fetch 9`);
  });

  it("a recovery workflow_dispatch run from main after the merge, head sha the tip of main (SCN-VER-096)", async () => {
    const { p, m, head, tree, files } = await merged();
    p.withForge({
      pulls: [fakePull(9, { mergeCommit: m, headSha: head })],
      runs: [
        fakeRun(42, { headSha: head }),
        fakeRun(50, { event: "workflow_dispatch", headBranch: "feature/x", headSha: "d".repeat(40), createdAt: "2026-09-24T11:00:00Z" }),
        fakeRun(51, { event: "workflow_dispatch", headBranch: "main", headSha: "d".repeat(40), createdAt: "2026-09-24T12:00:00Z" })
      ],
      artifacts: [
        artifact(42, 1, remade(files, `${RUNS}/42`, OTHER_TREE)),
        artifact(50, 1, remade(files, `${RUNS}/50/attempts/1`)),
        artifact(51, 1, remade(files, `${RUNS}/51/attempts/1`))
      ]
    });
    const result = await fetch(p);
    expect(result.errors).toEqual([]);
    expect(result.data["run"]).toBe(`${RUNS}/51/attempts/1`);
    expect(result.data["tree"]).toBe(tree);
    // Run 50 was dispatched from feature/x: not a candidate at all.
    expect(p.forge.calls.some((c) => c.startsWith("downloadArtifact 50"))).toBe(false);
  });

  it("attempt 2 of a run (Re-run before the merge) on the tree of M, attempt 1 not (SCN-VER-103)", async () => {
    const { p, m, head, files } = await merged();
    const second = remade(files, `${RUNS}/42/attempts/2`);
    p.withForge({
      pulls: [fakePull(9, { mergeCommit: m, headSha: head })],
      runs: [fakeRun(42, { headSha: head }), fakeRun(42, { headSha: head, attempt: 2, createdAt: "2026-09-24T09:40:00Z" })],
      artifacts: [artifact(42, 1, remade(files, `${RUNS}/42`, OTHER_TREE)), artifact(42, 2, second)]
    });
    const result = await fetch(p);
    expect(result.errors).toEqual([]);
    expect(result.data["run"]).toBe(`${RUNS}/42/attempts/2`);
    expect(imported(p)).toEqual(recordsOf(second));
    expect(p.forge.calls.filter((c) => c.startsWith("workflowRun"))).toEqual(["workflowRun 42 2"]);
  });
});

describe("warrant ci fetch: input errors, nothing written", () => {
  it("a PR merged by squash, a PR not merged, a PR of another repository (SCN-VER-088)", async () => {
    const { p, head } = await merged();
    const squash = (await p.git.parents(head))[0] as string;
    p.withForge({ pulls: [fakePull(9, { mergeCommit: squash, headSha: head }), fakePull(10, { merged: false, mergedAt: null, mergedBy: null, mergeCommit: null })] });
    const before = p.tree();
    const squashed = await fetch(p);
    expect([squashed.errors[0]?.code, squashed.exitCode]).toEqual(["PR_NOT_MERGED", 3]);
    expect((await fetch(p, "10")).errors[0]?.code).toBe("PR_NOT_MERGED");
    const other = await fetch(p, "https://github.com/other/repo/pull/9");
    expect([other.errors[0]?.code, other.exitCode]).toEqual(["USAGE", 3]);
    expect(p.tree()).toEqual(before);
  });

  it("no such PR, M not fetched, a word that is not a PR: PR_NOT_FOUND, COMMIT_NOT_FOUND with git fetch, USAGE", async () => {
    const { p, head } = await merged();
    p.withForge({ pulls: [fakePull(9, { mergeCommit: "9".repeat(40), headSha: head })] });
    expect((await fetch(p, "99")).errors[0]?.code).toBe("PR_NOT_FOUND");
    const missing = await fetch(p);
    expect(missing.errors[0]?.code).toBe("COMMIT_NOT_FOUND");
    expect(missing.errors[0]?.hint).toContain("git fetch");
    expect((await fetch(p, "latest")).errors[0]?.code).toBe("USAGE");
  });

  it("the spec-PR of the Change, its record SPECIFIED on M: PR_NOT_IMPL with the hint (SCN-VER-104)", async () => {
    const { p, m, head } = await merged("PROPOSED", "SPECIFIED");
    p.withForge({ pulls: [fakePull(7, { mergeCommit: m, headSha: head })] });
    const result = await fetch(p, "7");
    expect(result.errors[0]?.code).toBe("PR_NOT_IMPL");
    expect(result.errors[0]?.hint).toContain("impl-PR");
    expect(result.exitCode).toBe(3);
  });

  it("WARRANT_STATE_DIR: USAGE with the hint, no call to the forge (SCN-VER-109)", async () => {
    const { p } = await merged();
    const before = p.tree();
    const result = await fetch(p, "9", { WARRANT_STATE_DIR: "state" });
    expect(result.errors[0]?.code).toBe("USAGE");
    expect(result.errors[0]?.hint).toContain("WARRANT_STATE_DIR");
    expect(result.exitCode).toBe(3);
    expect(p.forge.calls).toEqual([]);
    expect(p.tree()).toEqual(before);
  });

  it("the forge: access refused — FORGE_ACCESS, 3; unavailable — FORGE_UNAVAILABLE retryable, 4; GITHUB_REPOSITORY not <owner>/<repo> — USAGE, 3, no call (REQ-VER-012)", async () => {
    const { p } = await merged();
    const before = p.tree();
    const seen: [string | undefined, boolean, number][] = [];
    for (const failure of ["access", "unavailable", "repository"] as const) {
      p.forge.failure = failure;
      const result = await fetch(p);
      seen.push([result.errors[0]?.code, toEnvelope("ci fetch", result).errors[0]?.retryable === true, result.exitCode]);
    }
    expect(seen).toEqual([
      ["FORGE_ACCESS", false, 3],
      ["FORGE_UNAVAILABLE", true, 4],
      ["USAGE", false, 3]
    ]);
    expect(p.forge.calls).toEqual(["pullRequest 9", "pullRequest 9"]);
    expect(p.tree()).toEqual(before);
  });
});

describe("warrant ci fetch: the import", () => {
  async function ready(): Promise<Merged> {
    const merge = await merged();
    merge.p.withForge({
      pulls: [fakePull(9, { mergeCommit: merge.m, headSha: merge.head })],
      runs: [fakeRun(42, { headSha: merge.head })],
      artifacts: [artifact(42, 1, merge.files)]
    });
    return merge;
  }

  it("--dry-run chooses the run and lists the records and the manifest; nothing written (SCN-VER-089)", async () => {
    const { p, evidence } = await ready();
    const before = p.tree();
    const result = await fetch(p, "9", {}, p.dryRun());
    expect(result.errors).toEqual([]);
    expect(result.data["dry_run"]).toBe(true);
    expect(result.data["run"]).toBe(`${RUNS}/42/attempts/1`);
    expect(result.data["would_write"]).toEqual([...evidence.map((id) => `${EVIDENCE}/${id}.json`), `${EVIDENCE}/manifest.json`].sort());
    expect(p.tree()).toEqual(before);
  });

  it("a second fetch changes no file and names the same ids (SCN-VER-097); a lost manifest is written again", async () => {
    const { p, evidence } = await ready();
    expect((await fetch(p)).errors).toEqual([]);
    const after = p.tree();
    const again = await fetch(p);
    expect(again.errors).toEqual([]);
    expect(again.data["evidence"]).toEqual(evidence);
    expect(p.tree()).toEqual(after);

    // An import interrupted after the records: the next one completes the manifest.
    p.remove(`${EVIDENCE}/manifest.json`);
    expect((await fetch(p)).errors).toEqual([]);
    expect(p.json(`${EVIDENCE}/manifest.json`).evidence).toEqual(evidence);
  });

  it("a leftover of a local run: untracked[] and EVIDENCE_UNTRACKED, untouched; a record a transition names is none; deleted and fetched again — out of the manifest (SCN-VER-156)", async () => {
    const merge = await ready();
    const { p, evidence } = merge;
    /** A copy of a record of the artifact under `id`: a valid evidence/1 file of a local run. */
    const local = (id: string): void => {
      const sample = JSON.parse((Object.entries(recordsOf(merge.files))[0] as [string, Buffer])[1].toString("utf8"));
      p.write(`${EVIDENCE}/${id}.json`, { ...sample, id });
    };
    const stray = "EVID-01M3YC8FP9SYPK438EKXFQS4TS";
    const approval = "EVID-01M3YC8FP9SYPK438EKXFQS4TH";
    local(stray);
    local(approval);
    // The record of the working tree names `approval`, as transition MERGED names its human-approval.
    const record = p.json(RECORD);
    record.transitions[record.transitions.length - 1].evidence = [...(record.transitions.at(-1).evidence ?? []), approval];
    p.write(RECORD, record);

    const strayBytes = readFileSync(path.join(p.root, EVIDENCE, `${stray}.json`));
    const first = await fetch(p);
    expect(first.errors).toEqual([]);
    expect(first.exitCode).toBe(0);
    expect(first.data["untracked"]).toEqual([`${EVIDENCE}/${stray}.json`]);
    expect(first.data["findings"]).toEqual([
      { code: "EVIDENCE_UNTRACKED", paths: [`${EVIDENCE}/${stray}.json`], hint: expect.stringContaining("warrant ci fetch 9 again") }
    ]);
    expect(readFileSync(path.join(p.root, EVIDENCE, `${stray}.json`))).toEqual(strayBytes);
    expect(await validateErrors(p)).toEqual([]);

    p.remove(`${EVIDENCE}/${stray}.json`);
    const again = await fetch(p);
    expect(again.exitCode).toBe(0);
    expect(again.data["untracked"]).toEqual([]);
    // --no-record is of warrant ci only.
    const refused = (await invoke(() => runCiFetch(p.ctx, "9", {}, { noRecord: true }))) as Result;
    expect(refused.errors[0]?.code).toBe("USAGE");
    expect(refused.exitCode).toBe(3);
    expect(again.data["findings"]).toEqual([]);
    expect(p.json(`${EVIDENCE}/manifest.json`).evidence).toEqual([...evidence, approval].sort());
    expect(await validateErrors(p)).toEqual([]);
  });

  it("a local record of the same id with other bytes: EVIDENCE_CONFLICT, nothing written", async () => {
    const { p, evidence } = await ready();
    const id = evidence[0] as string;
    p.write(`${EVIDENCE}/${id}.json`, "{}\n");
    const before = p.tree();
    const result = await fetch(p);
    expect(result.errors.map((e) => e.code)).toEqual(["EVIDENCE_CONFLICT"]);
    expect(result.errors[0]?.path).toBe(`${EVIDENCE}/${id}.json`);
    expect(result.exitCode).toBe(3);
    expect(p.tree()).toEqual(before);
  });

  it("a record file not named by its id: SCHEMA_VIOLATION, nothing written", async () => {
    const { p, m, head, files, evidence } = await merged();
    const id = evidence[0] as string;
    const renamed = { ...files, [`EVID-${"0".repeat(26)}.json`]: files[`${id}.json`] as Buffer };
    delete renamed[`${id}.json`];
    p.withForge({ pulls: [fakePull(9, { mergeCommit: m, headSha: head })], runs: [fakeRun(42, { headSha: head })], artifacts: [artifact(42, 1, renamed)] });
    const before = p.tree();
    const result = await fetch(p);
    expect(result.errors.map((e) => e.code)).toEqual(["SCHEMA_VIOLATION"]);
    expect(result.exitCode).toBe(3);
    expect(p.tree()).toEqual(before);
  });

  it("the lock of check held: BUSY retryable, exit 4, nothing written (SCN-KRN-160)", async () => {
    const { p } = await ready();
    const held = acquireLock(lockPath(p.root, await p.git.commonDir()).file, { pid: 1, check: "tests-passed", started_at: AT, cwd: p.root }, p.ctx.signals);
    expect(held.ok).toBe(true);
    try {
      const before = p.tree();
      const result = await fetch(p);
      expect([result.errors[0]?.code, result.exitCode]).toEqual(["BUSY", 4]);
      expect(toEnvelope("ci fetch", result).errors[0]).toMatchObject({ code: "BUSY", retryable: true });
      expect(p.tree()).toEqual(before);
    } finally {
      if (held.ok) held.release();
    }
  });
});

const IMPL_PR = `https://github.com/${FAKE_REPOSITORY}/pull/9`;

/**
 * The chain of criterion 4c: the impl-PR (head H) of `add-search`; the job
 * merges H into the tip of `main` on its own checkout (R), `warrant ci` writes
 * the artifact of run 42; `main` merges H by M — after `shift`, another commit
 * lands on `main` first; the archive branch starts at M.
 */
async function chain(shift = false): Promise<{ p: ProjectBuilder; r: string; m: string; files: Record<string, Buffer>; evidence: string[] }> {
  const p = await baseRepo("IMPLEMENTING");
  p.branch("worktree/add-search", "main");
  p.write("src/search.ts", "export const search = 1;\n");
  advance(p, "VERIFYING", { gates: { "tests-passed": "PASS" } });
  const head = p.commit("worktree/add-search: head");
  p.branch("ci/job", "main");
  const r = p.merge("worktree/add-search", { label: "job: merge" });
  const run = (await invoke(() => runCi(p.ctx, {}, CI_ENV))) as Result;
  expect(run.errors).toEqual([]);
  const files = artifactOf(p, run.data["artifact"].path);
  p.remove(EVIDENCE);
  p.checkout("main", { force: true });
  if (shift) {
    p.write("docs/note.md", "# Note\n");
    p.commit("docs: note");
  }
  const m = p.merge("worktree/add-search", { label: "Merge worktree/add-search" });
  p.withForge({
    pulls: [fakePull(9, { mergeCommit: m, headSha: head })],
    runs: [fakeRun(42, { headSha: head })],
    artifacts: [artifact(42, 1, files)]
  });
  p.branch("archive/add-search", "main");
  return { p, r, m, files, evidence: run.data["evidence"] as string[] };
}

describe("criterion 4c: impl-PR → ci fetch → MERGED → archive → warrant ci of the archive-PR", () => {
  it("the job's merge R has the tree of M: ci fetch, transition MERGED --ref <impl-PR>, archive; warrant ci — exit 0", async () => {
    const { p, r, m, files, evidence } = await chain();
    expect(await p.git.treeId(r)).toBe(await p.git.treeId(m));

    const fetched = await fetch(p);
    expect(fetched.errors).toEqual([]);
    expect(fetched.data).toMatchObject({ pr: 9, change: "add-search", merge_commit: m, run: `${RUNS}/42/attempts/1`, evidence });
    expect(imported(p)).toEqual(recordsOf(files));

    const merged = await invoke(() => runTransition(p.ctx, "add-search", "MERGED", { ref: IMPL_PR }, {}));
    expect(merged.errors).toEqual([]);
    expect(p.json(RECORD).transitions.at(-1)).toMatchObject({ to: "MERGED", ref: IMPL_PR, evidence });
    const archived = await invoke(() => runArchive(p.ctx, "add-search", {}));
    expect(archived.errors).toEqual([]);
    p.commit("archive/add-search: MERGED, ARCHIVED");
    p.checkout("main", { force: true });
    p.merge("archive/add-search", { label: "Merge archive/add-search" });

    const verdict = (await invoke(() => runCi(p.ctx, {}, {}))) as Result;
    expect(verdict.errors).toEqual([]);
    expect(verdict.exitCode).toBe(0);
    expect(verdict.data["kind"]).toBe("archive");
    expect(verdict.data["transitions"].map((t: Data) => t["to"])).toEqual(["MERGED", "ARCHIVED"]);
    expect(verdict.data["evidence"]).toEqual(evidence);
  });

  it("main moved before the merge: no run on the tree of M — NO_CI_EVIDENCE with the recovery hint, nothing written", async () => {
    const { p, r, m } = await chain(true);
    expect(await p.git.treeId(r)).not.toBe(await p.git.treeId(m));
    const before = p.tree();
    const fetched = await fetch(p);
    expect(fetched.errors[0]?.code).toBe("NO_CI_EVIDENCE");
    expect(fetched.errors[0]?.hint).toContain(`gh workflow run ci.yml -f merge_commit=${m}`);
    expect(fetched.exitCode).toBe(3);
    expect(p.tree()).toEqual(before);
  });
});
