import { describe, expect, it } from "vitest";

import { ALL_SCHEMAS, KERNEL_MAJOR } from "../../../src/core/schemas/registry.js";
import { readSchemaFile } from "../../../src/core/schemas/loader.js";

interface JsonObject {
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Collects `<schema>: <json pointer>` for every rule the walk finds broken. */
function auditSchema(node: unknown, pointer: string, problems: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => auditSchema(child, `${pointer}/${i}`, problems));
    return;
  }
  if (!isPlainObject(node)) return;

  // Every object schema must be closed or carry an explicit value schema.
  if (node["type"] === "object" && !("additionalProperties" in node)) {
    problems.push(`${pointer}: object schema without additionalProperties`);
  }

  const props = node["properties"];
  if (isPlainObject(props)) {
    for (const [name, sub] of Object.entries(props)) {
      const at = `${pointer}/properties/${name}`;
      const description = isPlainObject(sub) ? sub["description"] : undefined;
      if (typeof description !== "string" || description.trim() === "") {
        problems.push(`${at}: missing description`);
      }
      auditSchema(sub, at, problems);
    }
  }

  for (const key of ["$defs", "definitions", "patternProperties"] as const) {
    const sub = node[key];
    if (isPlainObject(sub)) {
      for (const [name, child] of Object.entries(sub)) {
        auditSchema(child, `${pointer}/${key}/${name}`, problems);
      }
    }
  }
  for (const key of ["items", "additionalProperties", "contains", "not", "propertyNames"] as const) {
    if (key in node) auditSchema(node[key], `${pointer}/${key}`, problems);
  }
  for (const key of ["oneOf", "anyOf", "allOf", "prefixItems"] as const) {
    const sub = node[key];
    if (Array.isArray(sub)) sub.forEach((child, i) => auditSchema(child, `${pointer}/${key}/${i}`, problems));
  }
}

describe("schema descriptions (task 2.8)", () => {
  for (const name of ALL_SCHEMAS) {
    it(`${name}: every property is described and every object is closed`, () => {
      const problems: string[] = [];
      auditSchema(readSchemaFile(name, KERNEL_MAJOR), "", problems);
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }

  it("describes every $defs entry of common", () => {
    const common = readSchemaFile("common", KERNEL_MAJOR);
    const defs = common["$defs"] as JsonObject;
    for (const [name, def] of Object.entries(defs)) {
      const description = isPlainObject(def) ? def["description"] : undefined;
      expect(typeof description, `common.$defs.${name}`).toBe("string");
      expect(String(description).trim().length, `common.$defs.${name}`).toBeGreaterThan(0);
    }
  });
});
