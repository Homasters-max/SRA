/**
 * Readers of the objects the enabled packs and `.warrant/local/` contribute
 * (A-24): the one place that selects `loaded.objects` by kind, below every
 * consumer by rank (ADR-0030).
 */
import { isPlainObject, strings } from "../json.js";
import type { LoadResult, ObjectKind, PackObject } from "./types.js";

/** Profile whose `match.paths` are the policy paths (D-15). */
export const FACTORY_PROFILE = "factory-change";

/** Objects of one kind, override in force, in load order. */
export function packObjects(loaded: Pick<LoadResult, "objects">, kind: ObjectKind): PackObject[] {
  return loaded.objects.filter((o) => o.kind === kind);
}

/** Gate documents by id, override in force. */
export function gateDefinitions(loaded: Pick<LoadResult, "objects">): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const object of packObjects(loaded, "gate")) {
    if (isPlainObject(object.json)) out.set(object.id, object.json);
  }
  return out;
}

/** `match.paths` of profile `factory-change`: the policy paths of D-15. */
export function policyPaths(loaded: Pick<LoadResult, "objects">): string[] {
  const profile = packObjects(loaded, "profile").find((o) => o.id === FACTORY_PROFILE);
  const match = isPlainObject(profile?.json) ? profile.json["match"] : undefined;
  return isPlainObject(match) ? strings(match["paths"]) : [];
}
