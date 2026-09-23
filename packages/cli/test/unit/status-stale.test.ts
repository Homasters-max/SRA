/** `computeStale`: record versus the change directory (REQ-KRN-027, 04 section 9). */
import { describe, expect, it } from "vitest";

import { computeStale } from "../../src/core/status/stale.js";

describe("computeStale", () => {
  it("is silent while the directory is where the record says it is", () => {
    expect(computeStale("add-search", { where: "active", path: "openspec/changes/add-search" }, "PROPOSED")).toEqual([]);
  });

  it("reports a missing directory with the path it looked for", () => {
    expect(computeStale("add-search", null, "SPECIFIED")).toEqual([
      {
        code: "CHANGE_DIR_MISSING",
        message: 'record exists but there is no change directory and no archived copy of "add-search"',
        path: "openspec/changes/add-search"
      }
    ]);
  });

  it("reports an archived directory whose record never transitioned", () => {
    const location = { where: "archive", path: "openspec/changes/archive/2026-09-22-add-search" } as const;
    expect(computeStale("add-search", location, "MERGED")).toEqual([
      {
        code: "ARCHIVED_WITHOUT_TRANSITION",
        message: "change directory is archived but the record is in MERGED, not ARCHIVED",
        path: location.path
      }
    ]);
  });

  it("accepts an archived directory once the record is ARCHIVED", () => {
    const location = { where: "archive", path: "openspec/changes/archive/2026-09-22-add-search" } as const;
    expect(computeStale("add-search", location, "ARCHIVED")).toEqual([]);
  });

  it("reports an ABANDONED record whose directory is still there (SCN-KRN-102, D-22)", () => {
    expect(computeStale("add-search", { where: "active", path: "openspec/changes/add-search" }, "ABANDONED")).toEqual([
      {
        code: "ABANDONED_DIR_PRESENT",
        message: 'record is ABANDONED but the change directory of "add-search" still exists',
        path: "openspec/changes/add-search"
      }
    ]);
  });

  it("does not report CHANGE_DIR_MISSING for an ABANDONED record (SCN-KRN-102)", () => {
    expect(computeStale("add-search", null, "ABANDONED")).toEqual([]);
  });

  it("still reports an archived copy of an ABANDONED change as ARCHIVED_WITHOUT_TRANSITION", () => {
    const location = { where: "archive", path: "openspec/changes/archive/2026-09-22-add-search" } as const;
    expect(computeStale("add-search", location, "ABANDONED").map((s) => s.code)).toEqual(["ARCHIVED_WITHOUT_TRANSITION"]);
  });
});
