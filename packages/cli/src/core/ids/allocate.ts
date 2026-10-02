/**
 * Allocation of stable ids (design D-5, ADR-0012, REQ-KRN-024).
 *
 * There is no registry file (ADR-0012 point 4): the next spec-level number is
 * derived by scanning the project every time, so two worktrees never fight
 * over a counter file. `EVID` / `RUN` sidestep coordination entirely with a
 * ULID; so does `WAV` (ADR-0056 п. 2), whose former `WAV-<year>-NNN` stays valid.
 */
import { monotonicFactory } from "ulid";

import { WarrantError } from "../errors.js";
import { SPEC_LEVEL_PREFIXES, ULID_PREFIXES, areaHint, loadAreas, scanIds } from "./scan.js";

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
  const areas = loadAreas(projectRoot);
  if (!AREA_RE.test(area)) {
    throw new WarrantError("AREA_UNKNOWN", `AREA "${area}" is not of the form [A-Z]{2,5}`, {
      path: ".warrant/local/areas.json",
      hint: areaHint(areas)
    });
  }
  if (!areas.has(area)) {
    throw new WarrantError("AREA_UNKNOWN", `AREA "${area}" is not declared in .warrant/local/areas.json`, {
      path: ".warrant/local/areas.json",
      hint: areaHint(areas)
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

/**
 * A waiver id of either form (REQ-KRN-019, ADR-0056 п. 2): `WAV-<ULID>`, or
 * the former `WAV-<year>-NNN`, which stays valid. One owner of the form: the
 * schema `waiver/1` carries the same pattern (a meta test holds them equal).
 */
export const WAIVER_ID_PATTERN = "^WAV-([0-9]{4}-[0-9]{3}|[0-9A-HJKMNP-TV-Z]{26})$";
export const WAIVER_ID_RE = new RegExp(WAIVER_ID_PATTERN);

/**
 * A new waiver id `WAV-<ULID>` (REQ-KRN-031, ADR-0056 п. 2): not derived
 * from `.warrant/waivers/`, so two branches from one base do not collide.
 */
export function allocateWaiver(): string {
  return allocateUlid("WAV");
}
