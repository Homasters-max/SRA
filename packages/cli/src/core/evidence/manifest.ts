/**
 * `manifest.json` of an evidence directory (06a section 5, design §6).
 *
 * A check rewrites the manifest whole on every record: `commit` and
 * `versions` describe the latest write, `evidence[]` lists every record file
 * of the directory (old records are never removed, P-19), and `runs` and
 * `gates` are carried over untouched — `gates` belongs to `gate`/`verify`.
 */

export interface ManifestVersions {
  warrant: string;
  openspec: string;
  lock_hash?: string | undefined;
  effective_policy_hash?: string | undefined;
}

export interface ManifestInput {
  change: string;
  commit: string;
  versions: ManifestVersions;
  /** Ids of every record in the directory. */
  evidence: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildManifest(previous: Record<string, unknown> | undefined, input: ManifestInput): Record<string, unknown> {
  const versions: Record<string, unknown> = { warrant: input.versions.warrant, openspec: input.versions.openspec };
  if (input.versions.lock_hash !== undefined) versions["lock_hash"] = input.versions.lock_hash;
  if (input.versions.effective_policy_hash !== undefined) {
    versions["effective_policy_hash"] = input.versions.effective_policy_hash;
  }

  const manifest: Record<string, unknown> = {
    $schema: "warrant://evidence-manifest/1",
    change: input.change,
    commit: input.commit,
    versions
  };
  if (Array.isArray(previous?.["runs"])) manifest["runs"] = previous["runs"];
  manifest["evidence"] = [...new Set(input.evidence)].sort();
  if (isPlainObject(previous?.["gates"])) manifest["gates"] = previous["gates"];
  return manifest;
}
