/**
 * OpenSpec version gate (task 7.5, design D-7).
 *
 * The version on PATH is checked against `warrant.json.openspec` BEFORE any
 * other `openspec` invocation: a mismatched CLI can silently produce a
 * different `config.yaml` shape, and a wrong guess written into the lock is
 * worse than a refusal. The version itself comes from the port, which asks
 * the binary once per CLI call.
 */
import type { WarrantConfig } from "../config.js";
import { WarrantError } from "../errors.js";
import type { OpenSpecPort } from "../ports/openspec.js";
import { versionSatisfies } from "../version-range.js";

/** True when `openspec --version` answers with a version. */
export async function openspecAvailable(openspec: OpenSpecPort): Promise<boolean> {
  return (await openspec.version()) !== null;
}

/**
 * Throws when `openspec` is missing or its version does not satisfy the range
 * in `warrant.json`; returns the exact version otherwise.
 */
export async function requireOpenspec(openspec: OpenSpecPort, config: WarrantConfig): Promise<string> {
  const version = await openspec.version();
  if (version === null) {
    throw new WarrantError(
      "OPENSPEC_FAILED",
      "`openspec` is required but was not found on PATH",
      { path: ".warrant/warrant.json#/openspec", hint: "install it (see docs/08-packs.md) and retry" }
    );
  }
  const range = config.openspec;
  if (range !== "*" && !versionSatisfies(version, range)) {
    throw new WarrantError(
      "OPENSPEC_VERSION",
      `openspec ${version} on PATH does not satisfy the configured range "${range}"`,
      { path: ".warrant/warrant.json#/openspec" }
    );
  }
  return version;
}
