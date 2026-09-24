/**
 * Pack loader (design D-7, 08 sections 2-4).
 *
 * Reads `.warrant/warrant.json`, resolves every configured pack to a bundled
 * or project-local directory, checks the version ranges and `depends_on`,
 * orders the packs topologically, loads and validates every file they provide,
 * then folds in the implicit project layer `.warrant/local/`.
 *
 * Everything that can be reported is collected into `errors[]` instead of being
 * thrown: `warrant validate` reports all findings in one call (REQ-KRN-021).
 * Only a missing or unusable `warrant.json` throws, because nothing else can
 * proceed without it.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import semver from "semver";

import { WarrantError, type CliError } from "../errors.js";
import { readJson, reportPath, walkFiles } from "../fs.js";
import { isPlainObject, strings } from "../json.js";
import { validateFile } from "../schemas/semantic.js";
import { parseSchemaUri } from "../schemas/registry.js";
import { KERNEL_VERSION } from "../../version.js";
import { weakenings } from "./overrides.js";
import {
  PROVIDES_LISTS,
  PROVIDES_SINGLES,
  type EvidenceKind,
  type LoadResult,
  type LoadedPack,
  type LoadedRule,
  type ObjectKind,
  type PackObject
} from "./types.js";

export const WARRANT_DIR = ".warrant";
export const LOCAL_DIR = path.join(WARRANT_DIR, "local");
export const CONFIG_REL = path.join(WARRANT_DIR, "warrant.json");

/**
 * Directory holding the bundled packs.
 *
 * This module lives at `<repo>/packages/cli/{src,dist}/core/packs/loader.{ts,js}`,
 * so the repository (= installed package) root is five directories up and holds
 * `packs/`. Resolving from `import.meta.url` rather than from `cwd` is design
 * D-1: an installed CLI must find its packs wherever it is invoked.
 * `WARRANT_PACKS_DIR` overrides the location for tests.
 */
export function bundledPacksDir(): string {
  const override = process.env["WARRANT_PACKS_DIR"];
  if (override !== undefined && override !== "") return path.resolve(override);
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "..", "..", "..", "..", "packs");
}

function err(code: CliError["code"], message: string, p?: string): CliError {
  return p === undefined ? { code, message } : { code, message, path: p };
}

/** Validates one loaded document and records every violation. */
function validateInto(json: unknown, reported: string, errors: CliError[]): boolean {
  const result = validateFile(json, reported);
  if (result.ok) return true;
  errors.push(...result.errors);
  return false;
}

/** `major.minor` kernel line compared as a full semver version (`0.1` -> `0.1.0`). */
function kernelAsVersion(): string {
  return semver.valid(KERNEL_VERSION) ?? `${KERNEL_VERSION}.0`;
}

function satisfies(version: string, range: string): boolean {
  const coerced = semver.valid(version) ?? semver.coerce(version)?.version;
  if (coerced === null || coerced === undefined) return false;
  try {
    return semver.satisfies(coerced, range, { includePrerelease: true });
  } catch {
    return false;
  }
}

/** Reads `.warrant/warrant.json`, throwing when it is missing or unusable (SCN-KRN-007). */
export function loadConfig(projectRoot: string): Record<string, unknown> {
  const absolute = path.join(projectRoot, CONFIG_REL);
  if (!existsSync(absolute)) {
    throw new WarrantError("CONFIG_MISSING", `${CONFIG_REL} not found in ${projectRoot}`, {
      path: CONFIG_REL.split(path.sep).join("/")
    });
  }
  const reported = CONFIG_REL.split(path.sep).join("/");
  const errors: CliError[] = [];
  const json = readJson(absolute, reported, errors);
  if (json === undefined) {
    throw new WarrantError("CONFIG_INVALID", errors[0]?.message ?? "unreadable", { path: reported });
  }
  const result = validateFile(json, reported);
  if (!result.ok) {
    const first = result.errors[0] as CliError;
    throw new WarrantError("CONFIG_INVALID", first.message, { path: first.path ?? reported });
  }
  return json as Record<string, unknown>;
}

interface PackRequest {
  id: string;
  range: string;
}

function packRequests(config: Record<string, unknown>): PackRequest[] {
  const packs = config["packs"];
  if (!isPlainObject(packs)) return [];
  const out: PackRequest[] = [];
  for (const [id, value] of Object.entries(packs)) {
    if (id === "$comment") continue;
    const range = isPlainObject(value) && typeof value["version"] === "string" ? value["version"] : "*";
    out.push({ id, range });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Locates one pack: bundled first, then `.warrant/local/<id>/`. */
function findPackDir(id: string, projectRoot: string): { dir: string; source: string } | null {
  const bundled = path.join(bundledPacksDir(), id);
  if (existsSync(path.join(bundled, "pack.json"))) return { dir: bundled, source: "bundled" };
  const local = path.join(projectRoot, LOCAL_DIR, id);
  if (existsSync(path.join(local, "pack.json"))) return { dir: local, source: ".warrant/local" };
  return null;
}

/** Depth-first topological order over `depends_on`, restricted to the loaded packs. */
function topologicalOrder(packs: LoadedPack[], errors: CliError[]): LoadedPack[] {
  const byId = new Map(packs.map((p) => [p.id, p]));
  const ordered: LoadedPack[] = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (pack: LoadedPack, stack: string[]): void => {
    const mark = state.get(pack.id);
    if (mark === "done") return;
    if (mark === "visiting") {
      errors.push(
        err(
          "CONFIG_INVALID",
          `packs form a dependency cycle: ${[...stack, pack.id].join(" -> ")}`,
          pack.manifestPath
        )
      );
      return;
    }
    state.set(pack.id, "visiting");
    const depends = pack.manifest["depends_on"];
    if (isPlainObject(depends)) {
      for (const depId of Object.keys(depends).sort()) {
        if (depId === "$comment") continue;
        const dep = byId.get(depId);
        if (dep !== undefined) visit(dep, [...stack, pack.id]);
      }
    }
    state.set(pack.id, "done");
    ordered.push(pack);
  };

  for (const pack of packs) visit(pack, []);
  return ordered;
}

/** Id of an object: its `id` field, or the file base name for documents that carry none. */
function objectId(json: unknown, filePath: string): string {
  if (isPlainObject(json) && typeof json["id"] === "string") return json["id"];
  return path.basename(filePath).replace(/\.json$/i, "");
}

interface Collected {
  objects: Map<string, PackObject>;
  rules: Map<string, LoadedRule>;
  evidenceKinds: Map<string, EvidenceKind>;
  errors: CliError[];
}

/** Directory of project-local path rules (ADR-0022 point 1). */
export const LOCAL_RULES_DIR = path.join(LOCAL_DIR, "rules");

/**
 * Adds one validated `warrant://rule/1` document to the rule set. Rules cannot
 * be overridden (the schema has no `overrides`), so a second declaration of an
 * id — in another pack or in `.warrant/local/rules/` — is a duplicate.
 */
function addRule(json: unknown, pack: string, reported: string, collected: Collected): void {
  if (!isPlainObject(json) || typeof json["id"] !== "string") return;
  const id = json["id"];
  const existing = collected.rules.get(id);
  if (existing !== undefined) {
    collected.errors.push(
      err(
        "DUPLICATE_OBJECT_ID",
        `rule "${id}" is declared by ${existing.pack} (${existing.path}) and by ${pack} (${reported})`,
        reported
      )
    );
    return;
  }
  collected.rules.set(id, {
    id,
    pack,
    path: reported,
    paths: strings(json["paths"]),
    enforcedBy: typeof json["enforced_by"] === "string" ? json["enforced_by"] : undefined
  });
}

/**
 * `provides.evidence_kinds` in normal form (D-13): a string is a kind without a
 * `metrics` form, an object names the JSON Schema of the form. The schema file
 * is read here and compiled by `validate` (12); it is a JSON Schema document,
 * not a WARRANT one, so it is not matched against a kernel schema.
 */
function loadEvidenceKinds(pack: LoadedPack, projectRoot: string, collected: Collected, files: string[]): void {
  const provides = pack.manifest["provides"];
  if (!isPlainObject(provides) || !Array.isArray(provides["evidence_kinds"])) return;

  for (const entry of provides["evidence_kinds"]) {
    let normal: EvidenceKind;
    if (typeof entry === "string") {
      normal = { kind: entry, pack: pack.id };
    } else if (isPlainObject(entry) && typeof entry["kind"] === "string" && typeof entry["metrics_schema"] === "string") {
      const absolute = path.join(pack.dir, entry["metrics_schema"]);
      const reported = reportPath(absolute, projectRoot);
      files.push(reported);
      if (!existsSync(absolute)) {
        collected.errors.push(err("PACK_NOT_FOUND", `pack ${pack.id} provides a missing metrics schema`, reported));
        continue;
      }
      const json = readJson(absolute, reported, collected.errors);
      if (json === undefined) continue;
      normal = { kind: entry["kind"], pack: pack.id, metricsSchema: { path: reported, json } };
    } else {
      continue; // the pack schema has already reported the malformed entry
    }

    const existing = collected.evidenceKinds.get(normal.kind);
    if (existing !== undefined) {
      // Two declarations would leave the form of `metrics` ambiguous (D-13).
      collected.errors.push(
        err(
          "DUPLICATE_OBJECT_ID",
          `evidence kind "${normal.kind}" is declared by pack ${existing.pack} and by pack ${pack.id}`,
          pack.manifestPath
        )
      );
      continue;
    }
    collected.evidenceKinds.set(normal.kind, normal);
  }
}

function objectKey(kind: ObjectKind, id: string): string {
  return `${kind}:${id}`;
}

/** Loads every file listed in `provides`, validating each one. */
function loadProvides(pack: LoadedPack, projectRoot: string, collected: Collected, files: string[]): void {
  const provides = pack.manifest["provides"];
  if (!isPlainObject(provides)) return;

  for (const [key, kind] of Object.entries(PROVIDES_LISTS)) {
    for (const rel of strings(provides[key])) {
      const absolute = path.join(pack.dir, rel);
      const reported = reportPath(absolute, projectRoot);
      files.push(reported);
      if (!existsSync(absolute)) {
        collected.errors.push(err("PACK_NOT_FOUND", `pack ${pack.id} provides a missing file`, reported));
        continue;
      }
      const json = readJson(absolute, reported, collected.errors);
      if (json === undefined) continue;
      if (!validateInto(json, reported, collected.errors)) continue;

      const id = objectId(json, absolute);
      const existing = collected.objects.get(objectKey(kind, id));
      if (existing !== undefined) {
        collected.errors.push(
          err(
            "DUPLICATE_OBJECT_ID",
            `${kind} "${id}" is declared by pack ${existing.pack} (${existing.path}) and by pack ${pack.id} (${reported})`,
            reported
          )
        );
        continue;
      }
      collected.objects.set(objectKey(kind, id), { kind, id, pack: pack.id, path: reported, json });
    }
  }

  // Path rules (ADR-0022): validated like objects, but not overridable policy.
  for (const rel of strings(provides["rules"])) {
    const absolute = path.join(pack.dir, rel);
    const reported = reportPath(absolute, projectRoot);
    files.push(reported);
    if (!existsSync(absolute)) {
      collected.errors.push(err("PACK_NOT_FOUND", `pack ${pack.id} provides a missing file`, reported));
      continue;
    }
    const json = readJson(absolute, reported, collected.errors);
    if (json === undefined) continue;
    if (!validateInto(json, reported, collected.errors)) continue;
    const ref = parseSchemaUri(isPlainObject(json) ? json["$schema"] : undefined);
    if (ref === null || ref.name !== "rule") {
      collected.errors.push(err("SCHEMA_VIOLATION", "provides.rules must list warrant://rule/1 documents", reported));
      continue;
    }
    addRule(json, pack.id, reported, collected);
  }

  for (const [key, schemaName] of Object.entries(PROVIDES_SINGLES)) {
    const rel = provides[key];
    if (typeof rel !== "string") continue;
    const absolute = path.join(pack.dir, rel);
    const reported = reportPath(absolute, projectRoot);
    files.push(reported);
    if (!existsSync(absolute)) {
      collected.errors.push(err("PACK_NOT_FOUND", `pack ${pack.id} provides a missing file`, reported));
      continue;
    }
    const json = readJson(absolute, reported, collected.errors);
    if (json === undefined) continue;
    if (!validateInto(json, reported, collected.errors)) continue;
    const ref = parseSchemaUri(isPlainObject(json) ? json["$schema"] : undefined);
    if (ref !== null && ref.name !== schemaName) {
      collected.errors.push(
        err("SCHEMA_VIOLATION", `provides.${key} must carry schema warrant://${schemaName}/1`, reported)
      );
    }
  }

  // Templates and recipes have no kernel schema; only their presence is checked.
  for (const key of ["templates", "recipes"] as const) {
    for (const rel of strings(provides[key])) {
      const absolute = path.join(pack.dir, rel);
      const reported = reportPath(absolute, projectRoot);
      if (!existsSync(absolute)) {
        collected.errors.push(err("PACK_NOT_FOUND", `pack ${pack.id} provides a missing file`, reported));
      } else {
        files.push(reported);
      }
    }
  }
}

/** Object kinds keyed by the document schema name that produces them. */
const KIND_BY_SCHEMA: Readonly<Record<string, ObjectKind>> = {
  profile: "profile",
  overlay: "overlay",
  gate: "gate",
  check: "check"
};

/**
 * The implicit project layer: every `*.json` under `.warrant/local/**` that is
 * not part of a pack directory already loaded. Documents whose `$schema` names
 * a policy object join the object set with pack id `local`; anything else
 * (`areas.json`, `openspec/rules.json`) is only validated.
 */
function loadLocalLayer(
  projectRoot: string,
  packDirs: Set<string>,
  enabledPacks: ReadonlySet<string>,
  collected: Collected,
  files: string[]
): void {
  const localRoot = path.join(projectRoot, LOCAL_DIR);
  if (!existsSync(localRoot)) return;

  // B2: каталог с `pack.json` — это pack, а не слой проекта, и читается только
  // через `packs` в `warrant.json`. Неподключённый pack — ошибка конфигурации,
  // его файлы не попадают в project-слой ни при каких условиях (SCN-KRN-080).
  const packLike = new Set<string>(packDirs);
  let entries: string[] = [];
  try {
    entries = readdirSync(localRoot).sort();
  } catch {
    entries = [];
  }
  for (const name of entries) {
    const dir = path.join(localRoot, name);
    const manifest = path.join(dir, "pack.json");
    let isDirectory = false;
    try {
      isDirectory = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDirectory || !existsSync(manifest)) continue;
    packLike.add(dir);
    if (packDirs.has(dir) || enabledPacks.has(name)) continue;
    collected.errors.push(
      err(
        "CONFIG_INVALID",
        `${reportPath(dir, projectRoot)}/ holds a pack manifest, but pack "${name}" is not enabled in ${CONFIG_REL.split(path.sep).join("/")}; enable it or move the files out of ${LOCAL_DIR.split(path.sep).join("/")}/`,
        reportPath(manifest, projectRoot)
      )
    );
  }

  const inLoadedPack = (abs: string): boolean => {
    for (const dir of packLike) {
      if (abs === dir || abs.startsWith(dir + path.sep)) return true;
    }
    return false;
  };

  for (const absolute of walkFiles(localRoot, inLoadedPack)) {
    if (!absolute.toLowerCase().endsWith(".json")) continue;
    const reported = reportPath(absolute, projectRoot);
    files.push(reported);
    const json = readJson(absolute, reported, collected.errors);
    if (json === undefined) continue;
    if (!validateInto(json, reported, collected.errors)) continue;

    const ref = parseSchemaUri(isPlainObject(json) ? json["$schema"] : undefined);
    if (ref?.name === "rule" && absolute.startsWith(path.join(projectRoot, LOCAL_RULES_DIR) + path.sep)) {
      addRule(json, "local", reported, collected);
      continue;
    }
    if (ref?.name === "controller-rules") {
      // The project's controller rules extend the table after every pack's
      // (04 section 4, REQ-VER-005); they replace nothing, so they are keyed by
      // their path and never collide with a pack's `controller/rules.json`.
      collected.objects.set(objectKey("controller-rules", reported), {
        kind: "controller-rules",
        id: reported,
        pack: "local",
        path: reported,
        json
      });
      continue;
    }
    const kind = ref === null ? undefined : KIND_BY_SCHEMA[ref.name];
    if (kind === undefined) continue;

    const id = objectId(json, absolute);
    const overrides = isPlainObject(json) ? json["overrides"] : undefined;
    const key = objectKey(kind, id);
    const existing = collected.objects.get(key);

    if (typeof overrides !== "string") {
      if (existing !== undefined) {
        collected.errors.push(
          err(
            "DUPLICATE_OBJECT_ID",
            `${kind} "${id}" is declared by pack ${existing.pack} (${existing.path}) and again in ${reported}; a project-local replacement needs "overrides": "<pack>:<id>"`,
            reported
          )
        );
        continue;
      }
      collected.objects.set(key, { kind, id, pack: "local", path: reported, json });
      continue;
    }

    const [targetPack = "", targetId = ""] = overrides.split(":");
    const target = collected.objects.get(objectKey(kind, targetId));
    if (target === undefined || target.pack !== targetPack) {
      collected.errors.push(
        err(
          "OVERRIDE_INVALID",
          `overrides "${overrides}" does not name a ${kind} loaded from pack ${targetPack}`,
          reported
        )
      );
      continue;
    }

    const lost = weakenings(kind, target.json, json);
    if (lost.length > 0) {
      // Находки по `match` и `extends` указывают на своё поле — SCN-KRN-078,
      // SCN-KRN-079 требуют увидеть в `path`, что именно ослаблено.
      const groups = new Map<string, string[]>();
      for (const item of lost) {
        const field = item.startsWith("match.") ? "#/match" : item.startsWith("extends:") ? "#/extends" : "";
        const bucket = groups.get(field);
        if (bucket === undefined) groups.set(field, [item]);
        else bucket.push(item);
      }
      for (const [field, items] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        collected.errors.push(
          err(
            "OVERRIDE_WEAKENS",
            `override of ${kind} "${targetId}" drops: ${items.join("; ")}; an override may only strengthen (05 section 5)`,
            `${reported}${field}`
          )
        );
      }
      continue;
    }

    collected.objects.set(objectKey(kind, targetId), {
      kind,
      id: targetId,
      pack: "local",
      path: reported,
      json,
      overridden: target
    });
  }
}

/**
 * Loads the configuration, the packs it enables and the project layer.
 * Throws only for a missing or unusable `warrant.json`.
 */
export function loadPacks(projectRoot: string): LoadResult {
  const config = loadConfig(projectRoot);
  const errors: CliError[] = [];
  const files: string[] = [CONFIG_REL.split(path.sep).join("/")];
  const found: LoadedPack[] = [];

  for (const request of packRequests(config)) {
    const located = findPackDir(request.id, projectRoot);
    if (located === null) {
      errors.push(
        err(
          "PACK_NOT_FOUND",
          `pack "${request.id}" is not bundled with the CLI and is not present in ${LOCAL_DIR.split(path.sep).join("/")}/`,
          `${CONFIG_REL.split(path.sep).join("/")}#/packs/${request.id}`
        )
      );
      continue;
    }

    const manifestAbs = path.join(located.dir, "pack.json");
    const reported = reportPath(manifestAbs, projectRoot);
    files.push(reported);
    const manifest = readJson(manifestAbs, reported, errors);
    if (manifest === undefined) continue;
    if (!validateInto(manifest, reported, errors)) continue;
    const obj = manifest as Record<string, unknown>;

    const version = typeof obj["version"] === "string" ? obj["version"] : "0.0.0";
    if (!satisfies(version, request.range)) {
      errors.push(
        err(
          "CONFIG_INVALID",
          `pack ${request.id} version ${version} does not satisfy the configured range "${request.range}"`,
          reported
        )
      );
    }
    const kernelRange = typeof obj["kernel"] === "string" ? obj["kernel"] : "*";
    if (!satisfies(kernelAsVersion(), kernelRange)) {
      errors.push(
        err(
          "CONFIG_INVALID",
          `pack ${request.id} requires kernel "${kernelRange}", but this CLI is kernel ${KERNEL_VERSION}`,
          reported
        )
      );
    }

    found.push({
      id: typeof obj["id"] === "string" ? obj["id"] : request.id,
      version,
      dir: located.dir,
      source: located.source,
      manifest: obj,
      manifestPath: reported
    });
  }

  const byId = new Map(found.map((p) => [p.id, p]));
  for (const pack of found) {
    const depends = pack.manifest["depends_on"];
    if (!isPlainObject(depends)) continue;
    for (const [depId, range] of Object.entries(depends)) {
      if (depId === "$comment") continue;
      const dep = byId.get(depId);
      if (dep === undefined) {
        errors.push(
          err("PACK_NOT_FOUND", `pack ${pack.id} depends on "${depId}", which the project does not enable`, pack.manifestPath)
        );
        continue;
      }
      if (typeof range === "string" && !satisfies(dep.version, range)) {
        errors.push(
          err(
            "CONFIG_INVALID",
            `pack ${pack.id} requires ${depId} "${range}", but ${depId} is ${dep.version}`,
            pack.manifestPath
          )
        );
      }
    }
  }

  const packs = topologicalOrder(found, errors);
  const collected: Collected = { objects: new Map(), rules: new Map(), evidenceKinds: new Map(), errors };
  for (const pack of packs) {
    loadProvides(pack, projectRoot, collected, files);
    loadEvidenceKinds(pack, projectRoot, collected, files);
  }
  loadLocalLayer(
    projectRoot,
    new Set(packs.map((p) => p.dir)),
    new Set(packRequests(config).map((r) => r.id)),
    collected,
    files
  );

  return {
    config,
    packs,
    objects: [...collected.objects.values()].sort((a, b) =>
      a.kind === b.kind ? (a.id < b.id ? -1 : 1) : a.kind < b.kind ? -1 : 1
    ),
    rules: [...collected.rules.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    evidenceKinds: [...collected.evidenceKinds.values()],
    files: [...new Set(files)].sort(),
    errors
  };
}
