// e2e: argv
/**
 * `warrant archive` through the binary with the REAL `openspec`: `<change>` of
 * argv reaches the command, the exit code is 0 on the archive and 3 once the
 * record is frozen, and the real `openspec archive` merges the delta into the
 * main spec (SCN-VER-036). The archive itself (REQ-VER-008; SCN-VER-036, 037,
 * 038) is tested in the test process: `test/app/commands/archive.test.ts`
 * (ADR-0025, task 5.4).
 *
 * The project copies the synced core-sdd project, writes a complete `feature`
 * Change `add-search` that `openspec validate --strict` accepts, commits it on
 * `main` and archives on `archive/add-search`. `analyze-clean` has no producer
 * in phase 3 and is waived, as in the repository (P-16).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCli, type CliRun } from "../helpers/cli.js";
import { PACKS, record, useSyncedProject, write } from "../helpers/synced.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const project = useSyncedProject();
const RECORD = ".warrant/changes/add-search.json";
const ACTIVE = "openspec/changes/add-search";

function cli(root: string, args: string[]): Promise<CliRun> {
  return runCli(args, root, { WARRANT_PACKS_DIR: PACKS, GITHUB_ACTIONS: "" });
}

function git(cwd: string, ...args: string[]): void {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
}

const SPEC = `# Spec Delta

## Purpose

Lets users find items by a text query, so that they do not browse every page.

## ADDED Requirements

### Requirement: Search by text

The system SHALL return every item whose title contains the query.

#### Scenario: Match
- **WHEN** a user searches for "lamp"
- **THEN** every item with "lamp" in its title is returned
`;

/** Record MERGED, the Change committed on `main`, HEAD on `archive/add-search`. */
function repo(): string {
  const root = project();
  write(root, RECORD, record("add-search", "MERGED", { classification: { profiles: ["feature"] } }));
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
    gate: "analyze-clean",
    reason: "warrant analyze is not implemented in phase 3",
    owner: "kat",
    approved_by: "human:kat",
    expires_at: "2099-12-31",
    waiver_state: "ACTIVE"
  });
  git(root, "-c", "init.defaultBranch=main", "init", "--quiet");
  git(root, "config", "user.name", "warrant-test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "checkout", "--quiet", "-B", "main");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "base");
  git(root, "checkout", "--quiet", "-b", "archive/add-search");
  return root;
}

describe.skipIf(!hasGit)("warrant archive (argv)", () => {
  it("archives <change> with exit 0 through the real openspec, then exit 3 on the frozen record (SCN-VER-036)", async () => {
    const root = repo();
    const run = await cli(root, ["archive", "add-search"]);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json?.change).toBe("add-search");
    expect(run.json?.data.archive).toMatch(/^openspec\/changes\/archive\/\d{4}-\d{2}-\d{2}-add-search$/);
    expect(existsSync(path.join(root, ACTIVE))).toBe(false);
    // The real openspec merged the delta into the main spec.
    expect(existsSync(path.join(root, "openspec/specs/search/spec.md"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(root, RECORD), "utf8")).change_state).toBe("ARCHIVED");

    const again = await cli(root, ["archive", "add-search"]);
    expect(again.json?.errors[0].code).toBe("RECORD_FROZEN");
    expect(again.status).toBe(3);
  }, 180_000);
});
