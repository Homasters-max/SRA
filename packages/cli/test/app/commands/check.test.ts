/**
 * `warrant check` in the test process (REQ-VER-001, REQ-VER-002): evidence
 * records and manifest, `WARRANT_STATE_DIR`, raw output, parsers, the exclusive
 * lock, `--paths`, `execution.local: "scoped-only"` (SCN-VER-041, 042) and the
 * choice of checks by the next transition. Moved from e2e (ADR-0025, task 5.3);
 * the kill of the process tree at the timeout (SCN-VER-009) needs real
 * processes and stays in `e2e/check.test.ts`.
 *
 * Each case builds the synced core-sdd project with record `add-search`,
 * committed on `main` of `FakeGit`. The check `openspec-validate` is answered
 * by `FakeCheckRunner` (`withOpenspecValidate`); `tests-passed` is overridden
 * in `.warrant/local/checks/` with a fake command `fake-tests {out} [paths...]`
 * that writes junit into `{out}`.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCheck, type CheckOptions } from "../../../src/commands/check.js";
import { runValidate } from "../../../src/commands/validate.js";
import { runVerify } from "../../../src/commands/verify.js";
import { bytesHash } from "../../../src/core/canon/hash.js";
import type { CommandResult } from "../../../src/io/output.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";

const project = useProjectBuilder();

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const EVIDENCE = ".warrant/evidence/add-search";

/** Environment of a local run: no CI attestation, whatever the environment of the test runner. */
const LOCAL: NodeJS.ProcessEnv = {};

/** The data of a result, read as the envelope is. */
type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

function check(p: ProjectBuilder, ids: string[], opts: CheckOptions = {}, env: NodeJS.ProcessEnv = LOCAL): Promise<Result> {
  return invoke(() => runCheck(p.ctx, "add-search", ids, opts, env));
}

async function validateErrors(p: ProjectBuilder): Promise<unknown[]> {
  return (await invoke(() => runValidate(p.ctx))).errors;
}

/** What the fake test runner reports: 3 tests, `failures` failed and `skipped` skipped; exit 1 on failures, else `exit`. */
interface FakeTests {
  failures?: number;
  skipped?: number;
  exit?: number;
}

/**
 * Override of `core-sdd:tests-passed` with the fake command `fake-tests`;
 * `produces`, `parser` and `exclusive` come from the pack. `fake-tests <out>
 * [paths...]` writes `<out>/junit.xml`.
 */
function overrideTests(p: ProjectBuilder, run: FakeTests = {}, extra: Record<string, unknown> = {}): void {
  const failures = run.failures ?? 0;
  const skipped = run.skipped ?? 0;
  p.checks.on("fake-tests", (spec) => ({
    exit: failures > 0 ? 1 : (run.exit ?? 0),
    effect: () =>
      writeFileSync(
        path.resolve(spec.cwd, spec.argv[1] as string, "junit.xml"),
        `<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites tests="3" failures="${failures}">\n` +
          `  <testsuite name="fake" tests="3" failures="${failures}" errors="0" skipped="${skipped}">\n  </testsuite>\n</testsuites>\n`,
        "utf8"
      )
  }));
  p.write(".warrant/local/checks/tests-passed.json", {
    $schema: "warrant://check/1",
    id: "tests-passed",
    version: "1.0.0",
    overrides: "core-sdd:tests-passed",
    level: "L1",
    run: {
      command: ["fake-tests", "{out}"],
      scoped_command: ["fake-tests", "{out}", "{paths}"]
    },
    ...extra
  });
}

/** Runs of the fake test runner, each as its argv after the command. */
function testRuns(p: ProjectBuilder): string[][] {
  return p.checks.calls.filter((c) => c.argv[0] === "fake-tests").map((c) => c.argv.slice(1));
}

/** The synced project with record `add-search`, committed on `main`. */
async function repo(state = "PROPOSED", extra: Record<string, unknown> = {}, setup?: (p: ProjectBuilder) => void): Promise<ProjectBuilder> {
  const p = project().withRecord("add-search", state, extra).withOpenspecValidate();
  setup?.(p);
  await p.synced();
  p.commit("fixture");
  return p;
}

function head(p: ProjectBuilder): string {
  return p.git.headCommit()?.sha as string;
}

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}

function recordFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.startsWith("EVID-"));
  } catch {
    return [];
  }
}

describe("warrant check", () => {
  it("writes a local spec-report record and a manifest that pass validate (SCN-VER-001, SCN-VER-005)", async () => {
    const p = await repo();
    const run = await check(p, ["openspec-validate"]);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(p.checks.calls.map((c) => c.argv.slice(1))).toEqual([["validate", "add-search", "--strict", "--json"]]);

    const [entry] = run.data["checks"];
    expect(entry).toMatchObject({ id: "openspec-validate", kind: "spec-report", evidence_status: "PROVEN", metrics: { issues: 0 } });
    expect(entry.path).toBe(`${EVIDENCE}/${entry.evidence}.json`);

    const sha = head(p);
    const evidence = readJson(path.join(p.root, entry.path));
    expect(evidence).toMatchObject({
      id: entry.evidence,
      kind: "spec-report",
      level: "L1",
      evidence_status: "PROVEN",
      attestation: { type: "none" },
      produced_by: { type: "check", id: "openspec-validate", version: "1.0.0" },
      subject: { commit: sha, base_commit: sha, spec_revision: `openspec/changes/add-search@${sha}` },
      metrics: { issues: 0 },
      limitations: []
    });
    // The stdout the parser read is kept as raw output and referenced by hash.
    const stdout = readFileSync(path.join(p.root, EVIDENCE, "raw", "openspec-validate", "stdout.json"));
    expect(evidence.artifacts).toEqual([{ uri: `${EVIDENCE}/raw/openspec-validate/stdout.json`, sha256: bytesHash(stdout) }]);

    const manifest = readJson(path.join(p.root, EVIDENCE, "manifest.json"));
    expect(manifest).toMatchObject({ change: "add-search", commit: sha, evidence: [entry.evidence] });
    expect(manifest.versions).toMatchObject({ openspec: "1.13.1" });
    expect(await validateErrors(p)).toEqual([]);

    // A second run adds a record: nothing is removed, `gates` is not the check's to touch.
    manifest.gates = { "spec-valid": "PASS" };
    p.write(`${EVIDENCE}/manifest.json`, manifest);
    const again = await check(p, ["openspec-validate"]);
    expect(again.exitCode).toBe(0);
    const second = again.data["checks"][0].evidence as string;
    const updated = readJson(path.join(p.root, EVIDENCE, "manifest.json"));
    expect(updated.evidence).toEqual([entry.evidence, second].sort());
    expect(updated.gates).toEqual({ "spec-valid": "PASS" });
    expect(recordFiles(path.join(p.root, EVIDENCE))).toHaveLength(2);
    const validated = await invoke(() => runValidate(p.ctx));
    expect(validated.errors).toEqual([]);
    expect(validated.exitCode).toBe(0);
  });

  it("writes evidence under WARRANT_STATE_DIR and leaves .warrant/evidence alone (SCN-VER-003)", async () => {
    const p = await repo();
    const state = temp("warrant-check-state-");
    const run = await check(p, ["openspec-validate"], {}, { WARRANT_STATE_DIR: state });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    const dir = path.join(state, "evidence", "add-search");
    expect(recordFiles(dir)).toHaveLength(1);
    expect(existsSync(path.join(dir, "manifest.json"))).toBe(true);
    expect(existsSync(path.join(p.root, EVIDENCE))).toBe(false);
    const evidence = readJson(path.join(dir, recordFiles(dir)[0] as string));
    expect(evidence.artifacts[0].uri).toMatch(/^file:\/\//);
  });

  it("keeps raw junit output in raw/<check-id>/ and references it by uri and sha256 (SCN-VER-004)", async () => {
    const p = await repo("PROPOSED", {}, (b) => overrideTests(b));
    const run = await check(p, ["tests-passed"]);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    const junit = path.join(p.root, EVIDENCE, "raw", "tests-passed", "junit.xml");
    expect(existsSync(junit)).toBe(true);
    const evidence = readJson(path.join(p.root, run.data["checks"][0].path));
    expect(evidence.artifacts[0]).toEqual({
      uri: `${EVIDENCE}/raw/tests-passed/junit.xml`,
      sha256: bytesHash(readFileSync(junit))
    });
    expect(evidence).toMatchObject({ kind: "test-report", evidence_status: "PROVEN" });
    expect(evidence.metrics).toEqual({ tests: 3, failures: 0, errors: 0, skipped: 0 });
  });

  it("records NOT_PROVEN for a junit with one failure and still exits 0 (SCN-VER-006)", async () => {
    const p = await repo("PROPOSED", {}, (b) => overrideTests(b, { failures: 1 }));
    const run = await check(p, ["tests-passed"]);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data["checks"][0]).toMatchObject({
      kind: "test-report",
      evidence_status: "NOT_PROVEN",
      metrics: { tests: 3, failures: 1, errors: 0, skipped: 0 }
    });
    expect(await validateErrors(p)).toEqual([]);
  });

  it("does not call a clean report PROVEN when the command exited non-zero", async () => {
    const p = await repo("PROPOSED", {}, (b) => overrideTests(b, { exit: 2 }));
    const run = await check(p, ["tests-passed"]);
    expect(run.exitCode).toBe(0);
    expect(run.data["checks"][0].evidence_status).toBe("INCONCLUSIVE");
    expect(run.data["checks"][0].limitations).toContain("command exited with code 2");
  });

  it("records INCONCLUSIVE when every test of the junit was skipped, exit 0 (SCN-VER-040, R-4)", async () => {
    const p = await repo("PROPOSED", {}, (b) => overrideTests(b, { skipped: 3 }));
    const run = await check(p, ["tests-passed"]);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data["checks"][0]).toMatchObject({
      kind: "test-report",
      evidence_status: "INCONCLUSIVE",
      metrics: { tests: 3, failures: 0, errors: 0, skipped: 3 }
    });
    expect(run.data["checks"][0].limitations).toContain("junit: all 3 tests skipped");
    expect(await validateErrors(p)).toEqual([]);
  });

  it("refuses a scoped-only check locally without --paths and runs its scoped_command with them (SCN-VER-041)", async () => {
    const p = await repo("PROPOSED", { classification: { profiles: ["feature"] } }, (b) =>
      overrideTests(b, {}, { execution: { exclusive: true, local: "scoped-only" } })
    );

    const run = await check(p, ["tests-passed"]);
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("CHECK_LOCAL_FORBIDDEN");
    expect(run.errors[0]?.path).toBe(".warrant/local/checks/tests-passed.json");
    expect(run.data["checks"]).toEqual([{ id: "tests-passed", error: "CHECK_LOCAL_FORBIDDEN" }]);
    expect(testRuns(p)).toEqual([]);
    expect(existsSync(path.join(p.root, ".git", "warrant", "check.lock"))).toBe(false);
    expect(existsSync(path.join(p.root, EVIDENCE))).toBe(false);

    const scoped = await check(p, ["tests-passed"], { paths: "src/a.py" });
    expect(scoped.errors).toEqual([]);
    expect(scoped.exitCode).toBe(0);
    expect(testRuns(p)).toEqual([[`${EVIDENCE}/raw/tests-passed`, "src/a.py"]]);
    expect(scoped.data["checks"][0].limitations).toContain("scoped: src/a.py");

    // verify treats it like any failed check: its gates BLOCKED, the rest computed, exit = max (REQ-VER-006).
    const verify: Result = await invoke(() => runVerify(p.ctx, "add-search", { transition: "VERIFYING->MERGED" }, LOCAL));
    expect(verify.errors.map((e) => e.code)).toEqual(["CHECK_LOCAL_FORBIDDEN"]);
    expect(verify.data["gates"]["tests-passed"]).toBe("BLOCKED");
    expect(verify.data["findings"]).toContainEqual(
      expect.objectContaining({ code: "NO_INPUT", gate: "tests-passed", check: "tests-passed", error: "CHECK_LOCAL_FORBIDDEN" })
    );
    expect(verify.data["gates"]["ids-valid"]).toBe("PASS");
    expect(verify.exitCode).toBe(3);
  });

  it("refuses a scoped-only check locally with --paths when it has no scoped_command to narrow with (SCN-VER-041, I-116)", async () => {
    const p = await repo("PROPOSED", {}, (b) =>
      overrideTests(b, {}, { run: { command: ["fake-tests", "{out}"] }, execution: { exclusive: true, local: "scoped-only" } })
    );
    const run = await check(p, ["tests-passed"], { paths: "src/a.py" });
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("CHECK_LOCAL_FORBIDDEN");
    expect(run.errors[0]?.message).toContain("no run.scoped_command");
    expect(testRuns(p)).toEqual([]);
    expect(existsSync(path.join(p.root, EVIDENCE))).toBe(false);
  });

  it("runs a scoped-only check in full under GitHub Actions, attested ci and not scoped (SCN-VER-042)", async () => {
    const p = await repo("PROPOSED", {}, (b) => overrideTests(b, {}, { execution: { exclusive: true, local: "scoped-only" } }));
    const run = await check(p, ["tests-passed"], {}, {
      GITHUB_ACTIONS: "true",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "o/r",
      GITHUB_RUN_ID: "7"
    });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    // run.command, not scoped_command: no paths after {out}.
    expect(testRuns(p)).toEqual([[`${EVIDENCE}/raw/tests-passed`]]);
    const evidence = readJson(path.join(p.root, run.data["checks"][0].path));
    expect(evidence.attestation).toEqual({ type: "ci", ref: "https://github.com/o/r/actions/runs/7" });
    expect(evidence.limitations.some((l: string) => l.startsWith("scoped:"))).toBe(false);
  });

  it("reports CHECK_NOT_CONFIGURED with the pack check path for tests-passed without an override (SCN-VER-007)", async () => {
    const p = await repo();
    const run = await check(p, ["tests-passed"]);
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("CHECK_NOT_CONFIGURED");
    expect(run.errors[0]?.path).toMatch(/packs\/core-sdd\/checks\/tests-passed\.json$/);
    expect(existsSync(path.join(p.root, EVIDENCE))).toBe(false);
  });

  it("answers BUSY with the holder and does not run the check while the lock is held (SCN-VER-008)", async () => {
    const p = await repo("PROPOSED", {}, (b) => overrideTests(b));
    const lock = path.join(p.root, ".git", "warrant", "check.lock");
    mkdirSync(path.dirname(lock), { recursive: true });
    const holder = { pid: process.pid, check: "tests-passed", started_at: "2026-09-22T10:00:00.000Z", cwd: p.root };
    writeFileSync(lock, JSON.stringify(holder), "utf8");

    const run = await check(p, ["tests-passed"]);
    expect(run.exitCode).toBe(2);
    expect(run.errors[0]?.code).toBe("BUSY");
    expect(run.data["holder"].pid).toBe(process.pid);
    expect(testRuns(p)).toEqual([]);
    // Someone else's lock is left where it is (D-23).
    expect(existsSync(lock)).toBe(true);
    expect(existsSync(path.join(p.root, EVIDENCE))).toBe(false);
  });

  it("runs scoped_command with one argv element per path and marks the record scoped (SCN-VER-010)", async () => {
    const p = await repo("PROPOSED", {}, (b) => overrideTests(b));
    const run = await check(p, ["tests-passed"], { paths: "src/a.py,src/b.py" });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(testRuns(p)).toEqual([[`${EVIDENCE}/raw/tests-passed`, "src/a.py", "src/b.py"]]);
    const evidence = readJson(path.join(p.root, run.data["checks"][0].path));
    expect(evidence.limitations).toEqual(["scoped: src/a.py,src/b.py"]);
  });

  it("runs a check without scoped_command in full under --paths, unscoped", async () => {
    const p = await repo();
    const run = await check(p, ["openspec-validate"], { paths: "src/a.py" });
    expect(run.exitCode).toBe(0);
    expect(run.data["checks"][0].limitations).toEqual([]);
    expect(p.warnings.join("")).toMatch(/no run\.scoped_command/);
  });

  it("runs only the checks of the next transition's gates without ids (SCN-VER-011)", async () => {
    const p = await repo("PROPOSED", {}, (b) => overrideTests(b));
    const run = await check(p, []);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data["transition"]).toBe("PROPOSED->SPECIFIED");
    expect(run.data["checks"].map((c: { id: string }) => c.id)).toEqual(["openspec-validate"]);
  });

  it("selects tests-passed for VERIFYING->MERGED of a feature and reports it unconfigured without an override", async () => {
    const p = await repo("VERIFYING", { classification: { profiles: ["feature"] } });
    const run = await check(p, []);
    expect(run.data["transition"]).toBe("VERIFYING->MERGED");
    expect(run.data["checks"]).toEqual([{ id: "tests-passed", error: "CHECK_NOT_CONFIGURED" }]);
    expect(run.exitCode).toBe(3);
  });

  it("takes --base as subject.base_commit and refuses a ref that does not resolve", async () => {
    const p = await repo();
    const run = await check(p, ["openspec-validate"], { base: "main" });
    expect(run.exitCode).toBe(0);
    expect(readJson(path.join(p.root, run.data["checks"][0].path)).subject.base_commit).toBe(head(p));

    const bad = await check(p, ["openspec-validate"], { base: "no-such-ref" });
    expect(bad.exitCode).toBe(3);
    expect(bad.errors[0]?.code).toBe("USAGE");
  });

  it("refuses an unknown check id with USAGE", async () => {
    const p = await repo();
    const run = await check(p, ["no-such-check"]);
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("USAGE");
  });
});

describe("warrant check outside git", () => {
  it("records commit nogit with a limitation and locks .warrant/check.lock with a warning", async () => {
    const p = project().withRecord("add-search", "PROPOSED");
    overrideTests(p);
    await p.synced();
    const run = await check(p, ["tests-passed"]);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(p.warnings.join("")).toMatch(/not a git repository/);
    expect(existsSync(path.join(p.root, ".warrant", "check.lock"))).toBe(false);
    const evidence = readJson(path.join(p.root, run.data["checks"][0].path));
    expect(evidence.subject.commit).toBe("nogit");
    expect(evidence.subject).not.toHaveProperty("base_commit");
    expect(evidence.limitations).toEqual(["no git: commit unknown"]);
    expect(await validateErrors(p)).toEqual([]);
  });
});
