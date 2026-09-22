/**
 * Reading `.warrant/changes/<change>.json` — shared by `resolve` and `status`.
 *
 * Both commands need the same three steps (exists, parses, validates against
 * `warrant://change-record/1`), and both must report the same codes for the
 * same problems, so the steps live here rather than in either command.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { WarrantError, type CliError } from "../errors.js";
import { validateFile } from "../schemas/semantic.js";

/** A change record, as stored. Key order is the file's own. */
export type ChangeRecord = Record<string, unknown>;

function posix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Reads and parses a JSON file, reporting both failures as `CONFIG_INVALID`. */
export function readJsonFile(absolute: string, reported: string): unknown {
  let text: string;
  try {
    text = readFileSync(absolute, "utf8");
  } catch (cause) {
    throw new WarrantError("CONFIG_INVALID", `cannot read file: ${(cause as Error).message}`, { path: reported });
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new WarrantError("CONFIG_INVALID", `invalid JSON: ${(cause as Error).message}`, { path: reported });
  }
}

/** The record of the Change, validated against `warrant://change-record/1`. */
export function readChangeRecord(root: string, change: string): ChangeRecord {
  const rel = posix(path.join(".warrant", "changes", `${change}.json`));
  const absolute = path.join(root, ".warrant", "changes", `${change}.json`);
  if (!existsSync(absolute)) {
    throw new WarrantError("CHANGE_NOT_FOUND", `no record for change "${change}" in .warrant/changes/`, {
      path: rel
    });
  }
  const json = readJsonFile(absolute, rel);
  const result = validateFile(json, rel);
  if (!result.ok) {
    const first = result.errors[0] as CliError;
    throw new WarrantError(first.code, first.message, { path: first.path ?? rel });
  }
  return json as ChangeRecord;
}

/** Names of every Change with a record, sorted, for `warrant status` without an argument. */
export function listChangeNames(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(path.join(root, ".warrant", "changes"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -".json".length));
  } catch {
    return [];
  }
  return entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
