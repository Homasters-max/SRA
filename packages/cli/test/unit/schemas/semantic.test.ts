import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runSemanticRules, validateFile } from "../../../src/core/schemas/semantic.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "schemas");

function fixture(schema: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, schema, file), "utf8")) as Record<string, unknown>;
}

describe("semantic rules (task 2.7)", () => {
  it("accepts an openspec-schema whose requires are all declared", () => {
    expect(runSemanticRules("openspec-schema", fixture("openspec-schema", "valid-warrant-sdd.json"))).toEqual([]);
  });

  it("reports ARTIFACT_UNKNOWN for an undeclared requires entry (SCN-KRN-037)", () => {
    const errors = runSemanticRules(
      "openspec-schema",
      fixture("openspec-schema", "invalid-unknown-requires.json")
    );
    expect(errors).toEqual([
      { code: "ARTIFACT_UNKNOWN", message: expect.stringContaining("adr"), path: "/artifacts/1/requires/0" }
    ]);
  });

  it("reports ARTIFACT_UNKNOWN for an undeclared apply.requires entry", () => {
    const json = fixture("openspec-schema", "valid-warrant-sdd.json");
    json["apply"] = { requires: ["tasks", "release-notes"], tracks: "tasks.md" };
    const errors = runSemanticRules("openspec-schema", json);
    expect(errors).toEqual([
      { code: "ARTIFACT_UNKNOWN", message: expect.stringContaining("release-notes"), path: "/apply/requires/1" }
    ]);
  });

  it("accepts a change record whose `change` equals its file name", () => {
    const json = fixture("change-record", "valid-doc-example.json");
    const result = validateFile(json, "/repo/.warrant/changes/add-customer-search.json");
    expect(result.ok).toBe(true);
  });

  it("rejects a change record whose `change` differs from its file name", () => {
    const json = fixture("change-record", "valid-doc-example.json");
    const result = validateFile(json, "/repo/.warrant/changes/other-change.json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe("SCHEMA_VIOLATION");
    expect(result.errors[0]?.path).toBe("/repo/.warrant/changes/other-change.json#/change");
    expect(result.errors[0]?.message).toContain("other-change");
  });

  it("does not run semantic rules for schemas that have none", () => {
    expect(runSemanticRules("gate", fixture("gate", "valid-tests-passed.json"))).toEqual([]);
  });

  it("reports structural errors before semantic ones", () => {
    const result = validateFile({ $schema: "warrant://openspec-schema/1" }, "schema.json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.every((e) => e.code === "SCHEMA_VIOLATION")).toBe(true);
  });
});
