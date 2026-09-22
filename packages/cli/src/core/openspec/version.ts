/**
 * OpenSpec version gate (task 7.5, design D-7).
 *
 * The version on PATH is checked against `warrant.json.openspec` BEFORE any
 * other `openspec` invocation: a mismatched CLI can silently produce a
 * different `config.yaml` shape, and a wrong guess written into the lock is
 * worse than a refusal.
 */
import semver from "semver";

import { WarrantError } from "../errors.js";
import { runOpenspec } from "./cli.js";

let cached: string | null | undefined;

/**
 * Version printed by `openspec --version`, or null when the binary is absent
 * or prints nothing recognisable. Cached for the lifetime of the process.
 */
export function openspecVersion(cwd: string = process.cwd()): string | null {
  if (cached !== undefined) return cached;
  const run = runOpenspec(["--version"], cwd);
  if (!run.ok) {
    cached = null;
    return cached;
  }
  const match = /\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?/.exec(run.stdout);
  cached = match === null ? null : match[0];
  return cached;
}

/** Only for tests: forget the cached version. */
export function resetOpenspecVersionCache(): void {
  cached = undefined;
}

function configuredRange(config: Record<string, unknown>): string {
  const value = config["openspec"];
  return typeof value === "string" ? value : "*";
}

/**
 * Throws when `openspec` is missing or its version does not satisfy the range
 * in `warrant.json`; returns the exact version otherwise.
 */
export function requireOpenspec(config: Record<string, unknown>, cwd: string = process.cwd()): string {
  const version = openspecVersion(cwd);
  if (version === null) {
    throw new WarrantError(
      "OPENSPEC_FAILED",
      "`openspec` is required but was not found on PATH; install it (see docs/08-packs.md) and retry",
      { path: ".warrant/warrant.json#/openspec" }
    );
  }
  const range = configuredRange(config);
  if (range !== "*" && !semver.satisfies(version, range, { includePrerelease: true })) {
    throw new WarrantError(
      "OPENSPEC_VERSION",
      `openspec ${version} on PATH does not satisfy the configured range "${range}"`,
      { path: ".warrant/warrant.json#/openspec" }
    );
  }
  return version;
}
