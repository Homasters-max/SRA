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
import { pathToFileURL } from "node:url";

import { projectPath } from "../fs.js";

/** Environment variable that moves `<state>` out of the project (D-2). */
export const STATE_ENV = "WARRANT_STATE_DIR";

export const MANIFEST_FILE = "manifest.json";

/** Record files are named by their id: `EVID-<ULID>.json`. */
const RECORD_FILE_RE = /^EVID-[0-9A-HJKMNP-TV-Z]{26}\.json$/;

/** Absolute `<state>` directory; a relative `WARRANT_STATE_DIR` is taken from the project root. */
export function stateDir(root: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[STATE_ENV];
  if (override !== undefined && override !== "") return path.resolve(root, override);
  return path.join(root, ".warrant");
}

/** Absolute `<state>/evidence/<change>/`. */
export function evidenceDir(root: string, change: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(stateDir(root, env), "evidence", change);
}

/** Absolute `{out}` of one check: `<state>/evidence/<change>/raw/<check-id>/`. */
export function rawDir(root: string, change: string, checkId: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(evidenceDir(root, change, env), "raw", checkId);
}

/**
 * How a file is referenced from a record or the CLI output: POSIX path
 * relative to the project root when it lies inside it, a `file://` URI
 * otherwise (a `WARRANT_STATE_DIR` outside the project, SCN-VER-003).
 */
export function projectUri(root: string, absolute: string): string {
  const rel = projectPath(root, absolute);
  return rel === undefined || rel === "" ? pathToFileURL(absolute).href : rel;
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
