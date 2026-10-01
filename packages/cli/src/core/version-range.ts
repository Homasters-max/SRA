/**
 * Whether a version satisfies a range (A-19): the one owner of `semver` in the
 * CLI (ADR-0035, registry `packages`). Prereleases count (`includePrerelease`);
 * a range or version that does not parse is not satisfied.
 */
import semver from "semver";

export interface VersionSatisfiesOptions {
  /** Take a version that is not full semver by its leading numbers: `0.6` → `0.6.0`, `v1.2` → `1.2.0`. */
  coerce?: boolean;
}

export function versionSatisfies(version: string, range: string, options: VersionSatisfiesOptions = {}): boolean {
  const checked = options.coerce === true ? (semver.valid(version) ?? semver.coerce(version)?.version) : version;
  if (checked === null || checked === undefined) return false;
  try {
    return semver.satisfies(checked, range, { includePrerelease: true });
  } catch {
    return false;
  }
}

/** Where a version lies against a range it does not satisfy (ADR-0053 п. 2). */
export type VersionDirection = "above" | "below" | "outside";

/**
 * `above` — greater than every version the range admits, `below` — less than
 * every one, `outside` — neither (a gap of `^0.3.0 || ^0.5.0` at `0.4.1`) or
 * a version or range that does not parse. Coerces like {@link versionSatisfies}.
 */
export function versionDirection(version: string, range: string, options: VersionSatisfiesOptions = {}): VersionDirection {
  const checked = options.coerce === true ? (semver.valid(version) ?? semver.coerce(version)?.version) : version;
  if (checked === null || checked === undefined) return "outside";
  try {
    if (semver.gtr(checked, range, { includePrerelease: true })) return "above";
    if (semver.ltr(checked, range, { includePrerelease: true })) return "below";
  } catch {
    return "outside";
  }
  return "outside";
}
