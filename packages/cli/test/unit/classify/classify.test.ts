import { describe, expect, it } from "vitest";

import { classify, normalizePath } from "../../../src/core/classify/index.js";

const FLOOR_SYSTEM = {
  pack: "core-sdd",
  index: 2,
  paths: [".warrant/**", "openspec/schemas/**", "openspec/config.yaml"],
  set: { blast_radius: "SYSTEM" }
};

describe("classify", () => {
  it("raises a dimension to the floor and reports the lowered proposal (SCN-KRN-074)", () => {
    const result = classify({
      changed: [".warrant/local/areas.json"],
      floors: [FLOOR_SYSTEM],
      profiles: [],
      propose: { risk: { blast_radius: "LOCAL" } }
    });

    expect(result.classification.risk?.blast_radius).toEqual({
      value: "SYSTEM",
      from: "floor:core-sdd:2"
    });
    expect(result.ignored).toEqual([
      { dimension: "blast_radius", proposed: "LOCAL", kept: "SYSTEM", reason: "below-floor" }
    ]);
  });

  it("keeps a previously recorded value when nothing raises it (SCN-KRN-075)", () => {
    const result = classify({
      changed: ["packages/cli/src/index.ts"],
      floors: [FLOOR_SYSTEM],
      profiles: [],
      previous: { risk: { security_impact: { value: "MEDIUM", from: "proposer" } } }
    });

    expect(result.classification.risk?.security_impact).toEqual({ value: "MEDIUM", from: "record" });
    expect(result.ignored).toEqual([]);
  });

  it("proposes a profile whose match.paths agree with the diff (SCN-SDD-006)", () => {
    const result = classify({
      changed: ["docs/04-lifecycle.md"],
      floors: [FLOOR_SYSTEM],
      profiles: [
        { pack: "core-sdd", id: "chore", paths: ["docs/**", "**/*.md"] },
        { pack: "core-sdd", id: "factory-change", paths: [".warrant/**", "packs/**"] }
      ]
    });

    expect(result.profiles).toEqual([{ id: "chore", from: "match:core-sdd:chore" }]);
    expect(result.classification.profiles).toEqual(["chore"]);
    expect(result.classification.risk).toBeUndefined();
  });

  it("never drops a profile a previous run recorded", () => {
    const result = classify({
      changed: ["docs/04-lifecycle.md"],
      floors: [],
      profiles: [{ pack: "core-sdd", id: "chore", paths: ["docs/**"] }],
      propose: { profiles: ["feature"] },
      previous: { profiles: ["factory-change"] }
    });

    expect(result.profiles).toEqual([
      { id: "chore", from: "match:core-sdd:chore" },
      { id: "factory-change", from: "record" },
      { id: "feature", from: "proposer" }
    ]);
  });

  it("keeps the floor as source when a re-run finds the same floor again (I-56)", () => {
    const result = classify({
      changed: [".warrant/local/areas.json"],
      floors: [FLOOR_SYSTEM],
      profiles: [],
      previous: { risk: { blast_radius: { value: "SYSTEM", from: "floor:core-sdd:2" } } }
    });

    expect(result.classification.risk?.blast_radius?.from).toMatch(/^floor:/);
  });

  it("keeps the recorded source when the proposer repeats the same value", () => {
    const result = classify({
      changed: [],
      floors: [],
      profiles: [],
      propose: { risk: { data_loss: "MEDIUM" } },
      previous: { risk: { data_loss: { value: "MEDIUM", from: "record" } } }
    });

    expect(result.classification.risk?.data_loss).toEqual({ value: "MEDIUM", from: "record" });
    expect(result.ignored).toEqual([]);
  });

  it("lets the proposer raise a dimension above the floor", () => {
    const result = classify({
      changed: [".warrant/local/areas.json"],
      floors: [FLOOR_SYSTEM],
      profiles: [],
      propose: { risk: { blast_radius: "CROSS_SYSTEM" } }
    });

    expect(result.classification.risk?.blast_radius).toEqual({ value: "CROSS_SYSTEM", from: "proposer" });
    expect(result.ignored).toEqual([]);
  });

  it("does not let a proposed UNKNOWN beat a known floor value (I-53)", () => {
    const result = classify({
      changed: [".warrant/local/areas.json"],
      floors: [FLOOR_SYSTEM],
      profiles: [],
      propose: { risk: { blast_radius: "UNKNOWN" } }
    });

    expect(result.classification.risk?.blast_radius?.value).toBe("SYSTEM");
    expect(result.ignored.map((i) => i.dimension)).toEqual(["blast_radius"]);
  });

  it("leaves a dimension nobody spoke about absent, and never writes risk_level", () => {
    const result = classify({ changed: ["README.md"], floors: [FLOOR_SYSTEM], profiles: [] });
    expect(result.classification).toEqual({});
    expect(result.classification.risk_level).toBeUndefined();
  });

  it("matches dot directories and Windows separators", () => {
    expect(normalizePath(".warrant\\local\\areas.json")).toBe(".warrant/local/areas.json");
    const result = classify({
      changed: [".warrant\\local\\areas.json"],
      floors: [FLOOR_SYSTEM],
      profiles: []
    });
    expect(result.classification.risk?.blast_radius?.value).toBe("SYSTEM");
  });

  it("takes the strictest of several floor rules that match", () => {
    const result = classify({
      changed: ["services/auth/login.ts"],
      floors: [
        { pack: "core-sdd", index: 1, paths: ["**/auth/**"], set: { security_impact: "MEDIUM" } },
        { pack: "other", index: 0, paths: ["services/**"], set: { security_impact: "HIGH" } }
      ],
      profiles: []
    });
    expect(result.classification.risk?.security_impact).toEqual({ value: "HIGH", from: "floor:other:0" });
  });
});
