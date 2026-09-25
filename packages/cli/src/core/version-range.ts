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
