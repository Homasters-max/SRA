/**
 * `warrant validate` check (9) of REQ-KRN-021 in the test process: stable ids
 * against `HEAD` (D-18, design §14; SCN-KRN-096, 097, 112). Each case is a
 * `ProjectBuilder` project committed into `FakeGit`; the answers of the real
 * `git` to the same questions are held by the contract (`contract/git`).
 * Moved from e2e (ADR-0025, task 5.2).
 *
 * An edit of a spec in the working tree goes through `withSpec`/`withChange`,
 * so `FakeOpenSpec` shows what the edited file holds, as the real `openspec`
 * reads it (check 5d runs in the same `validate`).
 */
import { mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { CommandResult } from "../../../src/io/output.js";
import type { ModelRequirement } from "../helpers/fakes/spec-model.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { errorCodes, validate } from "../helpers/validate.js";

const project = useProjectBuilder();

/** Moves the Change directory into `openspec/changes/archive/<dir>`; `openspec list` no longer returns it. */
function moveToArchive(p: ProjectBuilder, change: string, dir: string): void {
  mkdirSync(path.join(p.root, "openspec", "changes", "archive"), { recursive: true });
  renameSync(path.join(p.root, "openspec", "changes", change), path.join(p.root, "openspec", "changes", "archive", dir));
  p.openspec.changes.delete(change);
}

const KERNEL_PURPOSE = "Kernel behaviour for the tests.";

/** `openspec/specs/kernel/spec.md`: REQ-KRN-002 with SCN-KRN-006. */
const exitCodes = (id = "REQ-KRN-002"): ModelRequirement => ({
  name: "Exit codes",
  id,
  body: "The CLI SHALL exit with code 3 on invalid arguments.",
  scenarios: [
    { name: "Wrong arguments", id: "SCN-KRN-006", steps: "- **WHEN** an unknown command is called\n- **THEN** the exit code is 3" }
  ]
});

/** The delta of `add-search`: REQ-SRC-001 with SCN-SRC-002 and SCN-SRC-003 (without its id when `notFoundId` is false). */
const search = (notFoundId = true): ModelRequirement => ({
  name: "Search",
  id: "REQ-SRC-001",
  body: "The system SHALL find records by name.",
  scenarios: [
    { name: "Found", id: "SCN-SRC-002", steps: "- **WHEN** a known name is searched\n- **THEN** the record is returned" },
    {
      name: "Not found",
      ...(notFoundId ? { id: "SCN-SRC-003" } : {}),
      steps: "- **WHEN** an unknown name is searched\n- **THEN** nothing is returned"
    }
  ]
});

describe("warrant validate (9): stable ids against HEAD", () => {
  /** The synced project with specs and one change, committed. */
  async function committed(state: string): Promise<ProjectBuilder> {
    const p = await project()
      .withSpec("kernel", [exitCodes()], KERNEL_PURPOSE)
      .withChange("add-search", { proposal: "Search.", specs: { search: [search()] } })
      .withRecord("add-search", state)
      .synced();
    p.commit("fixture");
    return p;
  }

  it("reports ID_IMMUTABLE for an id of openspec/specs changed in the working tree (SCN-KRN-096)", async () => {
    const p = await committed("PROPOSED");
    p.withSpec("kernel", [exitCodes("REQ-KRN-200")], KERNEL_PURPOSE);
    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    const found = run.errors.filter((e) => e.code === "ID_IMMUTABLE");
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe("openspec/specs/kernel/spec.md");
    expect(found[0]?.message).toContain("REQ-KRN-002");
  });

  it("allows removing an id of a change before APPROVED and reports it from APPROVED on (SCN-KRN-097)", async () => {
    const early = await committed("SPECIFIED");
    early.withChange("add-search", { proposal: "Search.", specs: { search: [search(false)] } });
    const allowed = await validate(early);
    expect(errorCodes(allowed)).not.toContain("ID_IMMUTABLE");

    const late = await committed("APPROVED");
    late.withChange("add-search", { proposal: "Search.", specs: { search: [search(false)] } });
    const run = await validate(late);
    const found = run.errors.find((e) => e.code === "ID_IMMUTABLE");
    expect(found?.path).toBe("openspec/changes/add-search/specs/search/spec.md");
    expect(found?.message).toContain("SCN-SRC-003");
  });

  it("treats a deleted file of an APPROVED change as removing all its ids", async () => {
    const p = await committed("APPROVED");
    p.remove("openspec/changes/add-search/specs");
    p.openspec.change("add-search").specs.clear();
    const run = await validate(p);
    const ids = run.errors.filter((e) => e.code === "ID_IMMUTABLE").map((e) => e.message.split(" ")[0]);
    expect(ids).toEqual(["REQ-SRC-001", "SCN-SRC-002", "SCN-SRC-003"]);
  });

  it("follows a change directory moved to the archive instead of reporting its ids as removed", async () => {
    const p = await committed("ARCHIVED");
    moveToArchive(p, "add-search", "2026-09-22-add-search");
    const run = await validate(p);
    expect(errorCodes(run)).not.toContain("ID_IMMUTABLE");
  });

  it("ignores ABANDONED changes: abandoning deletes the directory", async () => {
    const p = await committed("ABANDONED");
    p.remove("openspec/changes/add-search");
    p.openspec.changes.delete("add-search");
    const run = await validate(p);
    expect(errorCodes(run)).not.toContain("ID_IMMUTABLE");
  });

  describe("I-77: a requirement removed by the delta of the archive commit", () => {
    const SEARCH_PURPOSE = "Search behaviour for the tests.";

    const byName: ModelRequirement = {
      name: "Поиск по имени",
      id: "REQ-SRC-001",
      body: "The system SHALL find records by name.",
      scenarios: [{ name: "Found", id: "SCN-SRC-002", steps: "- **WHEN** a known name is searched\n- **THEN** the record is returned" }]
    };

    const byTag: ModelRequirement = {
      name: "Поиск по тегам",
      id: "REQ-SRC-004",
      body: "The system SHALL find records by tag.",
      scenarios: [
        { name: "Tag found", id: "SCN-SRC-009", steps: "- **WHEN** a known tag is searched\n- **THEN** the tagged records are returned" }
      ]
    };

    /** The name requirement without the id of its scenario. */
    const byNameWithoutScenarioId: ModelRequirement = {
      ...byName,
      scenarios: [{ name: "Found", steps: "- **WHEN** a known name is searched\n- **THEN** the record is returned" }]
    };

    /** A REMOVED delta; WARRANT reads it itself (`removedRequirementNames`), the name spelled with extra spaces. */
    const DROP_TAGS_DELTA = `## REMOVED Requirements

###   Requirement:  Поиск   по тегам
**Reason**: Tags are gone.
**Migration**: Search by name.
`;

    const ARCHIVED = "2026-09-24-drop-tags";

    async function withSearch(): Promise<ProjectBuilder> {
      const p = await project()
        .withSpec("search", [byName, byTag], SEARCH_PURPOSE)
        .withChange("drop-tags", { proposal: "Tags are gone." })
        .write("openspec/changes/drop-tags/specs/search/spec.md", DROP_TAGS_DELTA)
        .withRecord("drop-tags", "MERGED")
        .synced();
      p.commit("fixture");
      return p;
    }

    /** The main spec after `openspec archive` applied the REMOVED delta. */
    function applyDelta(p: ProjectBuilder, reqs: ModelRequirement[] = [byName]): void {
      p.withSpec("search", reqs, SEARCH_PURPOSE);
    }

    function gone(run: CommandResult): string[] {
      return run.errors
        .filter((e) => e.code === "ID_IMMUTABLE")
        .map((e) => e.message.split(" ")[0] as string)
        .sort();
    }

    it("exempts the requirement and its scenarios when the archive directory is new (SCN-KRN-112)", async () => {
      const p = await withSearch();
      applyDelta(p);
      moveToArchive(p, "drop-tags", ARCHIVED);
      const run = await validate(p);
      expect(gone(run)).toEqual([]);
      expect(run.ok, JSON.stringify(run.errors)).toBe(true);
    });

    it("reports the removal without an archived delta, and other ids next to an exempt one (SCN-KRN-112)", async () => {
      const bare = await withSearch();
      applyDelta(bare);
      expect(gone(await validate(bare))).toEqual(["REQ-SRC-004", "SCN-SRC-009"]);

      // Archived delta present, but the name requirement lost its scenario id too: only that one is reported.
      const mixed = await withSearch();
      applyDelta(mixed, [byNameWithoutScenarioId]);
      moveToArchive(mixed, "drop-tags", ARCHIVED);
      expect(gone(await validate(mixed))).toEqual(["SCN-SRC-002"]);
    });

    it("does not exempt through an archive directory already committed in HEAD", async () => {
      const p = await withSearch();
      moveToArchive(p, "drop-tags", ARCHIVED);
      p.commit("archive without applying the delta");
      applyDelta(p);
      expect(gone(await validate(p))).toEqual(["REQ-SRC-004", "SCN-SRC-009"]);
    });
  });

  it("skips the check with a warning outside a git work tree", async () => {
    const p = await project().synced();
    const run = await validate(p);
    expect(run.ok).toBe(true);
    expect(p.warnings.join("")).toContain("check (9)");
  });
});
