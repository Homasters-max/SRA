import { describe, expect, it } from "vitest";

import { deriveRiskLevel } from "../../../src/core/resolve/risk-level.js";
import type { RiskLevelsDoc } from "../../../src/core/resolve/types.js";

const LEVELS: RiskLevelsDoc = {
  id: "levels",
  high: {
    when_any: {
      data_loss: ["MEDIUM", "HIGH"],
      reversibility: ["DIFFICULT", "IRREVERSIBLE"],
      security_impact: ["HIGH"],
      blast_radius: ["SYSTEM", "CROSS_SYSTEM"],
      compatibility: ["BREAKING"]
    }
  },
  low: {
    when_all: {
      data_loss: ["NONE"],
      reversibility: ["EASY"],
      blast_radius: ["LOCAL"],
      security_impact: ["NONE"],
      compatibility: ["COMPATIBLE"]
    }
  },
  default: "MEDIUM"
};

const from = "human:kat";
const dim = (value: string) => ({ value, from });

describe("deriveRiskLevel", () => {
  it("is MEDIUM without a classification (SCN-KRN-068)", () => {
    expect(deriveRiskLevel(undefined, LEVELS)).toEqual({
      level: "MEDIUM",
      explain: "default:no-classification"
    });
  });

  it("trusts an explicit risk_level in the record", () => {
    expect(deriveRiskLevel({ risk_level: "LOW" }, LEVELS)).toEqual({
      level: "LOW",
      explain: "classification.risk_level"
    });
  });

  it("is MEDIUM when the classification carries no dimension", () => {
    expect(deriveRiskLevel({ profiles: ["feature"] }, LEVELS).level).toBe("MEDIUM");
  });

  it("is HIGH on the first matching when_any dimension", () => {
    const result = deriveRiskLevel({ risk: { compatibility: dim("BREAKING") } }, LEVELS);
    expect(result.level).toBe("HIGH");
    expect(result.explain).toBe("risk-levels/levels: high.when_any compatibility=BREAKING");
  });

  it("is LOW only when every listed dimension is present and lowest", () => {
    const all = {
      data_loss: dim("NONE"),
      reversibility: dim("EASY"),
      blast_radius: dim("LOCAL"),
      security_impact: dim("NONE"),
      compatibility: dim("COMPATIBLE")
    };
    expect(deriveRiskLevel({ risk: all }, LEVELS).level).toBe("LOW");
    const partial = { ...all };
    delete (partial as Record<string, unknown>)["compatibility"];
    expect(deriveRiskLevel({ risk: partial }, LEVELS).level).toBe("MEDIUM");
  });

  it("never drops below MEDIUM when a dimension is UNKNOWN", () => {
    // A document whose default is LOW makes the floor observable.
    const lenient: RiskLevelsDoc = { ...LEVELS, default: "LOW" };
    expect(deriveRiskLevel({ risk: { data_loss: dim("LOW") } }, lenient).level).toBe("LOW");

    const result = deriveRiskLevel(
      { risk: { data_loss: dim("LOW"), compatibility: dim("UNKNOWN") } },
      lenient
    );
    expect(result.level).toBe("MEDIUM");
    expect(result.explain).toContain("compatibility is UNKNOWN");
  });

  it("keeps HIGH when a dimension is UNKNOWN", () => {
    const result = deriveRiskLevel(
      { risk: { data_loss: dim("HIGH"), compatibility: dim("UNKNOWN") } },
      LEVELS
    );
    expect(result.level).toBe("HIGH");
    expect(result.explain).toBe("risk-levels/levels: high.when_any data_loss=HIGH");
  });

  it("falls back to MEDIUM without a risk-levels document", () => {
    expect(deriveRiskLevel({ risk: { data_loss: dim("HIGH") } }, undefined)).toEqual({
      level: "MEDIUM",
      explain: "default:no-risk-levels-document"
    });
  });
});
