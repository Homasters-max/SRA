/**
 * `warrant id renumber <old> <new> --change <name>` (ADR-0012 point 1, SCN-KRN-059/060).
 *
 * A stable id is immutable once its Change is MERGED; before that, a collision
 * with the base branch is resolved by rewriting the id inside the Change only.
 * The blast radius is therefore fixed by construction: `openspec/changes/<name>/**`,
 * the project test root from `paths.tests`, and the Change record itself.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { WarrantError } from "../errors.js";
import { posix, walkFiles } from "../fs.js";
import { loadConfig } from "../packs/loader.js";
import { scanIds } from "./scan.js";

/** States after which a stable id may no longer move (ADR-0012 point 1). */
const IMMUTABLE_STATES = new Set(["MERGED", "ARCHIVED"]);

const STABLE_ID_RE = /^(REQ|SCN|TASK|UNK|ASM)-([A-Z]{2,5})-(\d{3})$/;

export interface RenumberResult {
  old: string;
  new: string;
  /** Project-relative POSIX paths of the files actually changed. */
  rewritten: string[];
}

/**
 * Ids contain `-`, which `\b` treats as a boundary, so `REQ-KRN-007` would
 * match inside `XREQ-KRN-0071`. Lookarounds over the id alphabet are the real
 * word boundary here.
 */
export function idOccurrenceRe(id: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9-])${id}(?![A-Za-z0-9-])`, "g");
}

/** Text files we may rewrite: anything that is not binary, detected by a NUL byte. */
function readTextFile(absolute: string): string | undefined {
  let buffer: Buffer;
  try {
    buffer = readFileSync(absolute);
  } catch {
    return undefined;
  }
  if (buffer.includes(0)) return undefined;
  return buffer.toString("utf8");
}

/** Directories whose files renumber is allowed to touch, plus the record file. */
function targetFiles(projectRoot: string, change: string): string[] {
  const files: string[] = [];
  const changeDir = path.join(projectRoot, "openspec", "changes", change);
  if (existsSync(changeDir)) files.push(...walkFiles(changeDir));

  let testsRel: unknown;
  try {
    const config = loadConfig(projectRoot);
    const paths = config["paths"];
    testsRel = typeof paths === "object" && paths !== null ? (paths as Record<string, unknown>)["tests"] : undefined;
  } catch {
    // The caller has already required the config; an unusable one simply means no test root.
    testsRel = undefined;
  }
  if (typeof testsRel === "string" && testsRel.length > 0) {
    const testsDir = path.join(projectRoot, testsRel);
    if (existsSync(testsDir) && statSync(testsDir).isDirectory()) files.push(...walkFiles(testsDir));
  }

  const record = path.join(projectRoot, ".warrant", "changes", `${change}.json`);
  if (existsSync(record)) files.push(record);

  return [...new Set(files)];
}

export function renumber(projectRoot: string, oldId: string, newId: string, change: string): RenumberResult {
  const oldMatch = STABLE_ID_RE.exec(oldId);
  const newMatch = STABLE_ID_RE.exec(newId);
  if (oldMatch === null || newMatch === null) {
    const bad = oldMatch === null ? oldId : newId;
    throw new WarrantError("ID_FORMAT", `"${bad}" is not a stable id of the form PREFIX-AREA-NNN`);
  }
  if (oldMatch[1] !== newMatch[1]) {
    throw new WarrantError("ID_FORMAT", `cannot renumber ${oldId} into ${newId}: the prefix must stay ${oldMatch[1]}`);
  }
  if (oldId === newId) {
    throw new WarrantError("ID_FORMAT", `<old> and <new> are the same id (${oldId})`);
  }

  const recordPath = path.join(projectRoot, ".warrant", "changes", `${change}.json`);
  const recordRel = `.warrant/changes/${change}.json`;
  if (!existsSync(recordPath)) {
    throw new WarrantError("CHANGE_NOT_FOUND", `no Change record ${recordRel}`, { path: recordRel });
  }
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(recordPath, "utf8"));
  } catch (cause) {
    throw new WarrantError("CONFIG_INVALID", `invalid JSON: ${(cause as Error).message}`, { path: recordRel });
  }
  const state =
    typeof record === "object" && record !== null ? (record as Record<string, unknown>)["change_state"] : undefined;
  if (typeof state === "string" && IMMUTABLE_STATES.has(state)) {
    throw new WarrantError("ID_IMMUTABLE", `${change} is ${state}: stable ids are immutable from MERGED on`, {
      path: recordRel
    });
  }

  // The scanner is the definition of "exists anywhere in the project" (ADR-0012 point 4).
  const taken = scanIds(projectRoot).ids.find((f) => f.id === newId);
  if (taken !== undefined) {
    throw new WarrantError("ID_TAKEN", `${newId} is already used in ${taken.file}`, { path: taken.file });
  }

  const re = idOccurrenceRe(oldId);
  const planned: { absolute: string; text: string }[] = [];
  for (const absolute of targetFiles(projectRoot, change)) {
    const text = readTextFile(absolute);
    if (text === undefined) continue;
    const replaced = text.replace(re, newId);
    if (replaced !== text) planned.push({ absolute, text: replaced });
  }

  if (planned.length === 0) {
    throw new WarrantError("USAGE", `${oldId} does not occur in change ${change}: nothing to renumber`, {
      path: `openspec/changes/${change}`
    });
  }

  const rewritten: string[] = [];
  for (const file of planned) {
    writeFileSync(file.absolute, file.text, "utf8");
    rewritten.push(posix(path.relative(projectRoot, file.absolute)));
  }
  rewritten.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { old: oldId, new: newId, rewritten };
}
