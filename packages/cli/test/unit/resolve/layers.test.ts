/** Layer collection: `match` semantics, `extends` order and cycle detection (design D-6). */
import { describe, expect, it } from "vitest";

import type { LoadResult, PackObject } from "../../../src/core/packs/types.js";
import { collectLayers, findRiskLevels } from "../../../src/core/resolve/layers.js";
import { CLI_VERSION } from "../../../src/version.js";

function loaded(objects: PackObject[], packs = [{ id: "p", version: "1.0.0" }]): LoadResult {
  return {
    config: { kernel: "0.1", openspec: "*", packs: [], defaults: { checkTimeoutS: undefined }, paths: {}, roles: new Map() },
    packs: packs.map((p) => ({
      ...p,
      dir: `/packs/${p.id}`,
      source: "bundled",
      manifest: {},
      manifestPath: `packs/${p.id}/pack.json`
    })),
    objects,
    rules: [],
    evidenceKinds: [],
    files: [],
    errors: []
  };
}

function overlay(id: string, json: Record<string, unknown>, pack = "p"): PackObject {
  return {
    kind: "overlay",
    id,
    pack,
    path: `packs/${pack}/overlays/${id}.json`,
    json: { $schema: "warrant://overlay/1", id, version: "1.0.0", ...json }
  };
}

function profile(id: string, json: Record<string, unknown>, pack = "p"): PackObject {
  return {
    kind: "profile",
    id,
    pack,
    path: `packs/${pack}/profiles/${id}.json`,
    json: { $schema: "warrant://profile/1", id, version: "1.0.0", ...json }
  };
}

const labels = (group: { label: string }[]): string[] => group.map((l) => l.label);

describe("collectLayers", () => {
  it("puts unconditional overlays in default and local ones in project", () => {
    const result = collectLayers(
      loaded([
        overlay("base", {}),
        overlay("empty-match", { match: {} }),
        overlay("local-base", {}, "local")
      ]),
      undefined,
      "MEDIUM"
    );
    expect(labels(result.layers.default)).toEqual(["overlay/base", "overlay/empty-match"]);
    expect(labels(result.layers.project)).toEqual(["overlay/local-base"]);
    expect(result.layers.risk).toEqual([]);
  });

  it("leaves the risk group empty without a classification (SCN-KRN-068)", () => {
    const result = collectLayers(
      loaded([overlay("risk-medium", { match: { risk_level: ["MEDIUM"] } })]),
      undefined,
      "MEDIUM"
    );
    expect(result.layers.risk).toEqual([]);
  });

  it("matches an overlay on risk_level", () => {
    const objects = [overlay("m", { match: { risk_level: ["MEDIUM"] } })];
    expect(labels(collectLayers(loaded(objects), {}, "MEDIUM").layers.risk)).toEqual(["overlay/m"]);
    expect(collectLayers(loaded(objects), {}, "HIGH").layers.risk).toEqual([]);
  });

  it("matches an overlay on a single risk dimension", () => {
    const objects = [overlay("sec", { match: { security_impact: ["HIGH"] } })];
    const hit = collectLayers(
      loaded(objects),
      { risk: { security_impact: { value: "HIGH", from: "human:kat" } } },
      "MEDIUM"
    );
    expect(labels(hit.layers.risk)).toEqual(["overlay/sec"]);
    // A dimension the classification does not carry cannot match.
    expect(collectLayers(loaded(objects), {}, "MEDIUM").layers.risk).toEqual([]);
  });

  it("matches an overlay on profiles by intersection, including inherited ones", () => {
    const objects = [
      overlay("f", { match: { profiles: ["feature"] } }),
      profile("feature", {}),
      profile("hotfix", { extends: ["feature"] })
    ];
    expect(labels(collectLayers(loaded(objects), { profiles: ["hotfix"] }, "MEDIUM").layers.risk)).toEqual([
      "overlay/f"
    ]);
    expect(collectLayers(loaded(objects), { profiles: [] }, "MEDIUM").layers.risk).toEqual([]);
  });

  it("requires every key of match to agree", () => {
    const objects = [overlay("both", { match: { risk_level: ["HIGH"], profiles: ["feature"] } }), profile("feature", {})];
    expect(collectLayers(loaded(objects), { profiles: ["feature"] }, "MEDIUM").layers.risk).toEqual([]);
    expect(labels(collectLayers(loaded(objects), { profiles: ["feature"] }, "HIGH").layers.risk)).toEqual([
      "overlay/both"
    ]);
  });

  it("expands extends depth first, parents before children, once each", () => {
    const result = collectLayers(
      loaded([
        profile("feature", {}),
        profile("data-change", { extends: ["feature"] }),
        profile("hotfix", { extends: ["data-change", "feature"] })
      ]),
      { profiles: ["hotfix"] },
      "MEDIUM"
    );
    expect(labels(result.layers.profiles)).toEqual([
      "profile/feature",
      "profile/data-change",
      "profile/hotfix"
    ]);
    expect(result.errors).toEqual([]);
  });

  it("reports an extends cycle as CONFIG_INVALID", () => {
    const result = collectLayers(
      loaded([profile("a", { extends: ["b"] }), profile("b", { extends: ["a"] })]),
      { profiles: ["a"] },
      "MEDIUM"
    );
    expect(result.errors[0]?.code).toBe("CONFIG_INVALID");
    expect(result.errors[0]?.message).toContain("cycle");
  });

  it("reports an unknown profile id as CONFIG_INVALID", () => {
    const result = collectLayers(loaded([]), { profiles: ["nope"] }, "MEDIUM");
    expect(result.errors[0]?.code).toBe("CONFIG_INVALID");
    expect(result.errors[0]?.message).toContain("nope");
  });

  it("writes sources per 05 section 6, kernel first and local by content hash", () => {
    const result = collectLayers(
      loaded([overlay("base", {}), overlay("mine", {}, "local"), profile("feature", {})]),
      { profiles: ["feature"] },
      "MEDIUM"
    );
    expect(result.sources[0]).toBe(`kernel@${CLI_VERSION}`);
    expect(result.sources[1]).toBe("p@1.0.0:overlay/base@1.0.0");
    expect(result.sources[2]).toMatch(/^project:\.warrant\/local@sha256:[0-9a-f]{64}$/);
    expect(result.sources[3]).toBe("p@1.0.0:profile/feature@1.0.0");
  });

  it("orders a layer group by pack order and then by path", () => {
    const result = collectLayers(
      loaded(
        [overlay("z", {}, "a"), overlay("a", {}, "b"), overlay("b", {}, "a")],
        [
          { id: "a", version: "1.0.0" },
          { id: "b", version: "1.0.0" }
        ]
      ),
      undefined,
      "MEDIUM"
    );
    expect(labels(result.layers.default)).toEqual(["overlay/b", "overlay/z", "overlay/a"]);
  });
});

describe("findRiskLevels", () => {
  it("takes the id from the object (I-9)", () => {
    const doc = findRiskLevels(
      loaded([
        {
          kind: "risk-levels",
          id: "levels",
          pack: "p",
          path: "packs/p/risk/levels.json",
          json: { $schema: "warrant://risk-levels/1", default: "MEDIUM" }
        }
      ])
    );
    expect(doc?.id).toBe("levels");
    expect(doc?.default).toBe("MEDIUM");
  });

  it("is undefined when no pack provides one", () => {
    expect(findRiskLevels(loaded([]))).toBeUndefined();
  });
});
