/**
 * Scenario coverage (ADR-0033 п. 6, R4): `scripts/dev/scn-coverage-lib.js` — scenarios `<!-- id: SCN-… -->` of delta
 * specs (not under `## REMOVED Requirements`) against the ids tests name.
 */
import { describe, expect, it } from "vitest";

import { coverage, referencedIds, scenarioIds } from "../../../../../scripts/dev/scn-coverage-lib.js";

const SPEC = [
  "## ADDED Requirements",
  "### Requirement: A",
  "#### Scenario: a1",
  "<!-- id: SCN-VER-001 -->",
  "## MODIFIED Requirements",
  "<!-- id: SCN-VER-002 -->",
  "<!--id:SCN-KRN-010-->",
  "## REMOVED Requirements",
  "<!-- id: SCN-VER-003 -->",
  "text SCN-VER-004 without an id comment",
].join("\n");

describe("scn-coverage — ADR-0033 п. 6", () => {
  it("scenarioIds: id comments outside REMOVED, in order", () => {
    expect(scenarioIds(SPEC)).toEqual(["SCN-VER-001", "SCN-VER-002", "SCN-KRN-010"]);
  });

  it("referencedIds: any mention in a test text", () => {
    expect([...referencedIds('it("SCN-VER-001: x", () => {}); // SCN-KRN-010, SCN-X')]).toEqual(["SCN-VER-001", "SCN-KRN-010"]);
  });

  it("coverage: missing scenarios in spec order; duplicates across files count once", () => {
    expect(coverage([SPEC, "<!-- id: SCN-VER-001 -->"], ['it("SCN-VER-002 …")'])).toEqual({
      total: 3,
      covered: 1,
      missing: ["SCN-VER-001", "SCN-KRN-010"],
    });
    expect(coverage([], [])).toEqual({ total: 0, covered: 0, missing: [] });
  });
});
