/**
 * `scope-valid` path sets by transition (REQ-VER-004, D-15) and the parsing of
 * `git diff --name-status -z` (design §9).
 */
import { describe, expect, it } from "vitest";

import { parseNameStatus } from "../../../src/adapters/git-cli.js";
import { relativeToProject, type DiffEntry } from "../../../src/core/git/facts.js";
import { scopeViolations } from "../../../src/core/gates/l0/scope-valid.js";

const POLICY_PATHS = [".warrant/**", "openspec/schemas/**", "openspec/config.yaml", "packs/**", "packages/cli/schemas/**", "sra/skills/**"];

function violations(transition: string, entries: DiffEntry[], profiles: string[] = ["feature"]): string[] | null {
  return scopeViolations(entries, { transition, change: "add-search", profiles, policyPaths: POLICY_PATHS });
}

describe("git diff --name-status -z", () => {
  it("reads single paths, renames as pairs and drops paths outside the project", () => {
    const out = "M\0app/src/a.ts\0R100\0app/openspec/changes/x/p.md\0app/openspec/changes/archive/2026-09-22-x/p.md\0D\0other/b.ts\0";
    const entries = parseNameStatus(out);
    expect(entries).toEqual([
      { status: "M", path: "app/src/a.ts" },
      { status: "R", path: "app/openspec/changes/archive/2026-09-22-x/p.md", from: "app/openspec/changes/x/p.md" },
      { status: "D", path: "other/b.ts" }
    ]);
    expect(relativeToProject(entries, "app")).toEqual([
      { status: "M", path: "src/a.ts" },
      { status: "R", path: "openspec/changes/archive/2026-09-22-x/p.md", from: "openspec/changes/x/p.md" }
    ]);
  });
});

describe("scope-valid", () => {
  it("impl-PR touching openspec/specs/** fails with that path (SCN-VER-019)", () => {
    expect(
      violations("VERIFYING->MERGED", [
        { status: "M", path: "src/search.ts" },
        { status: "M", path: "openspec/specs/search/spec.md" }
      ])
    ).toEqual(["openspec/specs/search/spec.md"]);
  });

  it("archive-PR inside its own archive directory passes (SCN-VER-020)", () => {
    expect(
      violations("MERGED->ARCHIVED", [
        {
          status: "R",
          path: "openspec/changes/archive/2026-09-22-add-search/proposal.md",
          from: "openspec/changes/add-search/proposal.md"
        },
        { status: "D", path: "openspec/changes/add-search/tasks.md" },
        { status: "A", path: "openspec/specs/search/spec.md" },
        { status: "M", path: ".warrant/changes/add-search.json" }
      ])
    ).toEqual([]);
    // Someone else's archive, or an edit (not a removal) of the change directory, is out of scope.
    expect(
      violations("MERGED->ARCHIVED", [
        { status: "A", path: "openspec/changes/archive/2026-09-22-other/proposal.md" },
        { status: "M", path: "openspec/changes/add-search/proposal.md" }
      ])
    ).toEqual(["openspec/changes/add-search/proposal.md", "openspec/changes/archive/2026-09-22-other/proposal.md"]);
  });

  it("policy paths need factory-change among the profiles (SCN-VER-021)", () => {
    const entries: DiffEntry[] = [{ status: "M", path: "packs/core-sdd/gates/spec-valid.json" }];
    expect(violations("VERIFYING->MERGED", entries, ["feature"])).toEqual(["packs/core-sdd/gates/spec-valid.json"]);
    expect(violations("VERIFYING->MERGED", entries, ["factory-change"])).toEqual([]);
  });

  it("impl-PR may touch its own record and evidence, not those of other Changes nor the archive", () => {
    expect(
      violations("VERIFYING->MERGED", [
        { status: "M", path: ".warrant/changes/add-search.json" },
        { status: "A", path: ".warrant/evidence/add-search/EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3.json" },
        { status: "M", path: ".warrant/changes/other.json" },
        { status: "A", path: ".warrant/evidence/other/manifest.json" },
        { status: "M", path: "openspec/changes/archive/2026-01-01-old/design.md" }
      ], ["factory-change"])
    ).toEqual([".warrant/changes/other.json", ".warrant/evidence/other/manifest.json", "openspec/changes/archive/2026-01-01-old/design.md"]);
  });

  it("spec-PR stays inside its change directory and record", () => {
    expect(
      violations("SPECIFIED->APPROVED", [
        { status: "A", path: "openspec/changes/add-search/proposal.md" },
        { status: "M", path: ".warrant/changes/add-search.json" },
        { status: "M", path: "src/search.ts" }
      ])
    ).toEqual(["src/search.ts"]);
  });

  it("has no path set for other transitions", () => {
    expect(violations("PROPOSED->SPECIFIED", [])).toBeNull();
  });
});
