/** Shared shapes of the pack loader (design D-7, 08 sections 2-4). */
import type { WarrantConfig } from "../config.js";
import type { CliError } from "../errors.js";

/** Kinds of objects a pack contributes that carry an id and can be overridden. */
export const OBJECT_KINDS = [
  "profile",
  "overlay",
  "gate",
  "check",
  "controller-rules",
  "risk-floor",
  "risk-levels"
] as const;

export type ObjectKind = (typeof OBJECT_KINDS)[number];

/**
 * `provides.<key>` to the object kind and the schema name each file must carry.
 * `templates` and `recipes` are absent on purpose: templates are Markdown and
 * recipes have no kernel schema in phase 1, so only their existence is checked.
 */
export const PROVIDES_LISTS: Readonly<Record<string, ObjectKind>> = {
  profiles: "profile",
  overlays: "overlay",
  gates: "gate",
  checks: "check",
  controller_rules: "controller-rules",
  risk_floors: "risk-floor",
  risk_levels: "risk-levels"
};

/** `provides.<key>` holding a single path, validated but not part of the object set. */
export const PROVIDES_SINGLES: Readonly<Record<string, string>> = {
  openspec_schema: "openspec-schema",
  openspec_rules: "openspec-rules"
};

/** One object contributed by a pack or by the project layer. */
export interface PackObject {
  kind: ObjectKind;
  /** `id` of the document, or the file base name for documents that have none (risk floors and levels). */
  id: string;
  /** Pack id, or `local` for an object found under `.warrant/local/`. */
  pack: string;
  /** Path relative to the project root (local) or to the repo root (bundled pack). */
  path: string;
  json: unknown;
  /**
   * For a project-local override (`"overrides": "<pack>:<id>"`): the pack
   * object it replaced. `warrant check` takes the fields a check override
   * leaves out (`produces`, `parser`, …) from here.
   */
  overridden?: PackObject;
}

/** A pack manifest that was found, parsed and validated. */
export interface LoadedPack {
  id: string;
  version: string;
  /** Absolute directory holding `pack.json`. */
  dir: string;
  /** `bundled` or `.warrant/local` — the value written into the lock. */
  source: string;
  manifest: Record<string, unknown>;
  /** Path of `pack.json` as reported in errors. */
  manifestPath: string;
}

/** One `warrant://rule/1` document: listed in `provides.rules` or found under `.warrant/local/rules/` (ADR-0022). */
export interface LoadedRule {
  id: string;
  /** Pack id, or `local` for `.warrant/local/rules/`. */
  pack: string;
  /** Path as reported in errors. */
  path: string;
  paths: string[];
  enforcedBy: string | undefined;
}

/**
 * One entry of `provides.evidence_kinds` in normal form (D-13): the string form
 * `"review"` and the object form `{ kind, metrics_schema }` both become this.
 */
export interface EvidenceKind {
  kind: string;
  /** Pack that declares the kind. */
  pack: string;
  /** The `metrics` form, when the pack declares one; read but not yet compiled. */
  metricsSchema?: {
    /** Path as reported in errors. */
    path: string;
    json: unknown;
  };
}

export interface LoadResult {
  /** `.warrant/warrant.json` as a typed value. */
  config: WarrantConfig;
  /** Packs in dependency (topological) order. */
  packs: LoadedPack[];
  /** Object set after duplicate detection and local overrides. */
  objects: PackObject[];
  /** Path rules of every pack and of `.warrant/local/rules/`, sorted by id. */
  rules: LoadedRule[];
  /** Evidence kinds declared by the enabled packs, in load order. */
  evidenceKinds: EvidenceKind[];
  /** Every file the loader read and validated, as reported paths. */
  files: string[];
  /** Everything wrong that did not stop the load; `validate` reports them all at once. */
  errors: CliError[];
}
