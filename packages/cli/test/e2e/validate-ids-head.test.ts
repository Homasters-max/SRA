/**
 * `warrant validate` check (9) of REQ-KRN-021: stable ids against `HEAD`
 * (D-18, design §14; SCN-KRN-096, 097). Each case is a git repository made
 * from the synced core-sdd project.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { codes, findError, record, useSyncedProject, validate, write } from "../helpers/synced.js";

const hasGit = spawnSync("git", ["--version"]).status === 0;
const project = useSyncedProject();

/** Runs git in `cwd` with a fixed identity; throws on failure. */
function git(cwd: string, ...args: string[]): void {
  const run = spawnSync("git", ["-c", "user.name=warrant-test", "-c", "user.email=test@example.invalid", ...args], {
    cwd,
    encoding: "utf8"
  });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
}

const MAIN_SPEC = `# kernel Specification

## Purpose
Kernel behaviour for the tests.

## Requirements

### Requirement: Exit codes
<!-- id: REQ-KRN-002 -->
The CLI SHALL exit with code 3 on invalid arguments.

#### Scenario: Wrong arguments
<!-- id: SCN-KRN-006 -->
- **WHEN** an unknown command is called
- **THEN** the exit code is 3
`;

const CHANGE_SPEC = `## ADDED Requirements

### Requirement: Search
<!-- id: REQ-SRC-001 -->
The system SHALL find records by name.

#### Scenario: Found
<!-- id: SCN-SRC-002 -->
- **WHEN** a known name is searched
- **THEN** the record is returned

#### Scenario: Not found
<!-- id: SCN-SRC-003 -->
- **WHEN** an unknown name is searched
- **THEN** nothing is returned
`;

describe.skipIf(!hasGit)("warrant validate (9): stable ids against HEAD", () => {
  /** The synced project as a git repository with specs and one change committed. */
  function committed(state: string): string {
    const root = project();
    write(root, "openspec/specs/kernel/spec.md", MAIN_SPEC);
    write(root, "openspec/changes/add-search/proposal.md", "## Why\n\nSearch.\n");
    write(root, "openspec/changes/add-search/specs/search/spec.md", CHANGE_SPEC);
    write(root, ".warrant/changes/add-search.json", record("add-search", state));
    git(root, "init", "--quiet");
    git(root, "add", "-A");
    git(root, "commit", "--quiet", "-m", "fixture");
    return root;
  }

  function edit(root: string, rel: string, from: string, to: string): void {
    const absolute = path.join(root, rel);
    writeFileSync(absolute, readFileSync(absolute, "utf8").replace(from, to), "utf8");
  }

  it("reports ID_IMMUTABLE for an id of openspec/specs changed in the working tree (SCN-KRN-096)", async () => {
    const root = committed("PROPOSED");
    edit(root, "openspec/specs/kernel/spec.md", "REQ-KRN-002", "REQ-KRN-200");
    const run = await validate(root);
    expect(run.status).toBe(3);
    const found = (run.json?.errors as { code: string; message: string; path: string }[]).filter(
      (e) => e.code === "ID_IMMUTABLE"
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe("openspec/specs/kernel/spec.md");
    expect(found[0]?.message).toContain("REQ-KRN-002");
  }, 60_000);

  it("allows removing an id of a change before APPROVED and reports it from APPROVED on (SCN-KRN-097)", async () => {
    const early = committed("SPECIFIED");
    edit(early, "openspec/changes/add-search/specs/search/spec.md", "<!-- id: SCN-SRC-003 -->\n", "");
    const allowed = await validate(early);
    expect(codes(allowed)).not.toContain("ID_IMMUTABLE");

    const late = committed("APPROVED");
    edit(late, "openspec/changes/add-search/specs/search/spec.md", "<!-- id: SCN-SRC-003 -->\n", "");
    const run = await validate(late);
    const found = findError(run, "ID_IMMUTABLE");
    expect(found?.path).toBe("openspec/changes/add-search/specs/search/spec.md");
    expect(found?.message).toContain("SCN-SRC-003");
  }, 60_000);

  it("treats a deleted file of an APPROVED change as removing all its ids", async () => {
    const root = committed("APPROVED");
    rmSync(path.join(root, "openspec", "changes", "add-search", "specs"), { recursive: true, force: true });
    const run = await validate(root);
    const ids = (run.json?.errors as { code: string; message: string }[])
      .filter((e) => e.code === "ID_IMMUTABLE")
      .map((e) => e.message.split(" ")[0]);
    expect(ids).toEqual(["REQ-SRC-001", "SCN-SRC-002", "SCN-SRC-003"]);
  }, 60_000);

  it("follows a change directory moved to the archive instead of reporting its ids as removed", async () => {
    const root = committed("ARCHIVED");
    mkdirSync(path.join(root, "openspec", "changes", "archive"), { recursive: true });
    renameSync(
      path.join(root, "openspec", "changes", "add-search"),
      path.join(root, "openspec", "changes", "archive", "2026-09-22-add-search")
    );
    const run = await validate(root);
    expect(codes(run)).not.toContain("ID_IMMUTABLE");
  }, 60_000);

  it("ignores ABANDONED changes: abandoning deletes the directory", async () => {
    const root = committed("ABANDONED");
    rmSync(path.join(root, "openspec", "changes", "add-search"), { recursive: true, force: true });
    const run = await validate(root);
    expect(codes(run)).not.toContain("ID_IMMUTABLE");
  }, 60_000);

  describe("I-77: a requirement removed by the delta of the archive commit", () => {
    const SEARCH_SPEC = `# search Specification

## Purpose
Search behaviour for the tests.

## Requirements

### Requirement: Поиск по имени
<!-- id: REQ-SRC-001 -->
The system SHALL find records by name.

#### Scenario: Found
<!-- id: SCN-SRC-002 -->
- **WHEN** a known name is searched
- **THEN** the record is returned

### Requirement: Поиск по тегам
<!-- id: REQ-SRC-004 -->
The system SHALL find records by tag.

#### Scenario: Tag found
<!-- id: SCN-SRC-009 -->
- **WHEN** a known tag is searched
- **THEN** the tagged records are returned
`;

    /** The main spec after \`openspec archive\` applied the REMOVED delta. */
    const SEARCH_SPEC_AFTER = SEARCH_SPEC.slice(0, SEARCH_SPEC.indexOf("### Requirement: Поиск по тегам"));

    const DROP_TAGS_DELTA = `## REMOVED Requirements

###   Requirement:  Поиск   по тегам
**Reason**: Tags are gone.
**Migration**: Search by name.
`;

    const ARCHIVED = "openspec/changes/archive/2026-09-24-drop-tags";

    function withSearch(): string {
      const root = project();
      write(root, "openspec/specs/search/spec.md", SEARCH_SPEC);
      write(root, "openspec/changes/drop-tags/proposal.md", "## Why\n\nTags are gone.\n");
      write(root, "openspec/changes/drop-tags/specs/search/spec.md", DROP_TAGS_DELTA);
      write(root, ".warrant/changes/drop-tags.json", record("drop-tags", "MERGED"));
      git(root, "init", "--quiet");
      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "fixture");
      return root;
    }

    function gone(run: Awaited<ReturnType<typeof validate>>): string[] {
      return (run.json?.errors as { code: string; message: string }[])
        .filter((e) => e.code === "ID_IMMUTABLE")
        .map((e) => e.message.split(" ")[0] as string)
        .sort();
    }

    it("exempts the requirement and its scenarios when the archive directory is new (SCN-KRN-112)", async () => {
      const root = withSearch();
      write(root, "openspec/specs/search/spec.md", SEARCH_SPEC_AFTER);
      mkdirSync(path.join(root, "openspec", "changes", "archive"), { recursive: true });
      renameSync(path.join(root, "openspec", "changes", "drop-tags"), path.join(root, ...ARCHIVED.split("/")));
      const run = await validate(root);
      expect(gone(run)).toEqual([]);
      expect(run.json?.ok, JSON.stringify(run.json?.errors)).toBe(true);
    }, 60_000);

    it("reports the removal without an archived delta, and other ids next to an exempt one (SCN-KRN-112)", async () => {
      const bare = withSearch();
      write(bare, "openspec/specs/search/spec.md", SEARCH_SPEC_AFTER);
      expect(gone(await validate(bare))).toEqual(["REQ-SRC-004", "SCN-SRC-009"]);

      // Archived delta present, but the name requirement lost its scenario id too: only that one is reported.
      const mixed = withSearch();
      write(mixed, "openspec/specs/search/spec.md", SEARCH_SPEC_AFTER.replace("<!-- id: SCN-SRC-002 -->\n", ""));
      mkdirSync(path.join(mixed, "openspec", "changes", "archive"), { recursive: true });
      renameSync(path.join(mixed, "openspec", "changes", "drop-tags"), path.join(mixed, ...ARCHIVED.split("/")));
      expect(gone(await validate(mixed))).toEqual(["SCN-SRC-002"]);
    }, 120_000);

    it("does not exempt through an archive directory already committed in HEAD", async () => {
      const root = withSearch();
      mkdirSync(path.join(root, "openspec", "changes", "archive"), { recursive: true });
      renameSync(path.join(root, "openspec", "changes", "drop-tags"), path.join(root, ...ARCHIVED.split("/")));
      git(root, "add", "-A");
      git(root, "commit", "--quiet", "-m", "archive without applying the delta");
      write(root, "openspec/specs/search/spec.md", SEARCH_SPEC_AFTER);
      expect(gone(await validate(root))).toEqual(["REQ-SRC-004", "SCN-SRC-009"]);
    }, 60_000);
  });

  it("skips the check with a warning outside a git work tree", async () => {
    const root = project();
    const run = await validate(root);
    expect(run.json?.ok).toBe(true);
    expect(run.stderr).toContain("check (9)");
  }, 60_000);
});
