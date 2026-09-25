/**
 * The planner behind `warrant sync` and check (4) of `warrant validate`
 * (REQ-KRN-025, REQ-KRN-021, design D-7, ADR-0015).
 *
 * Planning is pure with respect to the project: it reads the packs and the
 * current files and returns the bytes every generated file SHOULD have.
 * `sync` writes them, `sync --check` and `validate` only compare. Having one
 * planner is what makes the two commands unable to disagree (SCN-KRN-045).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import semver from "semver";

import { bytesHash } from "../canon/hash.js";
import { canonicalText } from "../canon/format-json.js";
import { cliError, type CliError } from "../errors.js";
import { reportPath } from "../fs.js";
import { isPlainObject } from "../json.js";
import { emitYaml, type YamlObject, type YamlValue } from "../openspec/yaml-emit.js";
import { bundleRoot, packContentHash, LOCK_REL } from "../packs/hash.js";
import type { LoadResult, LoadedPack } from "../packs/types.js";
import { ALL_SCHEMAS, KERNEL_MAJOR, schemaFileName } from "../schemas/registry.js";
import { SCHEMAS_DIR } from "../schemas/loader.js";
import { CLI_VERSION } from "../../version.js";
import { mergeRules, type OpenspecRules } from "./rules.js";

/** Project-local rules layer, merged after every pack (ADR-0015 point 2). */
export const LOCAL_RULES_REL = ".warrant/local/openspec/rules.json";

/** One file `sync` is responsible for. */
export interface PlannedFile {
  /** Path relative to the project root, POSIX separators. */
  path: string;
  /** Exact bytes the file must contain. */
  bytes: Buffer;
  /**
   * Set for files that are JSON documents WARRANT owns: they are written
   * through `writeJsonFile` so the canonical form is produced by the one
   * function that defines it.
   */
  json?: unknown;
  /** True when the current file on disk differs from `bytes` or is absent. */
  changed: boolean;
}

export interface SyncPlan {
  /** Name of the OpenSpec schema the project generates, e.g. `warrant-sdd`. */
  schema: string;
  /** Artifact ids declared by that schema. */
  artifacts: string[];
  files: PlannedFile[];
  /** Everything that could not be planned; when non-empty nothing may be written. */
  errors: CliError[];
  /**
   * Files under `openspec/schemas/<schema>/templates/` that no pack provides
   * any more. `sync` never deletes; they are only reported.
   */
  stale: string[];
  /** Merged rules, for the `rules` keys check of `validate`. */
  rules: OpenspecRules;
  /** Source file of each merged `rules.<artifact>` key, for error paths. */
  ruleSources: Record<string, string>;
}

export interface PlanInput {
  root: string;
  loaded: LoadResult;
  /**
   * Exact `openspec --version`. When null the lock is left out of the plan:
   * its `openspec` field cannot be known, and check (4) of `validate` does not
   * own the lock anyway (check (2) does).
   */
  openspecVersion: string | null;
}

/**
 * Reads a JSON file, returning undefined and recording the failure as one
 * `cannot read <path>: …` for both an unreadable and a malformed file. It
 * differs from `readJson` of `core/fs.ts` (`cannot read file: …` /
 * `invalid JSON: …`) on purpose: the `sync` messages stay unchanged (I-144).
 */
function readJsonCombinedError(absolute: string, reported: string, errors: CliError[]): unknown {
  try {
    return JSON.parse(readFileSync(absolute, "utf8"));
  } catch (cause) {
    errors.push(cliError("CONFIG_INVALID", `cannot read ${reported}: ${(cause as Error).message}`, { path: reported }));
    return undefined;
  }
}

/** `provides.<key>` of a pack as a string, or undefined. */
function provided(pack: LoadedPack, key: string): string | undefined {
  const provides = pack.manifest["provides"];
  if (!isPlainObject(provides)) return undefined;
  const value = provides[key];
  return typeof value === "string" ? value : undefined;
}

function providedList(pack: LoadedPack, key: string): string[] {
  const provides = pack.manifest["provides"];
  if (!isPlainObject(provides)) return [];
  const value = provides[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** `openspec/config.yaml` as a mapping in the fixed key order of ADR-0015 point 1. */
export function configDocument(schemaName: string, rules: OpenspecRules): YamlObject {
  const doc: YamlObject = { schema: schemaName };
  if (rules.context !== undefined && rules.context !== "") doc.context = rules.context;
  if (rules.rules !== undefined && Object.keys(rules.rules).length > 0) {
    doc.rules = rules.rules as unknown as YamlObject;
  }
  if (rules.operations !== undefined && Object.keys(rules.operations).length > 0) {
    const operations: YamlObject = {};
    for (const [op, body] of Object.entries(rules.operations)) {
      const guidance = body?.guidance ?? [];
      if (guidance.length > 0) operations[op] = { guidance } as unknown as YamlObject;
    }
    if (Object.keys(operations).length > 0) doc.operations = operations;
  }
  return doc;
}

/**
 * `openspec/schemas/<name>/schema.yaml` from the pack's `openspec/schema.json`.
 * `$schema` and `$comment` are WARRANT bookkeeping and are not emitted.
 */
export function schemaDocument(source: Record<string, unknown>): YamlObject {
  const doc: YamlObject = {
    name: optionalString(source["name"]) ?? "",
    version: typeof source["version"] === "number" ? source["version"] : 1,
    description: optionalString(source["description"]) ?? ""
  };

  const artifacts: YamlValue[] = [];
  for (const raw of Array.isArray(source["artifacts"]) ? source["artifacts"] : []) {
    if (!isPlainObject(raw)) continue;
    const artifact: YamlObject = {
      id: optionalString(raw["id"]) ?? "",
      generates: optionalString(raw["generates"]) ?? "",
      description: optionalString(raw["description"]) ?? "",
      template: optionalString(raw["template"]) ?? ""
    };
    const instruction = optionalString(raw["instruction"]);
    if (instruction !== undefined) artifact.instruction = instruction;
    artifact.requires = stringArray(raw["requires"]);
    artifacts.push(artifact);
  }
  doc.artifacts = artifacts;

  const apply = isPlainObject(source["apply"]) ? source["apply"] : undefined;
  if (apply !== undefined) {
    const applyDoc: YamlObject = { requires: stringArray(apply["requires"]) };
    applyDoc.tracks = optionalString(apply["tracks"]) ?? "";
    const instruction = optionalString(apply["instruction"]);
    if (instruction !== undefined) applyDoc.instruction = instruction;
    doc.apply = applyDoc;
  }

  return doc;
}

function currentBytes(absolute: string): Buffer | undefined {
  if (!existsSync(absolute)) return undefined;
  try {
    return readFileSync(absolute);
  } catch {
    return undefined;
  }
}

/** One skill a pack declares, resolved to a file on disk. */
interface ResolvedSkill {
  /** `<namespace>/<name>`, the key used in the lock. */
  name: string;
  /** Exact version taken from the SKILL.md frontmatter. */
  version: string;
  /** Absolute path of SKILL.md. */
  absolute: string;
  /** Path relative to the project root, POSIX — set only when the file is inside the project. */
  rel: string | undefined;
  /**
   * For a skill outside the project that ships with the CLI: path relative to
   * the bundle root (the directory holding the bundled `packs/`), POSIX (I-52).
   */
  bundled: string | undefined;
}

/**
 * `version` of a SKILL.md frontmatter.
 *
 * The frontmatter is a small, flat YAML block (`name`, `version`,
 * `description`), so a line scan is enough and the CLI keeps no YAML parser in
 * its runtime dependencies.
 */
export function skillFrontmatterVersion(text: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match === null) return undefined;
  for (const line of (match[1] as string).split(/\r?\n/)) {
    const field = /^version:\s*(.+?)\s*$/.exec(line);
    if (field !== null) return (field[1] as string).replace(/^["']|["']$/g, "");
  }
  return undefined;
}

/**
 * Locates the SKILL.md of one `provides.skills` entry (`<ns>/<name>@<range>`).
 *
 * Search order, first hit wins: the pack's own `skills/` directory, the
 * project's `sra/skills/`, and — for a pack developed in the WARRANT monorepo —
 * the `sra/skills/` next to `packs/`. A file inside the project root is locked
 * by its project-relative path; a file that ships with the CLI outside the
 * project is locked with `source: "bundled"` and a path relative to the bundle
 * root (I-52, P-11). Anything else — possible only with a pack directory that
 * is neither in the project nor in the bundle — is resolved and
 * version-checked but cannot be addressed by the lock.
 */
function resolveSkill(pack: LoadedPack, root: string, spec: string, errors: CliError[]): ResolvedSkill | undefined {
  const at = spec.lastIndexOf("@");
  const name = at > 0 ? spec.slice(0, at) : spec;
  const range = at > 0 ? spec.slice(at + 1) : "*";
  const segments = name.split("/");

  const candidates = [
    path.join(pack.dir, "skills", ...segments, "SKILL.md"),
    path.join(root, "sra", "skills", ...segments, "SKILL.md"),
    path.join(pack.dir, "..", "..", "sra", "skills", ...segments, "SKILL.md")
  ];
  const absolute = candidates.find((candidate) => existsSync(candidate));
  if (absolute === undefined) {
    errors.push(
      cliError(
        "PACK_NOT_FOUND",
        `pack ${pack.id} provides skill "${spec}", but no SKILL.md was found for it`,
        { path: `sra/skills/${name}/SKILL.md` }
      )
    );
    return undefined;
  }

  const reported = reportPath(absolute, root);
  const version = skillFrontmatterVersion(readFileSync(absolute, "utf8"));
  if (version === undefined) {
    errors.push(
      cliError("CONFIG_INVALID", `skill "${name}" has no \`version\` in its frontmatter`, { path: reported })
    );
    return undefined;
  }
  if (!semver.satisfies(version, range, { includePrerelease: true })) {
    errors.push(
      cliError(
        "CONFIG_INVALID",
        `pack ${pack.id} requires skill "${name}" ${range}, but the file on disk is ${version}`,
        { path: reported }
      )
    );
    return undefined;
  }

  return { name, version, absolute, rel: inside(root, absolute), bundled: inside(bundleRoot(), absolute) };
}

/** POSIX path of `absolute` relative to `dir`, or undefined when it lies outside. */
function inside(dir: string, absolute: string): string | undefined {
  const relative = path.relative(dir, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join("/");
}

/** `lock.skills` for every skill the enabled packs declare, in the project or in the bundle. */
function planSkills(root: string, packs: LoadedPack[], errors: CliError[]): Record<string, unknown> {
  const skills: Record<string, unknown> = {};
  for (const pack of packs) {
    for (const spec of providedList(pack, "skills")) {
      const resolved = resolveSkill(pack, root, spec, errors);
      if (resolved === undefined) continue;
      const hash = bytesHash(readFileSync(resolved.absolute));
      if (resolved.rel !== undefined) {
        skills[resolved.name] = { version: resolved.version, path: resolved.rel, hash };
      } else if (resolved.bundled !== undefined) {
        skills[resolved.name] = { version: resolved.version, path: resolved.bundled, hash, source: "bundled" };
      }
    }
  }
  return skills;
}

/** Builds the full plan. Never writes and never throws for project data. */
export function planSync(input: PlanInput): SyncPlan {
  const { root, loaded, openspecVersion } = input;
  const errors: CliError[] = [];
  const files: PlannedFile[] = [];
  const stale: string[] = [];

  const add = (rel: string, bytes: Buffer, json?: unknown): void => {
    const current = currentBytes(path.join(root, rel));
    const changed = current === undefined || !current.equals(bytes);
    files.push(json === undefined ? { path: rel, bytes, changed } : { path: rel, bytes, json, changed });
  };

  // (1) The pack that owns the OpenSpec workflow schema. Phase 1 allows exactly one.
  const providers = loaded.packs.filter((p) => provided(p, "openspec_schema") !== undefined);
  if (providers.length === 0) {
    errors.push(
      cliError(
        "CONFIG_INVALID",
        "no enabled pack provides `openspec_schema`; `warrant sync` has nothing to generate",
        { path: ".warrant/warrant.json#/packs" }
      )
    );
    return { schema: "", artifacts: [], files, errors, stale, rules: {}, ruleSources: {} };
  }
  if (providers.length > 1) {
    errors.push(
      cliError(
        "CONFIG_INVALID",
        `packs ${providers.map((p) => p.id).join(", ")} all provide \`openspec_schema\`; phase 1 supports exactly one`,
        { path: ".warrant/warrant.json#/packs" }
      )
    );
    return { schema: "", artifacts: [], files, errors, stale, rules: {}, ruleSources: {} };
  }

  const owner = providers[0] as LoadedPack;
  const schemaAbs = path.join(owner.dir, provided(owner, "openspec_schema") as string);
  const schemaRel = reportPath(schemaAbs, root);
  const schemaJson = readJsonCombinedError(schemaAbs, schemaRel, errors);
  if (!isPlainObject(schemaJson)) {
    if (errors.length === 0) {
      errors.push(cliError("CONFIG_INVALID", "openspec schema source is not an object", { path: schemaRel }));
    }
    return { schema: "", artifacts: [], files, errors, stale, rules: {}, ruleSources: {} };
  }
  const schemaName = optionalString(schemaJson["name"]) ?? "";
  const artifactIds = (Array.isArray(schemaJson["artifacts"]) ? schemaJson["artifacts"] : [])
    .filter(isPlainObject)
    .map((a) => optionalString(a["id"]) ?? "")
    .filter((id) => id !== "");

  // (2) Rules: every pack that provides them, in load order, then the project.
  const layers: OpenspecRules[] = [];
  const layerPaths: string[] = [];
  for (const pack of loaded.packs) {
    const rel = provided(pack, "openspec_rules");
    if (rel === undefined) continue;
    const absolute = path.join(pack.dir, rel);
    const reported = reportPath(absolute, root);
    const json = readJsonCombinedError(absolute, reported, errors);
    if (!isPlainObject(json)) continue;
    layers.push(json as OpenspecRules);
    layerPaths.push(reported);
  }
  const localRules = path.join(root, LOCAL_RULES_REL);
  if (existsSync(localRules)) {
    const json = readJsonCombinedError(localRules, LOCAL_RULES_REL, errors);
    if (isPlainObject(json)) {
      layers.push(json as OpenspecRules);
      layerPaths.push(LOCAL_RULES_REL);
    }
  }
  const rules = mergeRules(layers);

  const ruleSources: Record<string, string> = {};
  layers.forEach((layer, index) => {
    for (const key of Object.keys(layer.rules ?? {})) {
      if (key === "$comment") continue;
      if (ruleSources[key] === undefined) ruleSources[key] = layerPaths[index] as string;
    }
  });

  // (3) Generated files, in the order the lock lists them.
  add("openspec/config.yaml", Buffer.from(emitYaml(configDocument(schemaName, rules), { marker: true }), "utf8"));

  const schemaDir = `openspec/schemas/${schemaName}`;
  add(`${schemaDir}/schema.yaml`, Buffer.from(emitYaml(schemaDocument(schemaJson), { marker: true }), "utf8"));

  const templateTargets = new Set<string>();
  for (const rel of providedList(owner, "templates")) {
    const absolute = path.join(owner.dir, rel);
    const target = `${schemaDir}/templates/${path.basename(rel)}`;
    if (templateTargets.has(target)) {
      errors.push(
        cliError(
          "CONFIG_INVALID",
          `pack ${owner.id} provides two templates named ${path.basename(rel)}`,
          { path: reportPath(absolute, root) }
        )
      );
      continue;
    }
    templateTargets.add(target);
    const bytes = currentBytes(absolute);
    if (bytes === undefined) {
      errors.push(
        cliError("PACK_NOT_FOUND", `pack ${owner.id} provides a missing template`, { path: reportPath(absolute, root) })
      );
      continue;
    }
    add(target, bytes);
  }

  // Templates a previous sync left behind: reported, never deleted.
  const templatesAbs = path.join(root, schemaDir, "templates");
  if (existsSync(templatesAbs)) {
    for (const name of readdirSafe(templatesAbs)) {
      const rel = `${schemaDir}/templates/${name}`;
      if (!templateTargets.has(rel)) stale.push(rel);
    }
  }

  // Copies of the kernel JSON Schemas, for editors (decision I-4).
  for (const name of ALL_SCHEMAS) {
    const file = schemaFileName(name, KERNEL_MAJOR);
    const bytes = currentBytes(path.join(SCHEMAS_DIR, file));
    if (bytes === undefined) {
      errors.push(
        cliError(
          "INTERNAL",
          `kernel schema ${file} is missing from the installed CLI`,
          { path: `.warrant/schemas/${file}` }
        )
      );
      continue;
    }
    add(`.warrant/schemas/${file}`, bytes);
  }

  // (4) The lock, hashing everything planned above but not itself.
  if (openspecVersion !== null) {
    const packs: Record<string, unknown> = {};
    for (const pack of [...loaded.packs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      packs[pack.id] = { version: pack.version, source: pack.source, hash: packContentHash(pack.dir) };
    }
    const generated: Record<string, string> = {};
    for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
      generated[file.path] = bytesHash(file.bytes);
    }
    // `skills` stays out of the lock when no enabled pack declares one: the
    // schema makes the key optional.
    const skills = planSkills(root, loaded.packs, errors);
    const lock = {
      $schema: "warrant://lock/1",
      kernel: CLI_VERSION,
      openspec: openspecVersion,
      packs,
      ...(Object.keys(skills).length > 0 ? { skills } : {}),
      generated
    };
    add(LOCK_REL, Buffer.from(canonicalText(lock).text, "utf8"), lock);
  }

  return { schema: schemaName, artifacts: artifactIds, files, errors, stale, rules, ruleSources };
}

/** File names directly inside `dir`, sorted; empty when the directory is unreadable. */
function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
