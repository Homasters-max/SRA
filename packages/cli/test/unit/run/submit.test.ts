/**
 * The status of a review record and its counters (N22, ADR-0036 п. 4,
 * REQ-ENF-007): pure functions of `core/run/submit.ts`, and the envelope
 * refused before anything is read from the project.
 */
import { describe, expect, it } from "vitest";

import { parseEnvelope, reviewStatus, severityCounts } from "../../../src/core/run/submit.js";

describe("reviewStatus and severityCounts (N22)", () => {
  it("SUCCEEDED without a BLOCKER is PROVEN, with one NOT_PROVEN; FAILED and CANCELLED are INCONCLUSIVE whatever the findings", () => {
    const none = severityCounts([]);
    const major = severityCounts([{ severity: "MAJOR" }, { severity: "INFO" }, { severity: "MAJOR" }]);
    const blocker = severityCounts([{ severity: "BLOCKER" }, { severity: "MINOR" }]);
    expect(none).toEqual({ BLOCKER: 0, MAJOR: 0, MINOR: 0, INFO: 0 });
    expect(major).toEqual({ BLOCKER: 0, MAJOR: 2, MINOR: 0, INFO: 1 });
    expect(reviewStatus("SUCCEEDED", none)).toBe("PROVEN");
    expect(reviewStatus("SUCCEEDED", major)).toBe("PROVEN");
    expect(reviewStatus("SUCCEEDED", blocker)).toBe("NOT_PROVEN");
    for (const state of ["FAILED", "CANCELLED"] as const) {
      expect(reviewStatus(state, none)).toBe("INCONCLUSIVE");
      expect(reviewStatus(state, blocker)).toBe("INCONCLUSIVE");
    }
  });
});

describe("parseEnvelope (REQ-ENF-006)", () => {
  const valid = {
    $schema: "warrant://skill-result/1",
    skill: "specification/adversarial-review@0.2.0",
    run: "RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y",
    run_state: "SUCCEEDED",
    findings: [{ id: "F-1", severity: "MAJOR", category: "missing-boundary", statement: "No behavior for duplicates." }],
    provenance: { started_at: "2026-09-25T10:00:00Z", finished_at: "2026-09-25T10:12:00Z" }
  };

  it("a finding without marker: SKILL_RESULT_INVALID at its JSON Pointer, the file in front with --file", () => {
    const text = JSON.stringify(valid);
    expect(() => parseEnvelope({ text })).toThrow(expect.objectContaining({ code: "SKILL_RESULT_INVALID", path: "/findings/0/marker" }));
    expect(() => parseEnvelope({ text, source: "r.json" })).toThrow(expect.objectContaining({ path: "r.json#/findings/0/marker" }));
  });

  it("text that is not a JSON object has no pointer; a hint names the schema", () => {
    for (const text of ["[1]", "nope"]) {
      expect(() => parseEnvelope({ text })).toThrow(
        expect.objectContaining({ code: "SKILL_RESULT_INVALID", path: undefined, hint: expect.stringContaining("warrant://skill-result/1") })
      );
    }
  });
});
