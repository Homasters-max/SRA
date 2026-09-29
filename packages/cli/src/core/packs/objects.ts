/**
 * Readers of the objects the enabled packs and `.warrant/local/` contribute
 * (A-24): the one place that selects `loaded.objects` by kind, below every
 * consumer by rank (ADR-0030).
 */
import { cliError, type CliError } from "../errors.js";
import { isPlainObject, strings } from "../json.js";
import type { LoadResult, ObjectKind, PackObject } from "./types.js";

/** Profile whose `match.paths` are the policy paths (D-15). */
export const FACTORY_PROFILE = "factory-change";

/** Objects of one kind, override in force, in load order. */
export function packObjects(loaded: Pick<LoadResult, "objects">, kind: ObjectKind): PackObject[] {
  return loaded.objects.filter((o) => o.kind === kind);
}

/**
 * The check document in force: a project-local override replaces the pack
 * object (08 §4), and the fields it leaves out are the pack's (`produces`,
 * `parser`, …), so an override that only supplies `run` still says what it
 * produces and how its output is read.
 */
export function effectiveCheck(object: PackObject): Record<string, unknown> {
  const own = isPlainObject(object.json) ? object.json : {};
  if (object.overridden === undefined || !isPlainObject(object.overridden.json)) return own;
  const merged: Record<string, unknown> = { ...object.overridden.json, ...own };
  delete merged["overrides"];
  return merged;
}

/**
 * `requires_evidence[].check` that does not name a loaded check producing the
 * element's `kind` (`produces` with the override in force): one
 * `CONFIG_INVALID` per element, `path` `<gate file>#/requires_evidence/<i>/check`
 * (ADR-0044 п. 6). Every loaded gate, or only `gates` when given — the gates
 * of a transition for `check` without ids, `verify` and `warrant ci` (I-204);
 * `warrant validate` reads them all (REQ-KRN-021 п. 3).
 */
export function gateCheckErrors(loaded: Pick<LoadResult, "objects">, gates?: readonly string[]): CliError[] {
  const produces = new Map<string, string[]>();
  for (const object of packObjects(loaded, "check")) produces.set(object.id, strings(effectiveCheck(object)["produces"]));
  const errors: CliError[] = [];
  for (const gate of packObjects(loaded, "gate")) {
    if (gates !== undefined && !gates.includes(gate.id)) continue;
    const required = isPlainObject(gate.json) ? gate.json["requires_evidence"] : undefined;
    if (!Array.isArray(required)) continue;
    required.forEach((entry, i) => {
      if (!isPlainObject(entry) || typeof entry["check"] !== "string") return;
      const check = entry["check"];
      const kind = String(entry["kind"]);
      const kinds = produces.get(check);
      if (kinds !== undefined && kinds.includes(kind)) return;
      errors.push(
        cliError(
          "CONFIG_INVALID",
          kinds === undefined
            ? `gate ${gate.id} requires ${kind} of check ${check}, which is not loaded`
            : `gate ${gate.id} requires ${kind} of check ${check}, whose produces does not contain ${kind}`,
          {
            path: `${gate.path}#/requires_evidence/${i}/check`,
            hint: `declare check ${check} producing ${kind} (.warrant/local/checks/) or name a check that produces it`
          }
        )
      );
    });
  }
  return errors;
}

/** Gate documents by id, override in force. */
export function gateDefinitions(loaded: Pick<LoadResult, "objects">): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const object of packObjects(loaded, "gate")) {
    if (isPlainObject(object.json)) out.set(object.id, object.json);
  }
  return out;
}

/** One entry of `provides.skills` of an enabled pack: `<namespace>/<name>@<range>`. */
export interface PackSkill {
  pack: string;
  name: string;
  /** The semver range; `*` when the entry has none. */
  range: string;
}

/** `provides.skills` of the enabled packs, in load order. */
export function packSkills(loaded: Pick<LoadResult, "packs">): PackSkill[] {
  const out: PackSkill[] = [];
  for (const pack of loaded.packs) {
    const provides = pack.manifest["provides"];
    for (const spec of isPlainObject(provides) ? strings(provides["skills"]) : []) {
      const at = spec.lastIndexOf("@");
      out.push({ pack: pack.id, name: at > 0 ? spec.slice(0, at) : spec, range: at > 0 ? spec.slice(at + 1) : "*" });
    }
  }
  return out;
}

/** `match.paths` of profile `factory-change`: the policy paths of D-15. */
export function policyPaths(loaded: Pick<LoadResult, "objects">): string[] {
  const profile = packObjects(loaded, "profile").find((o) => o.id === FACTORY_PROFILE);
  const match = isPlainObject(profile?.json) ? profile.json["match"] : undefined;
  return isPlainObject(match) ? strings(match["paths"]) : [];
}
