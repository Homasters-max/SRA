/**
 * The policy that does not load, as guard tells it (ADR-0053 п. 2, REQ-ENF-004):
 * the error of the recovery mode, its way out by the direction of the version
 * skew, the versions of the CLI and its packs and the pins of `warrant.json`;
 * and the CLI the project pins (`cli`, ADR-0053 п. 3).
 *
 * `warrant.json` is read here leniently, as raw JSON: the mode exists for a
 * project whose configuration does not load, so nothing here may throw.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { CONFIG_REL } from "../config.js";
import type { CliError } from "../errors.js";
import { isPlainObject } from "../json.js";
import { bundledPackVersions } from "../packs/loader.js";
import type { LoadResult } from "../packs/types.js";
import { readSchemaFile } from "../schemas/loader.js";
import { versionDirection } from "../version-range.js";
import { CLI_VERSION } from "../../version.js";
import { CONFIG_FILE, type RecoveryExit, type RecoveryFailure } from "./decide.js";

/** What a lenient read of `warrant.json` gives: nothing of it when it does not read. */
export interface Pins {
  /** `packs.<id>.version` by id, in file order. */
  packs: { id: string; range: string }[];
  kernel: string | undefined;
  /** `cli` when it is a string passing the pattern of `config/1`. */
  cli: string | undefined;
  /** The file read as a JSON object. */
  read: boolean;
}

/** The pattern of `cli` — its one owner is `config/1`. */
function cliPattern(): RegExp | undefined {
  const properties = readSchemaFile("config")["properties"];
  const cli = isPlainObject(properties) ? properties["cli"] : undefined;
  const pattern = isPlainObject(cli) ? cli["pattern"] : undefined;
  return typeof pattern === "string" ? new RegExp(pattern, "u") : undefined;
}

/** `warrant.json` of `root`, leniently: a file that is not a JSON object gives empty pins. */
export function readPins(root: string): Pins {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path.join(root, CONFIG_REL), "utf8"));
  } catch {
    return { packs: [], kernel: undefined, cli: undefined, read: false };
  }
  if (!isPlainObject(json)) return { packs: [], kernel: undefined, cli: undefined, read: false };
  const packs = isPlainObject(json["packs"])
    ? Object.entries(json["packs"]).flatMap(([id, value]) =>
        id !== "$comment" && isPlainObject(value) && typeof value["version"] === "string" ? [{ id, range: value["version"] }] : []
      )
    : [];
  const given = json["cli"];
  const cli = typeof given === "string" && cliPattern()?.test(given) === true ? given : undefined;
  return { packs, kernel: typeof json["kernel"] === "string" ? json["kernel"] : undefined, cli, read: true };
}

/** A reported path that names `warrant.json`, with a JSON Pointer fragment or without. */
function inConfig(reported: string | undefined): boolean {
  return reported === CONFIG_FILE || (reported !== undefined && reported.startsWith(`${CONFIG_FILE}#`));
}

/**
 * The way out of `error` (ADR-0053 п. 2): a bundled pack above its range —
 * the pin is raised; below it, or a pack the CLI does not carry — the CLI is
 * older than the pin; any other error of `warrant.json` (a pack of
 * `.warrant/local/` out of range, a version in a gap of the range) — the agent
 * fixes that file; anything else — a human.
 */
function exitOf(error: CliError, loaded: LoadResult | undefined, pins: Pins): RecoveryExit {
  if (error.code === "PACK_VERSION_RANGE") {
    const pack = loaded?.packs.find((p) => p.manifestPath === error.path);
    const range = pack === undefined ? undefined : pins.packs.find((p) => p.id === pack.id)?.range;
    if (pack !== undefined && pack.source === "bundled" && range !== undefined) {
      const direction = versionDirection(pack.version, range, { coerce: true });
      if (direction === "above") return "pin-up";
      if (direction === "below") return "cli-older";
    }
    return "fix-config";
  }
  if (error.code === "PACK_NOT_FOUND" && error.path?.startsWith(`${CONFIG_FILE}#/packs/`) === true) return "cli-older";
  return inConfig(error.path) ? "fix-config" : "human";
}

/**
 * Where `error` is, for a reason that may go into `guard_events[]` of a
 * committed Run: a path outside the project is never named — a bundled pack
 * is named by its id and CLI instead (R-55).
 */
function whereOf(error: CliError, loaded: LoadResult | undefined): string {
  if (error.path === undefined) return "";
  if (!path.isAbsolute(error.path)) return ` ${error.path}`;
  const pack = loaded?.packs.find((p) => p.manifestPath === error.path);
  return pack === undefined ? "" : ` pack ${pack.id}, bundled with CLI ${CLI_VERSION}`;
}

/**
 * The failure of the recovery mode over the load errors of `root`
 * (`loaded` absent when `warrant.json` itself did not load): the first
 * `PACK_VERSION_RANGE`, else the first error, picks both the reason and the
 * way out.
 */
export function policyFailure(root: string, loaded: LoadResult | undefined, errors: readonly CliError[]): RecoveryFailure {
  const error = errors.find((e) => e.code === "PACK_VERSION_RANGE") ?? (errors[0] as CliError);
  const pins = readPins(root);
  const carries = bundledPackVersions()
    .map((p) => `${p.id} ${p.version}`)
    .join(", ");
  const pinned = pins.read
    ? `warrant.json pins ${[...pins.packs.map((p) => `${p.id} ${p.range}`), ...(pins.kernel === undefined ? [] : [`kernel ${pins.kernel}`])].join(", ")}`
    : "warrant.json does not read";
  const reason = `the policy does not load (${error.code}${whereOf(error, loaded)}: ${error.message}): CLI ${CLI_VERSION} carries ${carries || "no pack"}; ${pinned}`;
  return { error, exit: exitOf(error, loaded, pins), carries, reason };
}
