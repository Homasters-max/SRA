/**
 * Where evidence lives and how it is read back (REQ-VER-001, design §1, §6).
 *
 * `<state>` is `WARRANT_STATE_DIR` when set, else `.warrant` of the project
 * (D-2); only `evidence/` (and later `runs/`) move with it — records, waivers
 * and `local/` always stay in `.warrant`. Evidence of a Change is one
 * directory `<state>/evidence/<change>/`: `manifest.json`, one `<EVID>.json`
 * per record and the raw check output under `raw/<check-id>/` (`{out}`).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeFileAtomic, writeJsonFile } from "../canon/format-json.js";
import { cliError, type CliError } from "../errors.js";
import { projectUri, stateDir } from "../fs.js";
import { isPlainObject, strings } from "../json.js";
import type { Json } from "../schemas/loader.js";
import { validateFile } from "../schemas/semantic.js";
import type { Writes } from "../writes.js";
import { buildManifest, type ManifestVersions } from "./manifest.js";

export const MANIFEST_FILE = "manifest.json";

/** Record files are named by their id: `EVID-<ULID>.json`. */
const RECORD_FILE_RE = /^EVID-[0-9A-HJKMNP-TV-Z]{26}\.json$/;

/**
 * Project path of the evidence of `change` as the repository commits it:
 * `.warrant/evidence/<change>` whatever `WARRANT_STATE_DIR` (A-35) — what
 * `warrant ci` reads from git; `**` for the evidence of every Change.
 */
export function evidenceRel(change: string): string {
  return `.warrant/evidence/${change}`;
}

/** Absolute `<state>/evidence/<change>/`. */
export function evidenceDir(root: string, change: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateDir(root, env), "evidence", change);
}

/** Absolute `{out}` of one check: `<state>/evidence/<change>/raw/<check-id>/`. */
export function rawDir(root: string, change: string, checkId: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(evidenceDir(root, change, env), "raw", checkId);
}

/** Ids of the records in an evidence directory, sorted (ULIDs sort by time). */
export function listRecordIds(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && RECORD_FILE_RE.test(entry.name))
      .map((entry) => entry.name.slice(0, -".json".length));
  } catch {
    return [];
  }
  return names.sort();
}

/**
 * A record built by this run — written already, or under `--dry-run` only
 * collected — that the gates judge beside those on disk (REQ-KRN-034).
 */
export interface PendingRecord {
  id: string;
  json: Record<string, unknown>;
}

/** One record as found on disk. */
export interface StoredRecord {
  id: string;
  /** Absolute path of the file. */
  file: string;
  json: Record<string, unknown>;
}

/**
 * Every record of the directory that parses to an object, oldest first.
 * Lenient like `readAllRecords`: a malformed file is `validate`'s finding.
 */
export function readRecords(dir: string): StoredRecord[] {
  const out: StoredRecord[] = [];
  for (const id of listRecordIds(dir)) {
    const file = path.join(dir, `${id}.json`);
    try {
      const json = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (typeof json === "object" && json !== null && !Array.isArray(json)) {
        out.push({ id, file, json: json as Record<string, unknown> });
      }
    } catch {
      // unreadable: check (1) / (12) of `validate` reports it
    }
  }
  return out;
}

/** The manifest of an evidence directory as an object, or undefined when absent or malformed. */
export function readManifest(dir: string): Record<string, unknown> | undefined {
  try {
    const json = JSON.parse(readFileSync(path.join(dir, MANIFEST_FILE), "utf8")) as unknown;
    if (typeof json === "object" && json !== null && !Array.isArray(json)) return json as Record<string, unknown>;
  } catch {
    // absent or malformed: rewritten from scratch
  }
  return undefined;
}

/** Schema every imported record must be valid by. */
const EVIDENCE_SCHEMA = "warrant://evidence/1";

export interface ImportInput {
  root: string;
  /** `ctx.writes`: under `--dry-run` the records and the manifest are only collected. */
  writes: Writes;
  change: string;
  env: NodeJS.ProcessEnv;
  /** The record files to import: file name (`<id>.json`) → bytes, as the artifact holds them. */
  files: ReadonlyMap<string, Buffer>;
  /** `manifest.commit`: HEAD, as for any local write (REQ-VER-012). */
  commit: string;
  versions: ManifestVersions;
}

export interface ImportResult {
  /** Ids of every imported record, those already present included; sorted. */
  ids: string[];
  /** `SCHEMA_VIOLATION`, `EVIDENCE_CONFLICT`: when not empty, nothing is written. */
  errors: CliError[];
}

/**
 * Imports records made elsewhere (`ci fetch`, REQ-VER-012) into
 * `<state>/evidence/<change>/`: byte for byte, each checked by `evidence/1`
 * and by its file name (`<id>.json`). A record already present with the same
 * bytes is skipped; with other bytes it is `EVIDENCE_CONFLICT`. Any error —
 * nothing is written. The record files are written before the manifest, so an
 * interrupted import is completed by the next one; the manifest is rewritten
 * only when a record is new to the directory or missing from `evidence[]`.
 */
export function importRecords(input: ImportInput): ImportResult {
  const dir = evidenceDir(input.root, input.change, input.env);
  const errors: CliError[] = [];
  const ids: string[] = [];
  const fresh: { file: string; bytes: Buffer }[] = [];
  for (const [name, bytes] of [...input.files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const file = path.join(dir, name);
    const reported = projectUri(input.root, file);
    let json: unknown;
    try {
      json = JSON.parse(bytes.toString("utf8"));
    } catch {
      json = undefined;
    }
    const id = isPlainObject(json) ? json["id"] : undefined;
    if (!RECORD_FILE_RE.test(name) || typeof id !== "string" || name !== `${id}.json`) {
      errors.push(cliError("SCHEMA_VIOLATION", `${name}: a record file is named <id>.json by the id it carries (${String(id)})`, { path: reported }));
      continue;
    }
    const checked = isPlainObject(json) && json["$schema"] === EVIDENCE_SCHEMA ? validateFile(json as Json, reported) : undefined;
    if (checked === undefined || !checked.ok) {
      const detail = checked === undefined ? `$schema is not ${EVIDENCE_SCHEMA}` : (checked.errors[0]?.message ?? "");
      errors.push(cliError("SCHEMA_VIOLATION", `${name}: not a valid ${EVIDENCE_SCHEMA} record: ${detail}`, { path: reported }));
      continue;
    }
    ids.push(id);
    let present: Buffer | undefined;
    try {
      present = readFileSync(file);
    } catch {
      present = undefined;
    }
    if (present === undefined) fresh.push({ file, bytes });
    else if (!present.equals(bytes)) {
      errors.push(
        cliError("EVIDENCE_CONFLICT", `${id}: ${reported} exists with other content than the record of the same id being imported`, {
          path: reported,
          hint: `compare the two; a record never changes — remove the local one only if it is not committed`
        })
      );
    }
  }
  if (errors.length > 0) return { ids: [], errors };

  for (const { file, bytes } of fresh) {
    input.writes.write(projectUri(input.root, file), () => writeFileAtomic(file, bytes));
  }
  const manifest = readManifest(dir);
  const listed = new Set(strings(manifest?.["evidence"]));
  if (fresh.length > 0 || ids.some((id) => !listed.has(id))) {
    input.writes.write(projectUri(input.root, path.join(dir, MANIFEST_FILE)), () =>
      writeJsonFile(
        path.join(dir, MANIFEST_FILE),
        buildManifest(manifest, { change: input.change, commit: input.commit, versions: input.versions, evidence: [...listRecordIds(dir), ...ids] })
      )
    );
  }
  return { ids: ids.sort(), errors: [] };
}
