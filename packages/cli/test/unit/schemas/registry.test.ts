import { describe, expect, it } from "vitest";

import {
  ALL_SCHEMAS,
  DOCUMENT_SCHEMAS,
  KERNEL_MAJOR,
  isDocumentSchema,
  parseSchemaUri,
  schemaFileName
} from "../../../src/core/schemas/registry.js";
import {
  listSchemaFiles,
  listSchemas,
  readSchemaFile,
  getSchema,
  validateDocument
} from "../../../src/core/schemas/loader.js";

describe("schema registry", () => {
  it("ships exactly the files the registry declares", () => {
    const expected = ALL_SCHEMAS.map((n) => schemaFileName(n, KERNEL_MAJOR)).sort();
    expect(listSchemaFiles()).toEqual(expected);
  });

  it("compiles every shipped schema (SCN-KRN-001)", () => {
    expect(listSchemas().map((s) => s.name).sort()).toEqual([...DOCUMENT_SCHEMAS].sort());
  });

  it("declares $id equal to warrant://<name>/<major> in every file", () => {
    for (const name of ALL_SCHEMAS) {
      const raw = readSchemaFile(name, KERNEL_MAJOR);
      expect(raw["$id"]).toBe(`warrant://${name}/${KERNEL_MAJOR}`);
      expect(raw["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(typeof raw["title"]).toBe("string");
      expect(String(raw["description"]).length).toBeGreaterThan(0);
    }
  });

  it("parses and rejects schema URIs", () => {
    expect(parseSchemaUri("warrant://config/1")).toEqual({ name: "config", major: 1 });
    expect(parseSchemaUri("warrant://change-record/1")).toEqual({ name: "change-record", major: 1 });
    expect(parseSchemaUri("http://example.com/x.json")).toBeNull();
    expect(parseSchemaUri(undefined)).toBeNull();
    expect(isDocumentSchema("warrant://config/1")).toBe(true);
    expect(isDocumentSchema("warrant://common/1")).toBe(false);
    expect(isDocumentSchema("warrant://config/2")).toBe(false);
  });

  it("does not expose common as a document schema (SCN-KRN-002)", () => {
    const result = validateDocument({ $schema: "warrant://common/1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("SCHEMA_UNKNOWN");
    expect(result.errors[0]?.message).toContain("warrant://common/1");
  });

  it("reports SCHEMA_UNKNOWN for an unknown or absent $schema (SCN-KRN-002)", () => {
    const unknown = validateDocument({ $schema: "warrant://unknown/1" }, "a/b.json");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.errors).toEqual([
        { code: "SCHEMA_UNKNOWN", message: expect.stringContaining("warrant://unknown/1"), path: "a/b.json" }
      ]);
    }

    const absent = validateDocument({ kernel: "0.1" }, "a/b.json");
    expect(absent.ok).toBe(false);
    if (!absent.ok) {
      expect(absent.errors[0]?.code).toBe("SCHEMA_UNKNOWN");
      expect(absent.errors[0]?.message).toContain("(absent)");
    }
  });

  it("accepts $comment at any level and rejects other unknown keys (SCN-KRN-003)", () => {
    const base = {
      $schema: "warrant://config/1",
      $comment: "top level note",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { "core-sdd": { $comment: "nested note", version: "^0.1" } }
    };
    expect(validateDocument(base).ok).toBe(true);

    const bad = {
      ...base,
      packs: { "core-sdd": { version: "^0.1", note: "not allowed" } }
    };
    const result = validateDocument(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const hit = result.errors.find((e) => e.path === "/packs/core-sdd");
    expect(hit).toBeDefined();
    expect(hit?.code).toBe("SCHEMA_VIOLATION");
    expect(hit?.message).toContain("note");
  });

  it("returns the raw schema without the injected $comment (fmt uses it)", () => {
    const raw = getSchema("config");
    expect(raw).toBeDefined();
    const props = raw?.["properties"] as Record<string, unknown>;
    expect(Object.keys(props)).not.toContain("$comment");
  });
});
