/**
 * Loads and compiles the kernel JSON Schemas once per process and validates
 * documents against them (REQ-KRN-001, design D-2).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020Cjs, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsCjs from "ajv-formats";

import type { CliError } from "../errors.js";
import { isPlainObject } from "../json.js";
import {
  ALL_SCHEMAS,
  DOCUMENT_SCHEMAS,
  KERNEL_MAJOR,
  parseSchemaUri,
  schemaFileName,
  type SchemaRef
} from "./registry.js";

export type { ValidateFunction };

/**
 * `ajv` and `ajv-formats` are CommonJS with `export =`, which `NodeNext` types
 * as a namespace even though the ESM default import yields the callable value
 * at runtime. The casts below are the interop shim, not a loosening of types.
 */
export interface AjvLike {
  addSchema(schema: object): unknown;
  getSchema(keyRef: string): ValidateFunction | undefined;
  compile(schema: object): ValidateFunction;
}
const Ajv2020 = Ajv2020Cjs as unknown as new (options?: Record<string, unknown>) => AjvLike;
const addFormats = addFormatsCjs as unknown as (ajv: AjvLike, formats: string[]) => unknown;

/**
 * A fresh Ajv instance of the WARRANT dialect: JSON Schema 2020-12, `strict`,
 * `allErrors`, `allowUnionTypes`, formats `date`, `date-time`, `uri`. The only
 * place that imports `ajv` / `ajv-formats` (ADR-0035 п. 1, design §7).
 */
export function createAjv(): AjvLike {
  const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
  addFormats(ajv, ["date", "date-time", "uri"]);
  return ajv;
}

/** Any JSON value. */
export type Json = unknown;

interface JsonObject {
  [key: string]: unknown;
}

/**
 * Directory holding `<name>.<major>.schema.json`.
 *
 * Resolved from `import.meta.url` so it works both from `src/core/schemas`
 * (vitest) and from `dist/core/schemas` (installed CLI): both are three levels
 * below the package root, which holds `schemas/`.
 */
export const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "schemas");

const COMMENT_PROPERTY = {
  type: "string",
  description: "Free-form note for humans and LLM editors; ignored by WARRANT (REQ-KRN-001)."
} as const;

/**
 * Recursively allows a `$comment` string key in every closed object schema.
 *
 * Doing this in one helper (rather than by hand in 18 files) is design D-2:
 * hand-written copies would inevitably be forgotten. Dictionaries are modelled
 * as `patternProperties` + `additionalProperties: false`, so the same rule
 * applies to them; their key patterns never match `$comment`.
 */
export function allowComment(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(allowComment);
  if (!isPlainObject(node)) return node;

  const out: JsonObject = { ...node };

  for (const key of ["properties", "$defs", "definitions", "patternProperties"] as const) {
    const sub = out[key];
    if (isPlainObject(sub)) {
      const mapped: JsonObject = {};
      for (const [k, v] of Object.entries(sub)) mapped[k] = allowComment(v);
      out[key] = mapped;
    }
  }
  for (const key of ["items", "additionalProperties", "contains", "not", "propertyNames"] as const) {
    if (key in out) out[key] = allowComment(out[key]);
  }
  for (const key of ["oneOf", "anyOf", "allOf", "prefixItems"] as const) {
    const sub = out[key];
    if (Array.isArray(sub)) out[key] = sub.map(allowComment);
  }

  if (out["additionalProperties"] === false) {
    const props = isPlainObject(out["properties"]) ? { ...out["properties"] } : {};
    if (!("$comment" in props)) props["$comment"] = { ...COMMENT_PROPERTY };
    out["properties"] = props;
  }

  return out;
}

interface LoadedSchema {
  ref: SchemaRef;
  raw: JsonObject;
  validate: ValidateFunction;
}

let cache: Map<string, LoadedSchema> | null = null;

function key(name: string, major: number): string {
  return `${name}/${major}`;
}

function loadAll(): Map<string, LoadedSchema> {
  if (cache !== null) return cache;

  const ajv = createAjv();

  const raws = new Map<string, JsonObject>();
  for (const name of ALL_SCHEMAS) {
    const file = join(SCHEMAS_DIR, schemaFileName(name, KERNEL_MAJOR));
    const raw = JSON.parse(readFileSync(file, "utf8")) as JsonObject;
    raws.set(key(name, KERNEL_MAJOR), raw);
    ajv.addSchema(allowComment(raw) as object);
  }

  const loaded = new Map<string, LoadedSchema>();
  for (const name of DOCUMENT_SCHEMAS) {
    const k = key(name, KERNEL_MAJOR);
    const validate = ajv.getSchema(`warrant://${name}/${KERNEL_MAJOR}`);
    if (validate === undefined) {
      throw new Error(`schema warrant://${name}/${KERNEL_MAJOR} failed to compile`);
    }
    loaded.set(k, {
      ref: { name, major: KERNEL_MAJOR },
      raw: raws.get(k) as JsonObject,
      validate
    });
  }
  // Shared schemas are compiled (they must be valid) but are not documents.
  for (const name of ["common"]) {
    const k = key(name, KERNEL_MAJOR);
    if (ajv.getSchema(`warrant://${name}/${KERNEL_MAJOR}`) === undefined) {
      throw new Error(`schema warrant://${name}/${KERNEL_MAJOR} failed to compile`);
    }
  }
  cache = loaded;
  return loaded;
}

/** File names of every schema shipped with the CLI. */
export function listSchemaFiles(): string[] {
  return readdirSync(SCHEMAS_DIR)
    .filter((f) => f.endsWith(".schema.json"))
    .sort();
}

/** Names and majors of the document schemas, compiled and ready. */
export function listSchemas(): SchemaRef[] {
  return [...loadAll().values()].map((s) => ({ ...s.ref }));
}

/**
 * The raw, un-augmented schema JSON — the contract as written on disk.
 * `fmt` uses it to order keys, so it must not contain the injected `$comment`.
 */
export function getSchema(name: string, major: number = KERNEL_MAJOR): JsonObject | undefined {
  const entry = loadAll().get(key(name, major));
  return entry?.raw;
}

/** Reads a shipped schema file as raw JSON, including `common`. */
export function readSchemaFile(name: string, major: number = KERNEL_MAJOR): JsonObject {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, schemaFileName(name, major)), "utf8")) as JsonObject;
}

/** JSON Pointer of the value an Ajv error is about (shared with the pack forms of D-13). */
export function pointerOf(err: ErrorObject): string {
  const params = err.params as { missingProperty?: string; propertyName?: string };
  if (err.keyword === "required" && typeof params.missingProperty === "string") {
    // Ajv anchors `required` at the parent; report the field that is missing.
    return `${err.instancePath}/${params.missingProperty}`;
  }
  // `propertyNames` failures (and the sub-errors Ajv reports for them) name the
  // offending key instead of pointing at it; anchor them on that key.
  const named = (err as { propertyName?: string }).propertyName ?? params.propertyName;
  if (typeof named === "string") {
    return `${err.instancePath}/${named}`;
  }
  return err.instancePath;
}

/** Human message of an Ajv error. */
export function messageOf(err: ErrorObject): string {
  const params = err.params as { additionalProperty?: string };
  const base = err.message ?? "is invalid";
  if (err.keyword === "additionalProperties" && typeof params.additionalProperty === "string") {
    return `${base}: ${params.additionalProperty}`;
  }
  if (err.keyword === "enum") {
    const allowed = (err.params as { allowedValues?: unknown[] }).allowedValues;
    if (Array.isArray(allowed)) return `${base}: ${allowed.map(String).join(", ")}`;
  }
  return base;
}

function errorPath(pointer: string, filePath?: string): string {
  if (filePath === undefined) return pointer;
  return `${filePath}#${pointer}`;
}

/** Result of a structural validation. */
export type ValidationResult =
  | { ok: true; schema: SchemaRef }
  | { ok: false; errors: CliError[] };

/** Deduplicates `(path, message)` pairs, keeping the first occurrence. */
export function dedupeErrors(errors: CliError[]): CliError[] {
  const seen = new Set<string>();
  const out: CliError[] = [];
  for (const e of errors) {
    const k = `${e.code}\u0000${e.path ?? ""}\u0000${e.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/**
 * Validates one parsed JSON document against the schema named by its own
 * `$schema` field (REQ-KRN-001, SCN-KRN-001…003).
 */
export function validateDocument(json: Json, filePath?: string): ValidationResult {
  const schemas = loadAll();
  const uri = isPlainObject(json) ? json["$schema"] : undefined;
  const ref = parseSchemaUri(uri);
  const entry = ref === null ? undefined : schemas.get(key(ref.name, ref.major));

  if (entry === undefined) {
    const shown = typeof uri === "string" ? uri : "(absent)";
    const error: CliError =
      filePath === undefined
        ? { code: "SCHEMA_UNKNOWN", message: `unknown document schema ${shown}` }
        : { code: "SCHEMA_UNKNOWN", message: `unknown document schema ${shown}`, path: filePath };
    return { ok: false, errors: [error] };
  }

  const valid = entry.validate(json);
  if (valid) return { ok: true, schema: { ...entry.ref } };

  const raw = entry.validate.errors ?? [];
  const errors: CliError[] = raw.map((err) => ({
    code: "SCHEMA_VIOLATION" as const,
    message: messageOf(err),
    path: errorPath(pointerOf(err), filePath)
  }));
  return { ok: false, errors: dedupeErrors(errors) };
}
