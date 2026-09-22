/**
 * `warrant check` (REQ-VER-001, REQ-VER-002): evidence records and manifest,
 * `WARRANT_STATE_DIR`, raw output, parsers, the exclusive lock, timeout,
 * `--paths` and the choice of checks by the next transition.
 *
 * Each case is a copy of the synced core-sdd project. `openspec` on PATH is a
 * fake that answers `--version` and `validate`, so the result does not depend
 * on the installed OpenSpec; `tests-passed` is overridden in
 * `.warrant/local/checks/` with a node script that writes junit into `{out}`.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { bytesHash } from "../../src/core/canon/hash.js";
import { openspecAvailable } from "../../src/core/openspec/cli.js";
import { makeTempDir, removeDir, runCli, type CliRun } from "../helpers/cli.js";
import { PACKS, record, useSyncedProject, validate, write } from "../helpers/synced.js";

const hasOpenspec = openspecAvailable();
const hasGit = spawnSync("git", ["--version"]).status === 0;
const project = useSyncedProject();

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

function temp(prefix: string): string {
  const dir = makeTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

/** PATH key as Windows spells it, so the override replaces rather than duplicates it. */
const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
const NODE = process.execPath;
const EVIDENCE = ".warrant/evidence/add-search";

/**
 * A fake `openspec`: `--version` → 1.13.1; `validate` logs its argv to
 * `FAKE_OPENSPEC_LOG` and prints a valid report in the shape of OpenSpec 1.13.1.
 */
function fakeOpenspecDir(): string {
  const dir = temp("warrant-fake-openspec-");
  writeFileSync(
    path.join(dir, "shim.cjs"),
    `const fs = require("fs");
const args = process.argv.slice(2);
if (args.includes("--version")) { process.stdout.write("1.13.1\\n"); process.exit(0); }
if (process.env.FAKE_OPENSPEC_LOG) fs.writeFileSync(process.env.FAKE_OPENSPEC_LOG, JSON.stringify(args));
if (args[0] === "validate") {
  process.stdout.write(JSON.stringify({ items: [{ id: args[1], type: "change", valid: true, issues: [], durationMs: 1 }],
    summary: { totals: { items: 1, passed: 1, failed: 0 } }, version: "1.0" }, null, 2) + "\\n");
  process.exit(0);
}
process.exit(1);
`,
    "utf8"
  );
  writeFileSync(path.join(dir, "openspec.cmd"), `@"${NODE}" "%~dp0shim.cjs" %*\r\n`, "utf8");
  writeFileSync(path.join(dir, "openspec"), `#!/bin/sh\nexec "${NODE}" "$(dirname "$0")/shim.cjs" "$@"\n`, "utf8");
  try {
    chmodSync(path.join(dir, "openspec"), 0o755);
  } catch {
    // no permissions on Windows; the .cmd is used there
  }
  return dir;
}

let fakeBin: string | undefined;

function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  fakeBin ??= fakeOpenspecDir();
  return {
    WARRANT_PACKS_DIR: PACKS,
    [PATH_KEY]: `${fakeBin}${path.delimiter}${process.env[PATH_KEY] ?? ""}`,
    // The suite itself runs under GitHub Actions in CI; local attestation is the default here.
    GITHUB_ACTIONS: "",
    ...extra
  };
}

function check(root: string, args: string[], extra: NodeJS.ProcessEnv = {}): Promise<CliRun> {
  return runCli(["check", "add-search", ...args], root, env(extra));
}

/**
 * A fake test runner: `fake-tests.cjs <out> [paths...]` writes `<out>/junit.xml`
 * with 3 tests and `FAKE_FAILURES` failures, its argv to `FAKE_ARGV`, touches
 * `FAKE_MARKER`, and exits 1 on failures or `FAKE_EXIT`.
 */
const FAKE_TESTS = `const fs = require("fs");
const path = require("path");
const [out, ...paths] = process.argv.slice(2);
const failures = Number(process.env.FAKE_FAILURES || "0");
if (process.env.FAKE_MARKER) fs.writeFileSync(process.env.FAKE_MARKER, "ran");
if (process.env.FAKE_ARGV) fs.writeFileSync(process.env.FAKE_ARGV, JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(path.join(out, "junit.xml"),
  '<?xml version="1.0" encoding="UTF-8" ?>\\n<testsuites tests="3" failures="' + failures + '">\\n' +
  '  <testsuite name="fake" tests="3" failures="' + failures + '" errors="0" skipped="0">\\n  </testsuite>\\n</testsuites>\\n');
process.exitCode = failures > 0 ? 1 : Number(process.env.FAKE_EXIT || "0");
`;

/** Override of `core-sdd:tests-passed` with a command; `produces`, `parser` and `exclusive` come from the pack. */
function overrideTests(root: string, extra: Record<string, unknown> = {}): void {
  write(root, "scripts/fake-tests.cjs", FAKE_TESTS);
  write(root, ".warrant/local/checks/tests-passed.json", {
    $schema: "warrant://check/1",
    id: "tests-passed",
    version: "1.0.0",
    overrides: "core-sdd:tests-passed",
    level: "L1",
    run: {
      command: [NODE, "scripts/fake-tests.cjs", "{out}"],
      scoped_command: [NODE, "scripts/fake-tests.cjs", "{out}", "{paths}"]
    },
    ...extra
  });
}

function git(cwd: string, ...args: string[]): string {
  const run = spawnSync("git", ["-c", "user.name=warrant-test", "-c", "user.email=test@example.invalid", ...args], {
    cwd,
    encoding: "utf8"
  });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
  return run.stdout.trim();
}

/** The synced project with Change `add-search`, as a git repository on `main` with one commit. */
function repo(state = "PROPOSED", extra: Record<string, unknown> = {}, setup?: (root: string) => void): string {
  const root = project();
  write(root, ".warrant/changes/add-search.json", record("add-search", state, extra));
  setup?.(root);
  git(root, "init", "--quiet");
  git(root, "checkout", "--quiet", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "fixture");
  return root;
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

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitDead(pid: number, ms = 10_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !alive(pid);
}

describe.skipIf(!hasOpenspec || !hasGit)("warrant check", () => {
  it("writes a local spec-report record and a manifest that pass validate (SCN-VER-001, SCN-VER-005)", async () => {
    const root = repo();
    const log = path.join(temp("warrant-check-log-"), "argv.json");
    const run = await check(root, ["openspec-validate"], { FAKE_OPENSPEC_LOG: log });
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(readJson(log)).toEqual(["validate", "add-search", "--strict", "--json"]);

    const [entry] = run.json.data.checks;
    expect(entry).toMatchObject({ id: "openspec-validate", kind: "spec-report", evidence_status: "PROVEN", metrics: { issues: 0 } });
    expect(entry.path).toBe(`${EVIDENCE}/${entry.evidence}.json`);

    const head = git(root, "rev-parse", "HEAD");
    const evidence = readJson(path.join(root, entry.path));
    expect(evidence).toMatchObject({
      id: entry.evidence,
      kind: "spec-report",
      level: "L1",
      evidence_status: "PROVEN",
      attestation: { type: "none" },
      produced_by: { type: "check", id: "openspec-validate", version: "1.0.0" },
      subject: { commit: head, base_commit: head, spec_revision: `openspec/changes/add-search@${head}` },
      metrics: { issues: 0 },
      limitations: []
    });
    // The stdout the parser read is kept as raw output and referenced by hash.
    const stdout = readFileSync(path.join(root, EVIDENCE, "raw", "openspec-validate", "stdout.json"));
    expect(evidence.artifacts).toEqual([
      { uri: `${EVIDENCE}/raw/openspec-validate/stdout.json`, sha256: bytesHash(stdout) }
    ]);

    const manifest = readJson(path.join(root, EVIDENCE, "manifest.json"));
    expect(manifest).toMatchObject({ change: "add-search", commit: head, evidence: [entry.evidence] });
    expect(manifest.versions).toMatchObject({ openspec: "1.13.1" });
    expect((await validate(root)).json?.errors).toEqual([]);

    // A second run adds a record: nothing is removed, `gates` is not the check's to touch.
    manifest.gates = { "spec-valid": "PASS" };
    write(root, `${EVIDENCE}/manifest.json`, manifest);
    const again = await check(root, ["openspec-validate"]);
    expect(again.status).toBe(0);
    const second = again.json.data.checks[0].evidence as string;
    const updated = readJson(path.join(root, EVIDENCE, "manifest.json"));
    expect(updated.evidence).toEqual([entry.evidence, second].sort());
    expect(updated.gates).toEqual({ "spec-valid": "PASS" });
    expect(recordFiles(path.join(root, EVIDENCE))).toHaveLength(2);
    const validated = await validate(root);
    expect(validated.json?.errors).toEqual([]);
    expect(validated.status).toBe(0);
  }, 120_000);

  it("writes evidence under WARRANT_STATE_DIR and leaves .warrant/evidence alone (SCN-VER-003)", async () => {
    const root = repo();
    const state = temp("warrant-check-state-");
    const run = await check(root, ["openspec-validate"], { WARRANT_STATE_DIR: state });
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    const dir = path.join(state, "evidence", "add-search");
    expect(recordFiles(dir)).toHaveLength(1);
    expect(existsSync(path.join(dir, "manifest.json"))).toBe(true);
    expect(existsSync(path.join(root, EVIDENCE))).toBe(false);
    const evidence = readJson(path.join(dir, recordFiles(dir)[0] as string));
    expect(evidence.artifacts[0].uri).toMatch(/^file:\/\//);
  }, 60_000);

  it("keeps raw junit output in raw/<check-id>/ and references it by uri and sha256 (SCN-VER-004)", async () => {
    const root = repo("PROPOSED", {}, (r) => overrideTests(r));
    const run = await check(root, ["tests-passed"]);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    const junit = path.join(root, EVIDENCE, "raw", "tests-passed", "junit.xml");
    expect(existsSync(junit)).toBe(true);
    const evidence = readJson(path.join(root, run.json.data.checks[0].path));
    expect(evidence.artifacts[0]).toEqual({
      uri: `${EVIDENCE}/raw/tests-passed/junit.xml`,
      sha256: bytesHash(readFileSync(junit))
    });
    expect(evidence).toMatchObject({ kind: "test-report", evidence_status: "PROVEN" });
    expect(evidence.metrics).toEqual({ tests: 3, failures: 0, errors: 0, skipped: 0 });
  }, 60_000);

  it("records NOT_PROVEN for a junit with one failure and still exits 0 (SCN-VER-006)", async () => {
    const root = repo("PROPOSED", {}, (r) => overrideTests(r));
    const run = await check(root, ["tests-passed"], { FAKE_FAILURES: "1" });
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json.data.checks[0]).toMatchObject({
      kind: "test-report",
      evidence_status: "NOT_PROVEN",
      metrics: { tests: 3, failures: 1, errors: 0, skipped: 0 }
    });
    const validated = await validate(root);
    expect(validated.json?.errors).toEqual([]);
  }, 60_000);

  it("does not call a clean report PROVEN when the command exited non-zero", async () => {
    const root = repo("PROPOSED", {}, (r) => overrideTests(r));
    const run = await check(root, ["tests-passed"], { FAKE_EXIT: "2" });
    expect(run.status).toBe(0);
    expect(run.json.data.checks[0].evidence_status).toBe("INCONCLUSIVE");
    expect(run.json.data.checks[0].limitations).toContain("command exited with code 2");
  }, 60_000);

  it("reports CHECK_NOT_CONFIGURED with the pack check path for tests-passed without an override (SCN-VER-007)", async () => {
    const root = repo();
    const run = await check(root, ["tests-passed"]);
    expect(run.status).toBe(3);
    expect(run.json.errors[0].code).toBe("CHECK_NOT_CONFIGURED");
    expect(run.json.errors[0].path).toMatch(/packs\/core-sdd\/checks\/tests-passed\.json$/);
    expect(existsSync(path.join(root, EVIDENCE))).toBe(false);
  }, 60_000);

  it("answers BUSY with the holder and does not run the check while the lock is held (SCN-VER-008)", async () => {
    const root = repo("PROPOSED", {}, (r) => overrideTests(r));
    const lock = path.join(root, ".git", "warrant", "check.lock");
    mkdirSync(path.dirname(lock), { recursive: true });
    const holder = { pid: process.pid, check: "tests-passed", started_at: "2026-09-22T10:00:00.000Z", cwd: root };
    writeFileSync(lock, JSON.stringify(holder), "utf8");
    const marker = path.join(temp("warrant-check-marker-"), "ran");

    const run = await check(root, ["tests-passed"], { FAKE_MARKER: marker });
    expect(run.status).toBe(2);
    expect(run.json.errors[0].code).toBe("BUSY");
    expect(run.json.data.holder.pid).toBe(process.pid);
    expect(existsSync(marker)).toBe(false);
    // Someone else's lock is left where it is (D-23).
    expect(existsSync(lock)).toBe(true);
    expect(existsSync(path.join(root, EVIDENCE))).toBe(false);
  }, 60_000);

  it("stops a check at its timeout, kills its process tree and frees the lock (SCN-VER-009)", async () => {
    const code = [
      "const cp = require('child_process');",
      "const g = cp.spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' });",
      "require('fs').writeFileSync(process.env.FAKE_PIDS, JSON.stringify([process.pid, g.pid]));",
      "setTimeout(()=>{}, 60000);"
    ].join(" ");
    const root = repo("PROPOSED", {}, (r) =>
      write(r, ".warrant/local/checks/tests-passed.json", {
        $schema: "warrant://check/1",
        id: "tests-passed",
        version: "1.0.0",
        overrides: "core-sdd:tests-passed",
        level: "L1",
        run: { command: [NODE, "-e", code] },
        execution: { exclusive: true, timeout_s: 1 }
      })
    );
    const pids = path.join(temp("warrant-check-pids-"), "pids.json");

    const started = Date.now();
    const run = await check(root, ["tests-passed"], { FAKE_PIDS: pids });
    expect(run.status).toBe(3);
    expect(run.json.errors[0].code).toBe("CHECK_TIMEOUT");
    expect(Date.now() - started).toBeLessThan(30_000);

    expect(existsSync(path.join(root, ".git", "warrant", "check.lock"))).toBe(false);
    expect(recordFiles(path.join(root, EVIDENCE))).toEqual([]);
    expect(existsSync(path.join(root, EVIDENCE, "manifest.json"))).toBe(false);
    const [child, grandchild] = readJson(pids) as [number, number];
    expect(await waitDead(child)).toBe(true);
    expect(await waitDead(grandchild)).toBe(true);
  }, 60_000);

  it("runs scoped_command with one argv element per path and marks the record scoped (SCN-VER-010)", async () => {
    const root = repo("PROPOSED", {}, (r) => overrideTests(r));
    const argv = path.join(temp("warrant-check-argv-"), "argv.json");
    const run = await check(root, ["tests-passed", "--paths", "src/a.py,src/b.py"], { FAKE_ARGV: argv });
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(readJson(argv)).toEqual([`${EVIDENCE}/raw/tests-passed`, "src/a.py", "src/b.py"]);
    const evidence = readJson(path.join(root, run.json.data.checks[0].path));
    expect(evidence.limitations).toEqual(["scoped: src/a.py,src/b.py"]);
  }, 60_000);

  it("runs a check without scoped_command in full under --paths, unscoped", async () => {
    const root = repo();
    const run = await check(root, ["openspec-validate", "--paths", "src/a.py"]);
    expect(run.status).toBe(0);
    expect(run.json.data.checks[0].limitations).toEqual([]);
    expect(run.stderr).toMatch(/no run\.scoped_command/);
  }, 60_000);

  it("runs only the checks of the next transition's gates without ids (SCN-VER-011)", async () => {
    const root = repo("PROPOSED", {}, (r) => overrideTests(r));
    const run = await check(root, []);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json.data.transition).toBe("PROPOSED->SPECIFIED");
    expect(run.json.data.checks.map((c: { id: string }) => c.id)).toEqual(["openspec-validate"]);
  }, 60_000);

  it("selects tests-passed for VERIFYING->MERGED of a feature and reports it unconfigured without an override", async () => {
    const root = repo("VERIFYING", { classification: { profiles: ["feature"] } });
    const run = await check(root, []);
    expect(run.json.data.transition).toBe("VERIFYING->MERGED");
    expect(run.json.data.checks).toEqual([{ id: "tests-passed", error: "CHECK_NOT_CONFIGURED" }]);
    expect(run.status).toBe(3);
  }, 60_000);

  it("takes --base as subject.base_commit and refuses a ref that does not resolve", async () => {
    const root = repo();
    const head = git(root, "rev-parse", "HEAD");
    const run = await check(root, ["openspec-validate", "--base", "main"]);
    expect(run.status).toBe(0);
    expect(readJson(path.join(root, run.json.data.checks[0].path)).subject.base_commit).toBe(head);

    const bad = await check(root, ["openspec-validate", "--base", "no-such-ref"]);
    expect(bad.status).toBe(3);
    expect(bad.json.errors[0].code).toBe("USAGE");
  }, 60_000);

  it("refuses an unknown check id with USAGE", async () => {
    const root = repo();
    const run = await check(root, ["no-such-check"]);
    expect(run.status).toBe(3);
    expect(run.json.errors[0].code).toBe("USAGE");
  }, 60_000);
});

describe.skipIf(!hasOpenspec)("warrant check outside git", () => {
  it("records commit nogit with a limitation and locks .warrant/check.lock with a warning", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "PROPOSED"));
    overrideTests(root);
    const run = await check(root, ["tests-passed"]);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.stderr).toMatch(/not a git repository/);
    expect(existsSync(path.join(root, ".warrant", "check.lock"))).toBe(false);
    const evidence = readJson(path.join(root, run.json.data.checks[0].path));
    expect(evidence.subject.commit).toBe("nogit");
    expect(evidence.subject).not.toHaveProperty("base_commit");
    expect(evidence.limitations).toEqual(["no git: commit unknown"]);
    expect((await validate(root)).json?.errors).toEqual([]);
  }, 60_000);
});
