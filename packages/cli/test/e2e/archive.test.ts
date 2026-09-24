/**
 * `warrant archive` with the REAL `openspec` (REQ-VER-008): the archive of a
 * `MERGED` Change — SCN-VER-036 —, the refusal outside `MERGED` —
 * SCN-VER-037 — and the refusal when `spec-valid` fails — SCN-VER-038.
 *
 * Each case copies the synced core-sdd project, writes a complete `feature`
 * Change `add-search` that `openspec validate --strict` accepts (or, for
 * SCN-VER-038, rejects), commits it on `main` and archives on
 * `archive/add-search`. `analyze-clean` has no producer in phase 3 and is
 * waived, as in the repository (P-16).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { openspecAvailable } from "../helpers/openspec.js";
import { removeDir, runCli, type CliRun } from "../helpers/cli.js";
import { PACKS, record, useSyncedProject, validate, write } from "../helpers/synced.js";

const hasOpenspec = openspecAvailable();
const hasGit = spawnSync("git", ["--version"]).status === 0;
const project = useSyncedProject();
const RECORD = ".warrant/changes/add-search.json";
const ACTIVE = "openspec/changes/add-search";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

function env(): NodeJS.ProcessEnv {
  return { WARRANT_PACKS_DIR: PACKS, GITHUB_ACTIONS: "" };
}

function cli(root: string, args: string[]): Promise<CliRun> {
  return runCli(args, root, env());
}

function git(cwd: string, ...args: string[]): string {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
  return run.stdout.trim();
}

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}

const SPEC_VALID = `# Spec Delta

## Purpose

Lets users find items by a text query, so that they do not browse every page.

## ADDED Requirements

### Requirement: Search by text

The system SHALL return every item whose title contains the query.

#### Scenario: Match
- **WHEN** a user searches for "lamp"
- **THEN** every item with "lamp" in its title is returned
`;

/** A requirement without a scenario: \`openspec validate --strict\` rejects it. */
const SPEC_INVALID = `# Spec Delta

## Purpose

Lets users find items by a text query, so that they do not browse every page.

## ADDED Requirements

### Requirement: Search by text

The system SHALL return every item whose title contains the query.
`;

function change(root: string, spec: string): void {
  write(
    root,
    `${ACTIVE}/proposal.md`,
    "# Proposal: add-search\n\n## Why\n\nUsers cannot find items without browsing every page of the catalogue.\n\n## What Changes\n\n- Add text search.\n\n## Capabilities\n\n### New Capabilities\n\n- `search`: text search over items.\n"
  );
  write(root, `${ACTIVE}/design.md`, "# Design\n\n## Context\n\nA linear scan is enough for the catalogue size.\n");
  write(root, `${ACTIVE}/tasks.md`, "# Tasks\n\n## 1. Search\n\n- [x] 1.1 Implement search and verify the unit test passes\n");
  write(root, `${ACTIVE}/specs/search/spec.md`, spec);
  write(root, ".warrant/waivers/WAV-2026-001.json", {
    $schema: "warrant://waiver/1",
    id: "WAV-2026-001",
    change: "add-search",
    gate: "analyze-clean",
    reason: "warrant analyze is not implemented in phase 3",
    owner: "kat",
    approved_by: "human:kat",
    expires_at: "2099-12-31",
    waiver_state: "ACTIVE"
  });
}

/** Record in `state`, the Change committed on `main`, HEAD on `archive/add-search`. */
function repo(state: string, spec = SPEC_VALID): string {
  const root = project();
  write(root, RECORD, record("add-search", state, { classification: { profiles: ["feature"] } }));
  change(root, spec);
  git(root, "-c", "init.defaultBranch=main", "init", "--quiet");
  git(root, "config", "user.name", "warrant-test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "checkout", "--quiet", "-B", "main");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "base");
  git(root, "checkout", "--quiet", "-b", "archive/add-search");
  return root;
}

describe.skipIf(!hasOpenspec || !hasGit)("warrant archive", () => {
  it("validates, gates, archives through OpenSpec and records ARCHIVED (SCN-VER-036)", async () => {
    const root = repo("MERGED");
    const run = await cli(root, ["archive", "add-search"]);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);

    const data = run.json.data;
    expect(data.transition).toBe("MERGED->ARCHIVED");
    expect(data.checks).toEqual([expect.objectContaining({ id: "openspec-validate", kind: "spec-report", evidence_status: "PROVEN" })]);
    expect(data.gates).toEqual({
      "analyze-clean": "WAIVED",
      "ids-valid": "PASS",
      "required-artifacts-present": "PASS",
      "spec-valid": "PASS"
    });
    expect(data.archive).toMatch(/^openspec\/changes\/archive\/\d{4}-\d{2}-\d{2}-add-search$/);
    expect(existsSync(path.join(root, data.archive, "proposal.md"))).toBe(true);
    expect(existsSync(path.join(root, ACTIVE))).toBe(false);
    expect(existsSync(path.join(root, "openspec/specs/search/spec.md"))).toBe(true);

    const stored = readJson(path.join(root, RECORD));
    expect(stored.change_state).toBe("ARCHIVED");
    expect(stored.transitions.at(-1)).toEqual({
      to: "ARCHIVED",
      at: expect.any(String),
      by: "cli:local",
      effective_policy_hash: expect.stringMatching(/^sha256:/),
      gates: data.gates,
      evidence: [data.checks[0].evidence]
    });

    const status = await cli(root, ["status", "add-search"]);
    expect(status.json.data.stale).toEqual([]);
    expect((await validate(root)).json?.errors).toEqual([]);

    // The record is frozen from now on.
    const again = await cli(root, ["archive", "add-search"]);
    expect(again.json.errors[0].code).toBe("RECORD_FROZEN");
    expect(again.status).toBe(3);
  }, 180_000);

  it("refuses a Change that is not MERGED with STATE_INVALID and moves nothing (SCN-VER-037)", async () => {
    const root = repo("VERIFYING");
    const before = readFileSync(path.join(root, RECORD), "utf8");
    const run = await cli(root, ["archive", "add-search"]);
    expect(run.json.errors[0].code).toBe("STATE_INVALID");
    expect(run.status).toBe(3);
    expect(existsSync(path.join(root, ACTIVE))).toBe(true);
    expect(readFileSync(path.join(root, RECORD), "utf8")).toBe(before);
  }, 60_000);

  it("does not call openspec archive when spec-valid fails (SCN-VER-038)", async () => {
    const root = repo("MERGED", SPEC_INVALID);
    const before = readFileSync(path.join(root, RECORD), "utf8");
    const run = await cli(root, ["archive", "add-search"]);
    expect(run.json.ok).toBe(false);
    expect(run.json.errors.map((e: { code: string }) => e.code)).toEqual(["GATES_NOT_PASSED"]);
    expect(run.json.data.gates["spec-valid"]).toBe("FAIL");
    expect(run.status).toBe(2);
    expect(existsSync(path.join(root, ACTIVE, "proposal.md"))).toBe(true);
    // Nothing under openspec/ moved or appeared: OpenSpec archive was not run.
    expect(git(root, "status", "--porcelain", "--", "openspec")).toBe("");
    expect(readFileSync(path.join(root, RECORD), "utf8")).toBe(before);
  }, 180_000);
});
