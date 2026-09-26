/**
 * The inputs of {@link classify} that the enabled packs contribute: floor rules
 * and profiles with `match.paths` (REQ-KRN-028). Shared by `warrant classify`
 * (packs of the project) and `warrant ci` (packs of the base of a pull request,
 * I-171), so both classify by the same rules.
 */
import { isPlainObject } from "../json.js";
import type { PackObject } from "../packs/types.js";
import { RISK_DIMENSIONS, type RiskDimension } from "../resolve/types.js";
import type { FloorRule, ProfileMatch } from "./types.js";

type Objects = readonly Pick<PackObject, "kind" | "pack" | "id" | "json">[];

/** Floor rules of every enabled pack, with the index of the rule inside its file. */
export function collectFloors(objects: Objects): FloorRule[] {
  const out: FloorRule[] = [];
  for (const object of objects) {
    if (object.kind !== "risk-floor" || !isPlainObject(object.json)) continue;
    const floors = object.json["floors"];
    if (!Array.isArray(floors)) continue;
    floors.forEach((rule, index) => {
      if (!isPlainObject(rule)) return;
      const paths = Array.isArray(rule["paths"]) ? rule["paths"].filter((p): p is string => typeof p === "string") : [];
      const set: Partial<Record<RiskDimension, string>> = {};
      if (isPlainObject(rule["set"])) {
        for (const dimension of RISK_DIMENSIONS) {
          const value = (rule["set"] as Record<string, unknown>)[dimension];
          if (typeof value === "string") set[dimension] = value;
        }
      }
      out.push({ pack: object.pack, index, paths, set });
    });
  }
  return out;
}

/** Profiles with `match.paths`: the candidates the changed paths propose. */
export function collectProfileMatches(objects: Objects): ProfileMatch[] {
  const out: ProfileMatch[] = [];
  for (const object of objects) {
    if (object.kind !== "profile" || !isPlainObject(object.json)) continue;
    const match = object.json["match"];
    if (!isPlainObject(match)) continue;
    const paths = Array.isArray(match["paths"]) ? match["paths"].filter((p): p is string => typeof p === "string") : [];
    if (paths.length === 0) continue;
    out.push({ pack: object.pack, id: object.id, paths });
  }
  return out;
}
