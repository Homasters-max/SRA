/**
 * `.warrant/warrant.json` as a typed value (design core-seams §2, A-15).
 *
 * `loadConfig` validates the file against `config/1` and builds a
 * `WarrantConfig`; every reader of the configuration goes through it rather
 * than through string keys of the raw JSON. A property of `config/1` that
 * nobody reads yet (`identities`, `trusted_signers`, `packs[id].params`) is
 * left out and is added by its first reader
 * (`test/unit/config/config.test.ts` holds the list).
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { WarrantError, type CliError } from "./errors.js";
import { readJson, walkFiles } from "./fs.js";
import { isPlainObject } from "./json.js";
import { validateFile } from "./schemas/semantic.js";

export const CONFIG_REL = path.join(".warrant", "warrant.json");

export interface PackEntry {
  readonly id: string;
  /** `packs[id].version`, `*` when absent. */
  readonly range: string;
}

export interface WarrantConfig {
  readonly kernel: string;
  /** Accepted OpenSpec range (`openspec`, required by `config/1`). */
  readonly openspec: string;
  /** Enabled packs sorted by id, without `$comment`. */
  readonly packs: readonly PackEntry[];
  readonly defaults: { readonly checkTimeoutS: number | undefined };
  readonly paths: { readonly adr?: string; readonly glossary?: string; readonly tests?: string; readonly src?: string };
  /** Role → logins, without `$comment`. */
  readonly roles: ReadonlyMap<string, readonly string[]>;
}

const PATH_KEYS = ["adr", "glossary", "tests", "src"] as const;

function packEntries(packs: unknown): PackEntry[] {
  if (!isPlainObject(packs)) return [];
  const out: PackEntry[] = [];
  for (const [id, value] of Object.entries(packs)) {
    if (id === "$comment") continue;
    const range = isPlainObject(value) && typeof value["version"] === "string" ? value["version"] : "*";
    out.push({ id, range });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

function roleEntries(roles: unknown): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  if (!isPlainObject(roles)) return out;
  for (const [role, logins] of Object.entries(roles)) {
    if (role === "$comment" || !Array.isArray(logins)) continue;
    out.set(
      role,
      logins.filter((login): login is string => typeof login === "string")
    );
  }
  return out;
}

function pathEntries(paths: unknown): WarrantConfig["paths"] {
  const out: { adr?: string; glossary?: string; tests?: string; src?: string } = {};
  if (!isPlainObject(paths)) return out;
  for (const key of PATH_KEYS) {
    const value = paths[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Builds the typed value of a document that has passed `config/1`. */
function toWarrantConfig(json: Record<string, unknown>): WarrantConfig {
  const defaults = isPlainObject(json["defaults"]) ? json["defaults"] : {};
  return {
    kernel: typeof json["kernel"] === "string" ? json["kernel"] : "",
    openspec: typeof json["openspec"] === "string" ? json["openspec"] : "*",
    packs: packEntries(json["packs"]),
    defaults: {
      checkTimeoutS: typeof defaults["check_timeout_s"] === "number" ? defaults["check_timeout_s"] : undefined
    },
    paths: pathEntries(json["paths"]),
    roles: roleEntries(json["roles"])
  };
}

/** Reads `.warrant/warrant.json`, throwing when it is missing or unusable (SCN-KRN-007). */
export function loadConfig(projectRoot: string): WarrantConfig {
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
  return toWarrantConfig(json as Record<string, unknown>);
}

/**
 * Files of the project test root `paths.tests` (a file or a directory, `/`
 * separated), or none when it is unset or absent on disk.
 */
export function testFiles(root: string, config: WarrantConfig): string[] {
  const tests = config.paths.tests;
  if (tests === undefined || tests.length === 0) return [];
  const absolute = path.join(root, ...tests.split("/"));
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    return [];
  }
  if (stat.isFile()) return [absolute];
  return stat.isDirectory() ? walkFiles(absolute) : [];
}
