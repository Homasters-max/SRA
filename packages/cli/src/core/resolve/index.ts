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
    riskLevelFrom: derived.explain,
    gateKinds: gateKinds(loaded)
  });
  return { result, errors: collected.errors };
}

/** Kinds of `requires_evidence` of every loaded gate document, by gate id (override in force). */
function gateKinds(loaded: LoadResult): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const object of loaded.objects) {
    if (object.kind !== "gate") continue;
    const json = object.json as Record<string, unknown> | null;
    const list = typeof json === "object" && json !== null ? json["requires_evidence"] : undefined;
    const kinds = Array.isArray(list)
      ? list
          .map((r) => (typeof r === "object" && r !== null ? (r as Record<string, unknown>)["kind"] : undefined))
          .filter((k): k is string => typeof k === "string")
      : [];
    out.set(object.id, kinds);
  }
  return out;
}
