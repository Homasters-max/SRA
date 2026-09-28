import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  canonicalText,
  formatJson,
  RENAME_ATTEMPTS,
  schemaFor,
  writeFileAtomic,
  writeJsonFile
} from "../../../src/core/canon/format-json.js";
import { WarrantError } from "../../../src/core/errors.js";

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

describe("writeFileAtomic (REQ-KRN-036)", () => {
  const OLD = '{\n  "old": true\n}\n';
  const NEW = '{\n  "new": true\n}\n';

  /** A record `.warrant/changes/add-search.json` holding {@link OLD}. */
  function seeded(): { dir: string; file: string } {
    const dir = path.join(tempDir(), ".warrant", "changes");
    const file = path.join(dir, "add-search.json");
    writeFileAtomic(file, OLD);
    return { dir, file };
  }

  function failing(code: string): { rename: (from: string, to: string) => void; calls: () => number } {
    let calls = 0;
    return {
      rename: () => {
        calls += 1;
        throw Object.assign(new Error(`${code}: rename`), { code });
      },
      calls: () => calls
    };
  }

  it("writes over an existing file, creates the directory and leaves no temporary file", () => {
    const { dir, file } = seeded();
    writeFileAtomic(file, NEW);
    expect(readFileSync(file, "utf8")).toBe(NEW);
    expect(readdirSync(dir)).toEqual(["add-search.json"]);
  });

  it("writes bytes as they are", () => {
    const { dir, file } = seeded();
    writeFileAtomic(file, Buffer.from(NEW, "utf8"));
    expect(readFileSync(file, "utf8")).toBe(NEW);
    expect(readdirSync(dir)).toEqual(["add-search.json"]);
  });

  it("keeps the former file and removes the temporary one when the rename fails (SCN-KRN-158)", () => {
    const { dir, file } = seeded();
    const rename = failing("ENOSPC");
    expect(() => writeFileAtomic(file, NEW, { rename: rename.rename, platform: "win32" })).toThrow(/ENOSPC/);
    expect(rename.calls()).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(OLD);
    expect(readdirSync(dir)).toEqual(["add-search.json"]);
  });

  it("is BUSY with exit 2 after 5 renames refused with EBUSY on win32 (SCN-KRN-158)", () => {
    const { dir, file } = seeded();
    const rename = failing("EBUSY");
    let thrown: unknown;
    try {
      writeFileAtomic(file, NEW, { rename: rename.rename, platform: "win32" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WarrantError);
    const busy = thrown as WarrantError;
    expect([busy.code, busy.exitCode]).toEqual(["BUSY", 2]);
    expect(busy.hint).toContain("another process holds the file");
    expect(rename.calls()).toBe(RENAME_ATTEMPTS);
    expect(readFileSync(file, "utf8")).toBe(OLD);
    expect(readdirSync(dir)).toEqual(["add-search.json"]);
  });

  it("retries a held file on win32 and writes once the rename goes through", () => {
    const { dir, file } = seeded();
    let calls = 0;
    const rename = (from: string, to: string): void => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("EPERM: rename"), { code: "EPERM" });
      // The real rename, once the holder let go.
      writeFileSync(to, readFileSync(from));
      rmSync(from);
    };
    writeFileAtomic(file, NEW, { rename, platform: "win32" });
    expect(calls).toBe(3);
    expect(readFileSync(file, "utf8")).toBe(NEW);
    expect(readdirSync(dir)).toEqual(["add-search.json"]);
  });

  it("does not retry off win32: the error is thrown as it is", () => {
    const { file } = seeded();
    const rename = failing("EBUSY");
    expect(() => writeFileAtomic(file, NEW, { rename: rename.rename, platform: "linux" })).toThrow(/EBUSY: rename/);
    expect(rename.calls()).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(OLD);
  });

  it("writeJsonFile goes through it: no temporary file is left", () => {
    const { dir, file } = seeded();
    writeJsonFile(file, { new: true });
    expect(readFileSync(file, "utf8")).toBe(NEW);
    expect(readdirSync(dir)).toEqual(["add-search.json"]);
  });
});
