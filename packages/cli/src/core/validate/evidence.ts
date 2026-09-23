/**
 * Check (12) of `validate`: evidence records and manifests, and the `metrics`
 * half of the two-step validation (REQ-KRN-021, REQ-KRN-001, D-13, design §13).
 *
 * Step one — the kernel schema — is check (1), which already covers every JSON
 * file under `.warrant/**`. Step two applies the form a pack declares for the
 * `kind` of a record: `metrics_schema` of `provides.evidence_kinds`, compiled
 * here with the same Ajv dialect as the kernel schemas.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import Ajv2020Cjs, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsCjs from "ajv-formats";

import type { CliError } from "../errors.js";
import type { EvidenceKind, LoadResult } from "../packs/types.js";
import { messageOf, pointerOf, validateDocument } from "../schemas/loader.js";

/** Same interop shim as `core/schemas/loader.ts`: CommonJS `export =` under NodeNext. */
interface AjvLike {
  compile(schema: object): ValidateFunction;
}
const Ajv2020 = Ajv2020Cjs as unknown as new (options?: Record<string, unknown>) => AjvLike;
const addFormats = addFormatsCjs as unknown as (ajv: AjvLike, formats: string[]) => unknown;

export const EVIDENCE_DIR = path.join(".warrant", "evidence");
export const MANIFEST_FILE = "manifest.json";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Compiles the `metrics` form of every kind that declares one. A form that is
 * not a valid JSON Schema is a pack defect, reported at the schema file.
 */
export function compileMetricsForms(kinds: readonly EvidenceKind[]): {
  forms: Map<string, ValidateFunction>;
  errors: CliError[];
} {
  const forms = new Map<string, ValidateFunction>();
  const errors: CliError[] = [];
  for (const kind of kinds) {
    if (kind.metricsSchema === undefined) continue;
    const { json, path: schemaPath } = kind.metricsSchema;
    if (!isPlainObject(json)) {
      errors.push({ code: "CONFIG_INVALID", message: `metrics schema of kind "${kind.kind}" is not an object`, path: schemaPath });
      continue;
    }
    // One instance per form: pack forms carry no `$id`, and nothing may leak
    // from one pack's form into another's.
    const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
    addFormats(ajv, ["date", "date-time", "uri"]);
    try {
      forms.set(kind.kind, ajv.compile(json));
    } catch (cause) {
      errors.push({
        code: "CONFIG_INVALID",
        message: `metrics schema of kind "${kind.kind}" does not compile: ${(cause as Error).message}`,
        path: schemaPath
      });
    }
  }
  return { forms, errors };
}

function readObject(absolute: string): Record<string, unknown> | undefined {
  try {
    const json = JSON.parse(readFileSync(absolute, "utf8")) as unknown;
    return isPlainObject(json) ? json : undefined;
  } catch {
    return undefined; // check (1) reports unreadable files
  }
}

/** Names of the entries of a directory, sorted; files or directories only. */
function entries(dir: string, want: "file" | "dir"): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => (want === "file" ? e.isFile() : e.isDirectory()))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Second-step validation of one record that passed its kernel schema. */
function checkRecord(
  record: Record<string, unknown>,
  reported: string,
  kinds: ReadonlyMap<string, EvidenceKind>,
  forms: ReadonlyMap<string, ValidateFunction>
): CliError[] {
  const errors: CliError[] = [];
  const kind = String(record["kind"]);
  const declared = kinds.get(kind);
  if (declared === undefined) {
    errors.push({
      code: "SEMANTIC_INVALID",
      message: `evidence kind "${kind}" is not declared by any enabled pack`,
      path: `${reported}#/kind`
    });
  }

  const metrics = record["metrics"];
  if (!isPlainObject(metrics)) return errors;
  const form = forms.get(kind);
  if (form === undefined) {
    // An empty object says nothing a form could reject (REQ-KRN-001: only a
    // non-empty `metrics` needs a declared form).
    if (Object.keys(metrics).length > 0 && declared?.metricsSchema === undefined) {
      errors.push({
        code: "PACK_FORM_UNKNOWN",
        message: `evidence kind "${kind}" declares no metrics_schema, but the record carries metrics`,
        path: `${reported}#/metrics`
      });
    }
    return errors;
  }
  if (!form(metrics)) {
    for (const e of form.errors ?? []) {
      errors.push({
        code: "SCHEMA_VIOLATION",
        message: `metrics of kind "${kind}": ${messageOf(e)}`,
        path: `${reported}#/metrics${pointerOf(e)}`
      });
    }
  }
  return errors;
}

/**
 * Check (12) over `.warrant/evidence/<change>/`: each `*.json` other than
 * `manifest.json` is an evidence record; `raw/` and other subdirectories hold
 * check output and are not looked at.
 */
export function checkEvidence(root: string, loaded: LoadResult): CliError[] {
  const compiled = compileMetricsForms(loaded.evidenceKinds);
  const errors: CliError[] = [...compiled.errors];
  const kinds = new Map(loaded.evidenceKinds.map((k) => [k.kind, k]));

  const base = path.join(root, EVIDENCE_DIR);
  for (const change of entries(base, "dir")) {
    const dir = path.join(base, change);
    const dirRel = `${EVIDENCE_DIR.split(path.sep).join("/")}/${change}`;
    const recordIds: string[] = [];

    for (const name of entries(dir, "file")) {
      if (!name.toLowerCase().endsWith(".json") || name === MANIFEST_FILE) continue;
      const reported = `${dirRel}/${name}`;
      const record = readObject(path.join(dir, name));
      if (record === undefined) {
        recordIds.push(name.replace(/\.json$/i, ""));
        continue;
      }
      recordIds.push(typeof record["id"] === "string" ? record["id"] : name.replace(/\.json$/i, ""));
      if (record["$schema"] !== "warrant://evidence/1") {
        errors.push({
          code: "SCHEMA_VIOLATION",
          message: "a file in an evidence directory must carry schema warrant://evidence/1",
          path: reported
        });
        continue;
      }
      if (!validateDocument(record).ok) continue; // check (1) reports it with pointers
      errors.push(...checkRecord(record, reported, kinds, compiled.forms));
    }

    const manifestRel = `${dirRel}/${MANIFEST_FILE}`;
    const manifestAbs = path.join(dir, MANIFEST_FILE);
    if (!existsSync(manifestAbs)) {
      if (recordIds.length > 0) {
        errors.push({
          code: "SEMANTIC_INVALID",
          message: `evidence directory holds ${recordIds.length} record(s) but no ${MANIFEST_FILE}`,
          path: manifestRel
        });
      }
      continue;
    }
    const manifest = readObject(manifestAbs);
    if (manifest === undefined) continue;
    if (manifest["$schema"] !== "warrant://evidence-manifest/1") {
      errors.push({
        code: "SCHEMA_VIOLATION",
        message: `${MANIFEST_FILE} must carry schema warrant://evidence-manifest/1`,
        path: manifestRel
      });
      continue;
    }
    if (!validateDocument(manifest).ok) continue;

    // `manifest.evidence[]` lists exactly the records of the directory.
    const listed = Array.isArray(manifest["evidence"])
      ? manifest["evidence"].filter((v): v is string => typeof v === "string")
      : [];
    const present = new Set(recordIds);
    listed.forEach((id, i) => {
      if (present.has(id)) return;
      errors.push({
        code: "SEMANTIC_INVALID",
        message: `manifest lists ${id}, but ${dirRel}/ holds no such record`,
        path: `${manifestRel}#/evidence/${i}`
      });
    });
    const inManifest = new Set(listed);
    for (const id of recordIds) {
      if (inManifest.has(id)) continue;
      errors.push({
        code: "SEMANTIC_INVALID",
        message: `record ${id} in ${dirRel}/ is not listed in manifest evidence[]`,
        path: `${manifestRel}#/evidence`
      });
    }
  }
  return errors;
}
