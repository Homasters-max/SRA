/**
 * Entry point of the resolver: from a loaded pack set and a classification to
 * an effective policy (design D-6). Everything below it is pure data.
 */
import type { CliError } from "../errors.js";
import type { LoadResult } from "../packs/types.js";
import { collectLayers, findRiskLevels } from "./layers.js";
import { resolve, type ResolveResult } from "./merge.js";
import { deriveRiskLevel } from "./risk-level.js";
import type { Classification } from "./types.js";

export * from "./types.js";
export { collectLayers, findRiskLevels } from "./layers.js";
export { resolve } from "./merge.js";
export type { ResolveInput, ResolveResult } from "./merge.js";
export { deriveRiskLevel } from "./risk-level.js";

export interface ResolveForProject {
  result: ResolveResult;
  /** Everything wrong with the layers themselves (unknown profile, `extends` cycle). */
  errors: CliError[];
}

export function resolveForProject(
  loaded: LoadResult,
  classification?: Classification
): ResolveForProject {
  const derived = deriveRiskLevel(classification, findRiskLevels(loaded));
  const collected = collectLayers(loaded, classification, derived.level);
  const result = resolve({
    layers: collected.layers,
    sources: collected.sources,
    riskLevel: derived.level,
    riskLevelFrom: derived.explain
  });
  return { result, errors: collected.errors };
}
