/**
 * Writing evidence records (design §6): one record validated against
 * `warrant://evidence/1`, then the manifest of the Change rewritten with the
 * `versions` of this CLI run. Shared by `check` (its records) and by
 * `transition` (`human-approval`).
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeJsonFile } from "../canon/format-json.js";
import { canonicalHash } from "../canon/hash.js";
import type { Ctx } from "../ctx.js";
import { WarrantError } from "../errors.js";
import { projectUri } from "../fs.js";
import { isPlainObject } from "../json.js";
import { LOCK_REL } from "../packs/hash.js";
import { validateFile } from "../schemas/semantic.js";
import type { Writes } from "../writes.js";
import { CLI_VERSION } from "../../version.js";
import { buildManifest, type ManifestVersions } from "./manifest.js";
import { evidenceDir, listRecordIds, MANIFEST_FILE, readManifest } from "./store.js";

export interface StoreParams {
  root: string;
  /** `ctx.writes`: under `--dry-run` the record and the manifest are only collected. */
  writes: Writes;
  change: string;
  env: NodeJS.ProcessEnv;
  /** The record, already built; its `id` names the file. */
  record: Record<string, unknown>;
  /** `manifest.commit`: the commit the record speaks of. */
  commit: string;
  versions: ManifestVersions;
  /** What produced the record, for the error message. */
  what: string;
}

/**
 * Validates a record against `warrant://evidence/1`, writes it to
 * `<state>/evidence/<change>/<id>.json` and rewrites the manifest (design §6).
 * Shared by `check` and by `transition`, which writes `human-approval`.
 * The record goes first and the manifest is rebuilt from the directory, so a
 * record left outside `evidence[]` by an interrupted write is listed by the
 * next call (REQ-KRN-036, design I-203); a record or Run is written after.
 * Returns the reported path of the record.
 */
export function storeRecord(params: StoreParams): string {
  const dir = evidenceDir(params.root, params.change, params.env);
  const file = path.join(dir, `${String(params.record["id"])}.json`);
  const reported = projectUri(params.root, file);
  const checked = validateFile(params.record, reported);
  if (!checked.ok) {
    throw new WarrantError("INTERNAL", `the record of ${params.what} does not match its schema: ${checked.errors[0]?.message ?? ""}`);
  }
  params.writes.write(reported, () => {
    mkdirSync(dir, { recursive: true });
    writeJsonFile(file, params.record);
  });
  const manifest = path.join(dir, MANIFEST_FILE);
  params.writes.write(projectUri(params.root, manifest), () =>
    writeJsonFile(
      manifest,
      buildManifest(readManifest(dir), {
        change: params.change,
        commit: params.commit,
        versions: params.versions,
        evidence: listRecordIds(dir)
      })
    )
  );
  return reported;
}

/**
 * `manifest.versions` of this CLI run: the CLI, OpenSpec (PATH, then lock,
 * else `0.0.0`), the lock hash and the effective policy hash.
 */
export async function manifestVersions(ctx: Ctx, policyHash: string): Promise<ManifestVersions> {
  const lock = readLock(ctx.root);
  return {
    warrant: CLI_VERSION,
    openspec: await manifestOpenspecVersion(ctx, lock),
    ...(lock === undefined ? {} : { lock_hash: canonicalHash(lock) }),
    effective_policy_hash: policyHash
  };
}

/** Version of OpenSpec for the manifest: the binary on PATH, else the lock's; `0.0.0` when neither is known. */
async function manifestOpenspecVersion(ctx: Ctx, lock: Record<string, unknown> | undefined): Promise<string> {
  const onPath = await ctx.openspec.version();
  if (onPath !== null) return onPath;
  if (typeof lock?.["openspec"] === "string") return lock["openspec"];
  ctx.warn("check: OpenSpec version unknown (no `openspec` on PATH, no lock); manifest.versions.openspec is 0.0.0\n");
  return "0.0.0";
}

function readLock(root: string): Record<string, unknown> | undefined {
  const file = path.join(root, ...LOCK_REL.split("/"));
  if (!existsSync(file)) return undefined;
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return isPlainObject(json) ? json : undefined;
  } catch {
    return undefined;
  }
}
