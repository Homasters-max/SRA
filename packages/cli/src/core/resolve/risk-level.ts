/**
 * Derivation of `risk_level` (05 section 4, design D-6, SCN-KRN-068).
 *
 * Pure: the caller supplies the classification and the `risk-levels` document
 * the pack loader found. The order is fixed by the document: `high.when_any`,
 * then `low.when_all`, then `default`; any dimension valued `UNKNOWN` raises
 * the result to at least `MEDIUM`, conservatively (INV-10).
 */
import { RISK_DIMENSIONS, type Classification, type RiskLevel, type RiskLevelsDoc } from "./types.js";

export interface DerivedRiskLevel {
  level: RiskLevel;
  /** Note recorded as `explain[].from` of the `risk_level:<L>` entry. */
  explain: string;
}

const RANK: Readonly<Record<RiskLevel, number>> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function atLeastMedium(level: RiskLevel): RiskLevel {
  return RANK[level] >= RANK.MEDIUM ? level : "MEDIUM";
}

export function deriveRiskLevel(
  classification?: Classification,
  riskLevels?: RiskLevelsDoc
): DerivedRiskLevel {
  if (classification === undefined) {
    return { level: "MEDIUM", explain: "default:no-classification" };
  }
  if (classification.risk_level !== undefined) {
    return { level: classification.risk_level, explain: "classification.risk_level" };
  }

  const risk = classification.risk;
  const present = risk === undefined ? [] : RISK_DIMENSIONS.filter((d) => risk[d] !== undefined);
  if (present.length === 0) {
    return { level: "MEDIUM", explain: "default:no-risk-dimensions" };
  }

  // An UNKNOWN dimension may only raise the result, so it is decided after the rules.
  const unknown = present.find((d) => risk?.[d]?.value === "UNKNOWN");
  const raise = (result: DerivedRiskLevel): DerivedRiskLevel => {
    if (unknown === undefined) return result;
    const level = atLeastMedium(result.level);
    if (level === result.level) return result;
    return { level, explain: `${result.explain} (raised to MEDIUM: ${unknown} is UNKNOWN)` };
  };

  if (riskLevels === undefined) {
    // Nothing tells us how to aggregate the dimensions, so fail safe in the middle.
    return { level: "MEDIUM", explain: "default:no-risk-levels-document" };
  }

  const whenAny = riskLevels.high?.when_any;
  if (whenAny !== undefined) {
    for (const dim of RISK_DIMENSIONS) {
      const allowed = whenAny[dim];
      const value = risk?.[dim]?.value;
      if (allowed !== undefined && value !== undefined && allowed.includes(value)) {
        return raise({
          level: "HIGH",
          explain: `risk-levels/${riskLevels.id}: high.when_any ${dim}=${value}`
        });
      }
    }
  }

  const whenAll = riskLevels.low?.when_all;
  if (whenAll !== undefined) {
    const dims = RISK_DIMENSIONS.filter((d) => whenAll[d] !== undefined);
    const all =
      dims.length > 0 &&
      dims.every((d) => {
        const value = risk?.[d]?.value;
        return value !== undefined && (whenAll[d] as string[]).includes(value);
      });
    if (all) return raise({ level: "LOW", explain: `risk-levels/${riskLevels.id}: low.when_all` });
  }

  return raise({ level: riskLevels.default ?? "MEDIUM", explain: `risk-levels/${riskLevels.id}: default` });
}
