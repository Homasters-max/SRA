/**
 * The single JSON writer of the CLI (design D-3).
 *
 * Every command that produces a JSON file goes through {@link writeJsonFile}
 * so the bytes on disk are the ones `warrant fmt --check` and check (7) of
 * `validate` expect: two-space indent, LF, one trailing newline, UTF-8 without
 * BOM, keys in canonical order. Every file of the CLI state goes to disk
 * through {@link writeFileAtomic} (REQ-KRN-036): a temporary file of the same
 * directory, then a rename onto the place.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { EXIT, WarrantError } from "../errors.js";
import { getSchema, type Json } from "../schemas/loader.js";
import { parseSchemaUri } from "../schemas/registry.js";
import { orderKeys, type JsonObject } from "./order-keys.js";

/**
 * Serialises a value in the canonical style.
 *
 * `JSON.stringify` never emits CR, so the result is LF-only by construction;
 * the trailing newline makes the files line-oriented for diffs and POSIX tools.
 */
export function formatJson(value: Json): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** The schema a document declares, or `undefined` when it names none we know. */
export function schemaFor(json: Json): JsonObject | undefined {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return undefined;
  const ref = parseSchemaUri((json as JsonObject)["$schema"]);
  if (ref === null) return undefined;
  return getSchema(ref.name, ref.major);
}

/** Canonical text of a document, plus whether its `$schema` was recognised. */
export interface CanonicalText {
  text: string;
  /** False when the file has no `$schema` or names one the CLI does not ship: keys are then alphabetical only. */
  schemaKnown: boolean;
}

/**
 * Canonical bytes of a parsed document, as `fmt` would write them.
 * Callers warn on `schemaKnown === false` (REQ-KRN-022).
 */
export function canonicalText(json: Json): CanonicalText {
  const schema = schemaFor(json);
  return { text: formatJson(orderKeys(json, schema)), schemaKnown: schema !== undefined };
}

/**
 * Writes a JSON value to disk in canonical form.
 * `schema` may be passed when the caller already has it; otherwise it is taken
 * from the document's own `$schema`.
 */
export function writeJsonFile(absolutePath: string, value: Json, schema?: JsonObject | undefined): void {
  const chosen = schema ?? schemaFor(value);
  // `utf8` in Node never writes a BOM, which is what the contract requires.
  writeFileAtomic(absolutePath, formatJson(orderKeys(value, chosen)));
}

/** Rename calls in all before `BUSY` (design I-206). */
export const RENAME_ATTEMPTS = 5;
/** The pause between two rename calls, ms. */
export const RENAME_PAUSE_MS = 20;
/** What a rename refused by a file held open on Windows (antivirus, indexer, editor) fails with. */
const HELD_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Seams of {@link writeFileAtomic} for tests: the rename and the platform whose rules apply. */
export interface AtomicWriteOptions {
  rename?: (from: string, to: string) => void;
  platform?: NodeJS.Platform;
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Writes `data` (a string as UTF-8, without a BOM) to `absolutePath`
 * atomically (REQ-KRN-036, design §2): the directory is created, the bytes go to
 * `<dir>/.<name>.<pid>.<random>.tmp`, which is then renamed onto the place. An
 * interrupted write leaves the former file (or its absence) whole; on a failure
 * the temporary file is removed. On `win32` a rename refused with `EPERM`,
 * `EBUSY` or `EACCES` is tried {@link RENAME_ATTEMPTS} times in all with a pause
 * of {@link RENAME_PAUSE_MS} ms, then it is `BUSY`, exit 2 (I-206); any other
 * failure is thrown as it is.
 */
export function writeFileAtomic(absolutePath: string, data: string | Uint8Array, options: AtomicWriteOptions = {}): void {
  const rename = options.rename ?? renameSync;
  const retries = (options.platform ?? process.platform) === "win32";
  const dir = path.dirname(absolutePath);
  mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(absolutePath)}.${String(process.pid)}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    if (typeof data === "string") writeFileSync(temp, data, "utf8");
    else writeFileSync(temp, data);
    for (let attempt = 1; ; attempt += 1) {
      try {
        rename(temp, absolutePath);
        return;
      } catch (thrown) {
        const code = (thrown as NodeJS.ErrnoException).code;
        if (!retries || code === undefined || !HELD_CODES.has(code)) throw thrown;
        if (attempt >= RENAME_ATTEMPTS) {
          throw new WarrantError("BUSY", `${absolutePath}: the rename onto the file failed ${String(RENAME_ATTEMPTS)} times (${code})`, {
            path: absolutePath,
            hint: "another process holds the file (antivirus, editor): retry",
            exitCode: EXIT.WAIT
          });
        }
        pause(RENAME_PAUSE_MS);
      }
    }
  } catch (thrown) {
    rmSync(temp, { force: true });
    throw thrown;
  }
}
