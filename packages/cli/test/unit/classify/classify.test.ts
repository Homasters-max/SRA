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

describe("classify: human source (REQ-KRN-028, P-5)", () => {
  it("writes a human value and profile with from human:<login> (SCN-KRN-105)", () => {
    const result = classify({
      changed: [],
      floors: [FLOOR_SYSTEM],
      profiles: [],
      human: { login: "kat", risk: { security_impact: "HIGH" }, profiles: ["feature"] }
    });
    expect(result.classification.risk?.security_impact).toEqual({ value: "HIGH", from: "human:kat" });
    expect(result.classification.profiles).toEqual(["feature"]);
    expect(result.profiles).toEqual([{ id: "feature", from: "human:kat" }]);
    expect(result.belowFloor).toEqual([]);
  });

  it("reports a human value below the floor instead of merging it (SCN-KRN-106)", () => {
    const result = classify({
      changed: [".warrant/local/areas.json"],
      floors: [FLOOR_SYSTEM],
      profiles: [],
      human: { login: "kat", risk: { blast_radius: "LOCAL" } }
    });
    expect(result.belowFloor).toEqual([
      { dimension: "blast_radius", value: "LOCAL", floor: "SYSTEM", from: "floor:core-sdd:2" }
    ]);
    expect(result.classification.risk?.blast_radius).toEqual({ value: "SYSTEM", from: "floor:core-sdd:2" });
  });

  it("confirms the floor value under the human's name", () => {
    const result = classify({
      changed: [".warrant/local/areas.json"],
      floors: [FLOOR_SYSTEM],
      profiles: [],
      human: { login: "kat", risk: { blast_radius: "SYSTEM" } }
    });
    expect(result.classification.risk?.blast_radius).toEqual({ value: "SYSTEM", from: "human:kat" });
    expect(result.belowFloor).toEqual([]);
  });

  it("takes the maximum of floor, proposer and human", () => {
    const result = classify({
      changed: [],
      floors: [],
      profiles: [],
      propose: { risk: { data_loss: "HIGH", compatibility: "COMPATIBLE" } },
      human: { login: "kat", risk: { data_loss: "LOW", compatibility: "BREAKING" } }
    });
    expect(result.classification.risk?.data_loss).toEqual({ value: "HIGH", from: "proposer" });
    expect(result.classification.risk?.compatibility).toEqual({ value: "BREAKING", from: "human:kat" });
    expect(result.ignored).toEqual([
      { dimension: "data_loss", proposed: "LOW", kept: "HIGH", reason: "below-proposer", from: "human:kat" },
      { dimension: "compatibility", proposed: "COMPATIBLE", kept: "BREAKING", reason: "below-human" }
    ]);
  });

  it("never lowers a recorded value (monotonic)", () => {
    const result = classify({
      changed: [],
      floors: [],
      profiles: [],
      previous: { risk: { security_impact: { value: "HIGH", from: "proposer" } }, profiles: ["chore"] },
      human: { login: "kat", risk: { security_impact: "LOW" }, profiles: ["chore", "feature"] }
    });
    expect(result.classification.risk?.security_impact).toEqual({ value: "HIGH", from: "record" });
    expect(result.ignored).toEqual([
      { dimension: "security_impact", proposed: "LOW", kept: "HIGH", reason: "below-record", from: "human:kat" }
    ]);
    expect(result.profiles).toEqual([
      { id: "chore", from: "record" },
      { id: "feature", from: "human:kat" }
    ]);
  });
});
