/** Merge semantics of 05 section 5 on hand-built layers. */
import { describe, expect, it } from "vitest";

import { resolve } from "../../../src/core/resolve/merge.js";
import type { Layers, PolicyBody, PolicyLayer } from "../../../src/core/resolve/types.js";

function layer(label: string, body: PolicyBody): PolicyLayer {
  return { source: `p@1.0.0:${label}@1.0.0`, label, body };
}

function layers(partial: Partial<Layers>): Layers {
  return { default: [], project: [], profiles: [], risk: [], ...partial };
}

function run(partial: Partial<Layers>, riskLevel: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM") {
  return resolve({
    layers: layers(partial),
    sources: ["kernel@0.1.0"],
    riskLevel,
    riskLevelFrom: "test"
  });
}

describe("resolve", () => {
  it("always returns every key, empty when nothing contributes", () => {
    const result = run({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.policy).toEqual({
      hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      sources: ["kernel@0.1.0"],
      risk_level: "MEDIUM",
      artifacts: { required: [], recommended: [], forbidden: [] },
      gates: {},
      capabilities: { forbidden: [] },
      approvals: [],
      evidence: { required: [] },
      explain: [{ item: "risk_level:MEDIUM", from: "test" }]
    });
  });

  it("unions gates per transition and records each source (SCN-KRN-066)", () => {
    const result = run({
      profiles: [layer("profile/feature", { gates: { "VERIFYING->MERGED": ["tests-passed"] } })],
      risk: [layer("overlay/risk-high", { gates: { "VERIFYING->MERGED": ["adversarial-review"] } })]
    });
    if (!result.ok) throw new Error("expected success");
    expect(result.policy.gates).toEqual({
      "VERIFYING->MERGED": ["adversarial-review", "tests-passed"]
    });
    expect(result.policy.explain).toContainEqual({ item: "gate:tests-passed", from: "profile/feature" });
    expect(result.policy.explain).toContainEqual({
      item: "gate:adversarial-review",
      from: "overlay/risk-high"
    });
  });

  it("drops from recommended whatever became required", () => {
    const result = run({
      default: [layer("overlay/base", { artifacts: { recommended: ["design", "adr"] } })],
      profiles: [layer("profile/feature", { artifacts: { required: ["design"] } })]
    });
    if (!result.ok) throw new Error("expected success");
    expect(result.policy.artifacts.required).toEqual(["design"]);
    expect(result.policy.artifacts.recommended).toEqual(["adr"]);
    expect(result.policy.explain).not.toContainEqual({
      item: "artifact.recommended:design",
      from: "overlay/base"
    });
  });

  it("unions approvals on the pair (role, at) and sorts them", () => {
    const result = run({
      default: [layer("overlay/base", { approvals: [{ role: "security", at: "APPROVED->IMPLEMENTING" }] })],
      profiles: [
        layer("profile/feature", {
          approvals: [
            { role: "security", at: "APPROVED->IMPLEMENTING" },
            { role: "maintainer", at: "VERIFYING->MERGED" }
          ]
        })
      ]
    });
    if (!result.ok) throw new Error("expected success");
    expect(result.policy.approvals).toEqual([
      { role: "maintainer", at: "VERIFYING->MERGED" },
      { role: "security", at: "APPROVED->IMPLEMENTING" }
    ]);
    expect(result.policy.explain.filter((e) => e.item.startsWith("approval:"))).toHaveLength(3);
  });

  it("is independent of the order of layers inside a group", () => {
    const a = layer("profile/a", { artifacts: { required: ["x"] }, evidence: { required: ["e1"] } });
    const b = layer("profile/b", { artifacts: { required: ["y"] }, evidence: { required: ["e2"] } });
    const one = run({ profiles: [a, b] });
    const two = run({ profiles: [b, a] });
    if (!one.ok || !two.ok) throw new Error("expected success");
    expect(one.policy.hash).toBe(two.policy.hash);
    expect(one.policy.artifacts).toEqual(two.policy.artifacts);
  });

  it("reports POLICY_CONFLICT with the layers that required and forbade the item", () => {
    const result = run({
      profiles: [layer("profile/feature", { artifacts: { required: ["adr"] } })],
      risk: [layer("overlay/no-adr", { artifacts: { forbidden: ["adr"] } })]
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict).toEqual({
      code: "POLICY_CONFLICT",
      message: 'artifact "adr" is required by profile/feature and forbidden by overlay/no-adr',
      items: [{ item: "adr", required_by: ["profile/feature"], forbidden_by: ["overlay/no-adr"] }]
    });
  });

  it("does not treat capabilities.forbidden as a conflict", () => {
    const result = run({ default: [layer("overlay/base", { capabilities: { forbidden: ["PRODUCTION_WRITE"] } })] });
    if (!result.ok) throw new Error("expected success");
    expect(result.policy.capabilities.forbidden).toEqual(["PRODUCTION_WRITE"]);
  });

  it("excludes explain and sources from the hash", () => {
    const body: PolicyBody = { artifacts: { required: ["x"] } };
    const one = resolve({
      layers: layers({ profiles: [layer("profile/a", body)] }),
      sources: ["kernel@0.1.0", "p@1.0.0:profile/a@1.0.0"],
      riskLevel: "MEDIUM",
      riskLevelFrom: "one"
    });
    const two = resolve({
      layers: layers({ profiles: [layer("profile/b", body)] }),
      sources: ["kernel@9.9.9"],
      riskLevel: "MEDIUM",
      riskLevelFrom: "two"
    });
    if (!one.ok || !two.ok) throw new Error("expected success");
    expect(one.policy.hash).toBe(two.policy.hash);
  });
});
