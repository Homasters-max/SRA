/**
 * `.warrant/warrant.json` as a typed value (design core-seams §2, A-15).
 *
 * `loadConfig` validates the file against `config/1` and builds a
 * `WarrantConfig`; every reader of the configuration goes through it rather
 * than through string keys of the raw JSON. A property of `config/1` that
 * nobody reads yet (`trusted_signers`, `packs[id].params`) is left out and
 * is added by its first reader (`test/unit/config/config.test.ts` holds the
 * list). Of `identities` only `agents[].login` is read (ADR-0044 п. 3).
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { cliError, WarrantError, type CliError } from "./errors.js";
import { readJson, walkFiles } from "./fs.js";
import { isPlainObject, strings } from "./json.js";
import { readSchemaFile } from "./schemas/loader.js";
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
  /** Frontends `warrant sync` generates files for (ADR-0034 п. 1); empty when absent. */
  readonly frontends: readonly string[];
  /** Logins of `identities.agents[].login` (ADR-0010 п. 4, ADR-0044 п. 3), in file order; empty when absent. */
  readonly agents: readonly string[];
  /** Entry file of the CLI the project pins (ADR-0053 п. 3), relative to the root; `undefined` when absent. */
  readonly cli: string | undefined;
}

const PATH_KEYS = ["adr", "glossary", "tests", "src"] as const;

/**
 * The pattern of `cli` of `config/1` (ADR-0053 п. 3): its one owner is the
 * schema; guard and the generator of `sync` test a value against it.
 */
export function cliPattern(): RegExp {
  const properties = readSchemaFile("config")["properties"];
  const cli = isPlainObject(properties) ? properties["cli"] : undefined;
  const pattern = isPlainObject(cli) ? cli["pattern"] : undefined;
  return new RegExp(typeof pattern === "string" ? pattern : "(?!)", "u");
}

/**
 * Names `frontends[]` of `config/1` accepts. The schema is their one owner, so
 * no frontend name is spelled in the kernel (design §9).
 */
export function knownFrontends(): string[] {
  const properties = readSchemaFile("config")["properties"];
  const frontends = isPlainObject(properties) ? properties["frontends"] : undefined;
  const items = isPlainObject(frontends) ? frontends["items"] : undefined;
  return strings(isPlainObject(items) ? items["enum"] : undefined);
}

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

function agentLogins(identities: unknown): string[] {
  const agents = isPlainObject(identities) ? identities["agents"] : undefined;
  if (!Array.isArray(agents)) return [];
  return agents.flatMap((agent) => (isPlainObject(agent) && typeof agent["login"] === "string" ? [agent["login"]] : []));
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
    roles: roleEntries(json["roles"]),
    frontends: strings(json["frontends"]),
    agents: agentLogins(json["identities"]),
    cli: typeof json["cli"] === "string" ? json["cli"] : undefined
  };
}

/**
 * Check (14) of `validate` (REQ-KRN-021, ADR-0044 п. 3): no login of
 * `identities.agents` is in a role of `roles` — roles hold no agents
 * (ADR-0010 п. 4). `loadConfig` does not check it, so the other commands
 * keep working; `validate` and the job `warrant` show it.
 */
export function agentRoleErrors(config: WarrantConfig): CliError[] {
  const reported = CONFIG_REL.split(path.sep).join("/");
  const errors: CliError[] = [];
  for (const [i, login] of config.agents.entries()) {
    const roles = [...config.roles].filter(([, logins]) => logins.includes(login)).map(([role]) => role);
    if (roles.length === 0) continue;
    errors.push(
      cliError("CONFIG_INVALID", `agent identity ${login} is also in roles ${roles.join(", ")}: roles hold no agents (ADR-0010 п. 4)`, {
        path: `${reported}#/identities/agents/${i}/login`,
        hint: `remove ${login} from roles, or from identities.agents if it is a person`
      })
    );
  }
  return errors;
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
