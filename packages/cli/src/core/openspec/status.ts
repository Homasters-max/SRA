/**
 * Artifact status of one Change, read from `openspec status --change <c> --json`
 * (REQ-KRN-027).
 *
 * Shape observed on OpenSpec 1.13.1 (fixtures `test/fixtures/openspec/status-*.json`):
 *
 *   { "changeName", "schemaName", "changeRoot", "artifactPaths": {...},
 *     "isPlanningComplete", "isComplete", "applyRequires": [...], "nextSteps": [...],
 *     "actionContext": {...},
 *     "artifacts": [ { "id", "outputPath", "status", "requires": [...], "missingDeps"? } ],
 *     "root": { "path", "source" } }
 *
 * Only `artifacts[].id` and `artifacts[].status` are part of the WARRANT
 * contract; everything else is OpenSpec's own bookkeeping and is dropped here so
 * a later OpenSpec release can add fields without changing `warrant status`.
 *
 * An unknown change makes the command exit 1 and print
 * `{ "status": [ { "severity": "error", ... } ] }` instead — that body has no
 * `artifacts` array, so it fails the shape check below.
 */
import { WarrantError } from "../errors.js";
import { runOpenspec } from "./cli.js";

/** The four states an OpenSpec artifact can be in. */
export const ARTIFACT_STATUSES = ["done", "ready", "blocked", "skipped"] as const;

export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

/** `{ proposal: "done", specs: "ready", ... }`, keyed by artifact id. */
export type ArtifactStatuses = Record<string, ArtifactStatus>;

function isArtifactStatus(value: unknown): value is ArtifactStatus {
  return typeof value === "string" && (ARTIFACT_STATUSES as readonly string[]).includes(value);
}

/**
 * Pure projection of the `openspec status --json` body onto `{ id: status }`.
 *
 * Throws `OPENSPEC_FAILED` when the body is not the expected shape, so a change
 * of contract in OpenSpec surfaces as an error instead of an empty result that
 * looks like "no artifacts".
 */
export function parseOpenspecStatus(json: unknown): ArtifactStatuses {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new WarrantError("OPENSPEC_FAILED", "openspec status returned no JSON object");
  }
  const artifacts = (json as { artifacts?: unknown }).artifacts;
  if (!Array.isArray(artifacts)) {
    throw new WarrantError("OPENSPEC_FAILED", "openspec status JSON has no `artifacts` array");
  }
  const out: ArtifactStatuses = {};
  for (const entry of artifacts) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, status } = entry as { id?: unknown; status?: unknown };
    if (typeof id !== "string" || id === "") continue;
    if (!isArtifactStatus(status)) {
      throw new WarrantError("OPENSPEC_FAILED", `openspec status reported an unknown status "${String(status)}" for artifact ${id}`);
    }
    out[id] = status;
  }
  return out;
}

export interface OpenspecStatusResult {
  artifacts: ArtifactStatuses;
  /** Set when the artifacts could not be read; the caller turns it into a stderr line. */
  warning?: string;
}

/**
 * Runs `openspec status` for one Change. Never throws: `warrant status` reports
 * the record even when OpenSpec cannot answer (the change directory may be gone,
 * which `stale[]` already explains).
 */
export function openspecStatus(change: string, cwd: string): OpenspecStatusResult {
  const run = runOpenspec(["status", "--change", change, "--json"], cwd);
  if (!run.ok) {
    const detail = (run.stderr || run.stdout).trim().split("\n")[0] ?? "";
    return { artifacts: {}, warning: `openspec status --change ${change} failed${detail === "" ? "" : `: ${detail}`}` };
  }
  try {
    return { artifacts: parseOpenspecStatus(run.json) };
  } catch (thrown) {
    return { artifacts: {}, warning: `${change}: ${(thrown as Error).message}` };
  }
}
