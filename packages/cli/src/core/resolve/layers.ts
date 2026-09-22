/**
 * Layer collection for the resolver (design D-6, 05 sections 4-6).
 *
 * Pure with respect to the file system: it works on the `LoadResult` the pack
 * loader already produced, so the resolver itself stays a function of data.
 * The four groups are built in the order 05 section 5 applies them:
 * `default` (unconditional overlays) -> `project` (unconditional overlays of
 * `.warrant/local/`) -> `profiles` (with `extends` expanded depth first) ->
 * `risk` (overlays whose `match` agrees with the classification).
 */
import { canonicalHash } from "../canon/hash.js";
import type { CliError } from "../errors.js";
import type { LoadResult, PackObject } from "../packs/types.js";
import { CLI_VERSION } from "../../version.js";
import {
  RISK_DIMENSIONS,
  type Classification,
  type Layers,
  type PolicyBody,
  type PolicyLayer,
  type RiskDimension,
  type RiskLevel,
  type RiskLevelsDoc
} from "./types.js";

/** Pack id standing for the implicit project layer `.warrant/local/` (I-8). */
const LOCAL_PACK = "local";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function err(code: CliError["code"], message: string, path?: string): CliError {
  return path === undefined ? { code, message } : { code, message, path };
}

/**
 * `sources[]` entry of one object (05 section 6).
 *
 * A project-local object has no pack version, and the git sha of the example
 * would make the result depend on uncommitted edits, so design D-6 uses the
 * canonical hash of the document itself instead.
 */
function sourceOf(object: PackObject, packVersion: string | undefined): string {
  if (object.pack === LOCAL_PACK) return `project:.warrant/local@${canonicalHash(object.json)}`;
  const version = isPlainObject(object.json) && typeof object.json["version"] === "string"
    ? object.json["version"]
    : "0.0.0";
  return `${object.pack}@${packVersion ?? "0.0.0"}:${object.kind}/${object.id}@${version}`;
}

function labelOf(object: PackObject): string {
  return `${object.kind}/${object.id}`;
}

/** The policy fields of a profile or overlay document, ignoring everything else. */
function bodyOf(json: unknown): PolicyBody {
  if (!isPlainObject(json)) return {};
  const body: PolicyBody = {};
  if (isPlainObject(json["artifacts"])) body.artifacts = json["artifacts"] as NonNullable<PolicyBody["artifacts"]>;
  if (isPlainObject(json["gates"])) body.gates = json["gates"] as Record<string, string[]>;
  if (isPlainObject(json["capabilities"])) {
    body.capabilities = json["capabilities"] as NonNullable<PolicyBody["capabilities"]>;
  }
  if (Array.isArray(json["approvals"])) body.approvals = json["approvals"] as NonNullable<PolicyBody["approvals"]>;
  if (isPlainObject(json["evidence"])) body.evidence = json["evidence"] as NonNullable<PolicyBody["evidence"]>;
  return body;
}

function matchOf(json: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(json)) return undefined;
  const match = json["match"];
  return isPlainObject(match) ? match : undefined;
}

function isUnconditional(object: PackObject): boolean {
  const match = matchOf(object.json);
  return match === undefined || Object.keys(match).filter((k) => k !== "$comment").length === 0;
}

/** The single `risk-levels` document in play, if any (I-9: its id is the file base name). */
export function findRiskLevels(loaded: LoadResult): RiskLevelsDoc | undefined {
  const object = loaded.objects.find((o) => o.kind === "risk-levels");
  if (object === undefined || !isPlainObject(object.json)) return undefined;
  return { ...(object.json as object), id: object.id } as RiskLevelsDoc;
}

export interface CollectedLayers {
  layers: Layers;
  /** `sources[]` in application order, `kernel@<version>` first. */
  sources: string[];
  /** Profile ids actually applied, after `extends` expansion. */
  appliedProfiles: string[];
  errors: CliError[];
}

/**
 * Sort key giving a deterministic order inside a layer group: pack order as the
 * loader topologically sorted it, then the reported file path.
 */
function byPackThenPath(loaded: LoadResult): (a: PackObject, b: PackObject) => number {
  const rank = new Map<string, number>(loaded.packs.map((p, i) => [p.id, i]));
  // The project layer is applied after every pack, so `local` sorts last.
  const of = (o: PackObject): number => (o.pack === LOCAL_PACK ? Number.MAX_SAFE_INTEGER : rank.get(o.pack) ?? 0);
  return (a, b) => (of(a) !== of(b) ? of(a) - of(b) : a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/**
 * Depth-first expansion of `extends`: a profile's parents are applied before it,
 * every profile at most once. Cycles and unknown ids are reported, not thrown.
 */
function expandProfiles(
  ids: string[],
  byId: Map<string, PackObject>,
  errors: CliError[]
): PackObject[] {
  const out: PackObject[] = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (id: string, stack: string[], from: string | undefined): void => {
    const mark = state.get(id);
    if (mark === "done") return;
    if (mark === "visiting") {
      errors.push(
        err("CONFIG_INVALID", `profiles form an "extends" cycle: ${[...stack, id].join(" -> ")}`, from)
      );
      return;
    }
    const object = byId.get(id);
    if (object === undefined) {
      errors.push(
        err("CONFIG_INVALID", `classification names profile "${id}", which no enabled pack provides`, from)
      );
      state.set(id, "done");
      return;
    }
    state.set(id, "visiting");
    const parents = isPlainObject(object.json) && Array.isArray(object.json["extends"])
      ? (object.json["extends"] as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    for (const parent of parents) visit(parent, [...stack, id], object.path);
    state.set(id, "done");
    out.push(object);
  };

  // The declared order of `profiles` must not change the result, so it is
  // normalised before expansion; `extends` still orders parents before children.
  for (const id of [...new Set(ids)].sort()) visit(id, [], undefined);
  return out;
}

/** True when every key of `match` agrees with the classification (05 section 4). */
function matches(
  match: Record<string, unknown>,
  classification: Classification,
  riskLevel: RiskLevel,
  appliedProfiles: ReadonlySet<string>
): boolean {
  for (const [key, raw] of Object.entries(match)) {
    if (key === "$comment") continue;
    const allowed = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
    if (key === "risk_level") {
      if (!allowed.includes(riskLevel)) return false;
      continue;
    }
    if (key === "profiles") {
      if (!allowed.some((id) => appliedProfiles.has(id))) return false;
      continue;
    }
    if ((RISK_DIMENSIONS as readonly string[]).includes(key)) {
      const value = classification.risk?.[key as RiskDimension]?.value;
      // A dimension the classification does not carry cannot match (fail closed).
      if (value === undefined || !allowed.includes(value)) return false;
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Builds the four layer groups and `sources[]`.
 *
 * `riskLevel` is the level {@link deriveRiskLevel} already produced; when the
 * Change carries no classification at all the `risk` group stays empty, because
 * SCN-KRN-068 requires the policy to come from `default` and `project` only.
 */
export function collectLayers(
  loaded: LoadResult,
  classification: Classification | undefined,
  riskLevel: RiskLevel
): CollectedLayers {
  const errors: CliError[] = [];
  const packVersion = new Map(loaded.packs.map((p) => [p.id, p.version]));
  const order = byPackThenPath(loaded);

  const overlays = loaded.objects.filter((o) => o.kind === "overlay").sort(order);
  const profilesById = new Map(loaded.objects.filter((o) => o.kind === "profile").map((o) => [o.id, o]));

  const toLayer = (object: PackObject): PolicyLayer => ({
    source: sourceOf(object, packVersion.get(object.pack)),
    label: labelOf(object),
    body: bodyOf(object.json)
  });

  const unconditional = overlays.filter(isUnconditional);
  const layers: Layers = {
    default: unconditional.filter((o) => o.pack !== LOCAL_PACK).map(toLayer),
    project: unconditional.filter((o) => o.pack === LOCAL_PACK).map(toLayer),
    profiles: [],
    risk: []
  };

  const applied = classification === undefined
    ? []
    : expandProfiles(classification.profiles ?? [], profilesById, errors);
  layers.profiles = applied.map(toLayer);
  const appliedIds = new Set(applied.map((o) => o.id));

  if (classification !== undefined) {
    layers.risk = overlays
      .filter((o) => !isUnconditional(o))
      .filter((o) => matches(matchOf(o.json) as Record<string, unknown>, classification, riskLevel, appliedIds))
      .map(toLayer);
  }

  const sources = [`kernel@${CLI_VERSION}`];
  for (const group of [layers.default, layers.project, layers.profiles, layers.risk]) {
    for (const layer of group) if (!sources.includes(layer.source)) sources.push(layer.source);
  }

  return { layers, sources, appliedProfiles: [...appliedIds].sort(), errors };
}
