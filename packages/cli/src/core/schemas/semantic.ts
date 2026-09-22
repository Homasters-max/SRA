/**
 * Checks that JSON Schema cannot express, run after structural validation
 * (design D-2): cross-references inside a document and agreement between a
 * document and its file name.
 */
import { basename } from "node:path";

import type { CliError } from "../errors.js";
import { dedupeErrors, validateDocument, type Json, type ValidationResult } from "./loader.js";

interface JsonObject {
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withPath(code: CliError["code"], message: string, path: string): CliError {
  return { code, message, path };
}

/** `openspec-schema`: every `requires` entry names an artifact of the same file (SCN-KRN-037). */
function openspecSchemaRules(json: JsonObject): CliError[] {
  const errors: CliError[] = [];
  const artifacts = json["artifacts"];
  if (!Array.isArray(artifacts)) return errors;

  const declared = new Set<string>();
  for (const artifact of artifacts) {
    if (isPlainObject(artifact) && typeof artifact["id"] === "string") declared.add(artifact["id"]);
  }

  artifacts.forEach((artifact, i) => {
    if (!isPlainObject(artifact)) return;
    const requires = artifact["requires"];
    if (!Array.isArray(requires)) return;
    requires.forEach((req, j) => {
      if (typeof req === "string" && !declared.has(req)) {
        errors.push(
          withPath(
            "ARTIFACT_UNKNOWN",
            `requires references artifact "${req}", which this schema does not declare`,
            `/artifacts/${i}/requires/${j}`
          )
        );
      }
    });
  });

  const apply = json["apply"];
  if (isPlainObject(apply) && Array.isArray(apply["requires"])) {
    apply["requires"].forEach((req, j) => {
      if (typeof req === "string" && !declared.has(req)) {
        errors.push(
          withPath(
            "ARTIFACT_UNKNOWN",
            `apply.requires references artifact "${req}", which this schema does not declare`,
            `/apply/requires/${j}`
          )
        );
      }
    });
  }

  return errors;
}

/** `change-record`: `change` equals the file name without `.json` (REQ-KRN-011). */
function changeRecordRules(json: JsonObject, filePath?: string): CliError[] {
  if (filePath === undefined) return [];
  const expected = basename(filePath).replace(/\.json$/i, "");
  const actual = json["change"];
  if (typeof actual !== "string" || actual === expected) return [];
  return [
    withPath(
      "SCHEMA_VIOLATION",
      `change must equal the record file name without ".json" (expected "${expected}", found "${actual}")`,
      "/change"
    )
  ];
}

/** Schemas of policy objects whose `id` must equal the file base name (design Decision 1). */
const ID_IS_BASENAME: ReadonlySet<string> = new Set([
  "profile",
  "overlay",
  "gate",
  "check",
  "risk-levels",
  "rule"
]);

/**
 * The rule applies to the object catalogues WARRANT owns — a pack directory or
 * the project layer — and not to arbitrary JSON a project keeps elsewhere
 * (schema fixtures, examples in documentation).
 */
function inObjectCatalogue(filePath: string): boolean {
  const p = filePath.split("\\").join("/");
  return /(^|\/)packs\//.test(p) || p.includes(".warrant/local/");
}

/**
 * `id` of a policy object equals the base name of its file (design Decision 1,
 * I-9): the file name is how `provides`, overrides and diffs address the
 * object, so the two names may not drift apart.
 */
function idIsBasenameRule(json: JsonObject, filePath?: string): CliError[] {
  if (filePath === undefined || !inObjectCatalogue(filePath)) return [];
  const id = json["id"];
  if (typeof id !== "string") return [];
  const expected = basename(filePath).replace(/\.json$/i, "");
  if (id === expected) return [];
  return [
    withPath(
      "SEMANTIC_INVALID",
      `id must equal the file base name (expected "${expected}", found "${id}")`,
      "/id"
    )
  ];
}

/**
 * Runs the named semantic rules for one schema. Returns an empty array when the
 * schema has no semantic rules.
 */
export function runSemanticRules(schemaName: string, json: Json, filePath?: string): CliError[] {
  if (!isPlainObject(json)) return [];
  if (ID_IS_BASENAME.has(schemaName)) return idIsBasenameRule(json, filePath);
  switch (schemaName) {
    case "openspec-schema":
      return openspecSchemaRules(json);
    case "change-record":
      return changeRecordRules(json, filePath);
    default:
      return [];
  }
}

/** Structural validation followed by the semantic rules of the matched schema. */
export function validateFile(json: Json, filePath?: string): ValidationResult {
  const structural = validateDocument(json, filePath);
  if (!structural.ok) return structural;

  const semantic = runSemanticRules(structural.schema.name, json, filePath);
  if (semantic.length === 0) return structural;

  const errors = dedupeErrors(
    semantic.map((e) =>
      filePath === undefined || e.path === undefined
        ? e
        : { ...e, path: `${filePath}#${e.path}` }
    )
  );
  return { ok: false, errors };
}
