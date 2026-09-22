import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { canonicalText, formatJson, schemaFor, writeJsonFile } from "../../../src/core/canon/format-json.js";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "warrant-canon-"));
  dirs.push(dir);
  return dir;
}

describe("formatJson", () => {
  it("indents with two spaces and ends with exactly one LF", () => {
    const text = formatJson({ a: 1, b: { c: 2 } });
    expect(text).toBe('{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}\n');
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("never emits CR", () => {
    expect(formatJson({ a: "line" })).not.toContain("\r");
  });
});

describe("canonicalText", () => {
  it("reports a known schema and orders by it", () => {
    const result = canonicalText({
      packs: {},
      openspec: "1.13.x",
      kernel: "0.1",
      $schema: "warrant://config/1"
    });
    expect(result.schemaKnown).toBe(true);
    expect(result.text).toBe(
      '{\n  "$schema": "warrant://config/1",\n  "kernel": "0.1",\n  "openspec": "1.13.x",\n  "packs": {}\n}\n'
    );
  });

  it("reports an unknown schema and falls back to alphabetical order", () => {
    expect(canonicalText({ b: 1, a: 2 }).schemaKnown).toBe(false);
    expect(canonicalText({ $schema: "warrant://nope/1", b: 1, a: 2 }).schemaKnown).toBe(false);
    expect(canonicalText({ b: 1, a: 2 }).text).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
  });

  it("is byte-identical for two orderings of the same document", () => {
    const a = { $schema: "warrant://config/1", kernel: "0.1", openspec: "1.13.x", packs: { x: { version: "^1" } } };
    const b = { packs: { x: { version: "^1" } }, openspec: "1.13.x", kernel: "0.1", $schema: "warrant://config/1" };
    expect(canonicalText(a).text).toBe(canonicalText(b).text);
  });
});

describe("schemaFor", () => {
  it("returns undefined for values that declare no known schema", () => {
    expect(schemaFor(42)).toBeUndefined();
    expect(schemaFor([1, 2])).toBeUndefined();
    expect(schemaFor({})).toBeUndefined();
    // `common` is not a document schema, so it is not usable as `$schema`.
    expect(schemaFor({ $schema: "warrant://common/1" })).toBeUndefined();
    expect(schemaFor({ $schema: "warrant://config/1" })).toBeDefined();
  });
});

describe("writeJsonFile", () => {
  it("writes canonical UTF-8 without a BOM", () => {
    const file = path.join(tempDir(), "out.json");
    writeJsonFile(file, { packs: {}, openspec: "1.13.x", kernel: "0.1", $schema: "warrant://config/1" });
    const bytes = readFileSync(file);
    expect(bytes[0]).toBe(0x7b); // "{", not a BOM
    expect(bytes.toString("utf8")).toBe(
      '{\n  "$schema": "warrant://config/1",\n  "kernel": "0.1",\n  "openspec": "1.13.x",\n  "packs": {}\n}\n'
    );
  });
});
