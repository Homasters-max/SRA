/**
 * Allocation of stable ids (design D-5, ADR-0012, REQ-KRN-024).
 *
 * There is no registry file (ADR-0012 point 4): the next spec-level number is
 * derived by scanning the project every time, so two worktrees never fight
 * over a counter file. `EVID` / `RUN` sidestep coordination entirely with a
 * ULID; `WAV` keeps a per-year counter over `.warrant/waivers/`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { monotonicFactory } from "ulid";

import { WarrantError } from "../errors.js";
import { SPEC_LEVEL_PREFIXES, loadAreas, scanIds } from "./scan.js";

/** Prefixes carrying a ULID instead of a counter (ADR-0012 point 2). */
export const ULID_PREFIXES = ["EVID", "RUN"] as const;

export type SpecLevelPrefix = (typeof SPEC_LEVEL_PREFIXES)[number];

const AREA_RE = /^[A-Z]{2,5}$/;

/**
 * One monotonic factory per process, so two calls in the same process differ
 * and sort in call order even inside the same millisecond (SCN-KRN-058).
 */
const nextUlid = monotonicFactory();

export function isSpecLevelPrefix(value: string): value is SpecLevelPrefix {
  return (SPEC_LEVEL_PREFIXES as readonly string[]).includes(value);
}

export function isUlidPrefix(value: string): value is (typeof ULID_PREFIXES)[number] {
  return (ULID_PREFIXES as readonly string[]).includes(value);
}

/** Highest NNN already used for `prefix`+`area` anywhere in the project, or 0. */
export function highestNumber(projectRoot: string, prefix: string, area: string): number {
  let max = 0;
  for (const found of scanIds(projectRoot).ids) {
    if (found.prefix !== prefix || found.area !== area) continue;
    if (found.nnn > max) max = found.nnn;
  }
  return max;
}

/** `PREFIX-AREA-NNN` for the next free number (SCN-KRN-056). */
export function allocateSpecLevel(projectRoot: string, prefix: SpecLevelPrefix, area: string): string {
  if (!AREA_RE.test(area)) {
    throw new WarrantError("AREA_UNKNOWN", `AREA "${area}" is not of the form [A-Z]{2,5}`, {
      path: ".warrant/local/areas.json"
    });
  }
  if (!loadAreas(projectRoot).has(area)) {
    throw new WarrantError("AREA_UNKNOWN", `AREA "${area}" is not declared in .warrant/local/areas.json`, {
      path: ".warrant/local/areas.json"
    });
  }
  const next = highestNumber(projectRoot, prefix, area) + 1;
  if (next > 999) {
    throw new WarrantError(
      "ID_FORMAT",
      `${prefix}-${area}-999 is already used: PREFIX-AREA-NNN has no room past 999, split the AREA`
    );
  }
  return `${prefix}-${area}-${String(next).padStart(3, "0")}`;
}

/** `EVID-<ULID>` / `RUN-<ULID>`, Crockford base32, upper-case (ADR-0012 point 2). */
export function allocateUlid(prefix: string): string {
  return `${prefix}-${nextUlid()}`;
}

const WAIVER_ID_RE = /^WAV-(\d{4})-(\d{3})$/;

/** `WAV-<year>-NNN`, counted per calendar year over `.warrant/waivers/*.json`. */
export function allocateWaiver(projectRoot: string, year: number = new Date().getUTCFullYear()): string {
  const dir = path.join(projectRoot, ".warrant", "waivers");
  let max = 0;
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      if (!name.toLowerCase().endsWith(".json")) continue;
      let json: unknown;
      try {
        json = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
      } catch {
        continue;
      }
      if (typeof json !== "object" || json === null) continue;
      const id = (json as Record<string, unknown>)["id"];
      if (typeof id !== "string") continue;
      const m = WAIVER_ID_RE.exec(id);
      if (m === null || Number.parseInt(m[1] as string, 10) !== year) continue;
      const nnn = Number.parseInt(m[2] as string, 10);
      if (nnn > max) max = nnn;
    }
  }
  const next = max + 1;
  if (next > 999) {
    throw new WarrantError("ID_FORMAT", `WAV-${year}-999 is already used: no room left in year ${year}`);
  }
  return `WAV-${year}-${String(next).padStart(3, "0")}`;
}
