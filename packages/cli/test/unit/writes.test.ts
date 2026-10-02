/**
 * `restoringWrites` (REQ-VER-017, design D1 of ci-local): the writer of
 * `warrant ci --no-record` performs every write and puts each target back as
 * it was before its first write — a created one removed with the directories
 * made for it, a changed file or directory restored byte for byte, the latest
 * first; once.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { restoringWrites } from "../../src/core/writes.js";

function project(): string {
  return mkdtempSync(path.join(tmpdir(), "warrant-writes-"));
}

describe("restoringWrites (REQ-VER-017)", () => {
  it("a new file with new directories, a changed file and a rewritten directory come back as they were", () => {
    const root = project();
    const at = (rel: string): string => path.join(root, ...rel.split("/"));
    mkdirSync(at("ev/raw"), { recursive: true });
    writeFileSync(at("ev/manifest.json"), "before\n");
    writeFileSync(at("ev/raw/out.txt"), "old output\n");
    const writes = restoringWrites((target) => at(target), writeFileSync);

    writes.write("ev/new/EVID-1.json", () => {
      mkdirSync(at("ev/new"), { recursive: true });
      writeFileSync(at("ev/new/EVID-1.json"), "record\n");
    });
    writes.write("ev/raw", () => {
      rmSync(at("ev/raw"), { recursive: true, force: true });
      mkdirSync(at("ev/raw"));
      writeFileSync(at("ev/raw/junit.xml"), "<x/>\n");
    });
    writes.write("ev/manifest.json", () => writeFileSync(at("ev/manifest.json"), "first\n"));
    // A second write of a target keeps the state before the first.
    writes.write("ev/manifest.json", () => writeFileSync(at("ev/manifest.json"), "second\n"));
    expect(writes.dryRun).toBe(false);
    expect(writes.collected()).toEqual([]);

    expect(writes.restore()).toEqual([]);
    expect(existsSync(at("ev/new"))).toBe(false);
    expect(readFileSync(at("ev/manifest.json"), "utf8")).toBe("before\n");
    expect(readdirSync(at("ev/raw"))).toEqual(["out.txt"]);
    expect(readFileSync(at("ev/raw/out.txt"), "utf8")).toBe("old output\n");
    // Once: a second call puts nothing back again.
    writeFileSync(at("ev/manifest.json"), "later\n");
    expect(writes.restore()).toEqual([]);
    expect(readFileSync(at("ev/manifest.json"), "utf8")).toBe("later\n");
  });

  it("a target it cannot put back is named, the others are restored", () => {
    const root = project();
    const writes = restoringWrites((target) => (target === "bad" ? path.join(root, "bad", "\0") : path.join(root, target)), writeFileSync);
    writes.write("a.txt", () => writeFileSync(path.join(root, "a.txt"), "x"));
    writes.write("bad", () => undefined);
    expect(writes.restore()).toEqual(["bad"]);
    expect(existsSync(path.join(root, "a.txt"))).toBe(false);
  });

  it("a state it cannot keep stops before that write — INTERNAL with the target; what was written is put back", () => {
    const root = project();
    writeFileSync(path.join(root, "a.txt"), "before");
    const writes = restoringWrites((target) => {
      if (target === "unkept") throw new Error("no such place");
      return path.join(root, target);
    }, writeFileSync);
    writes.write("a.txt", () => writeFileSync(path.join(root, "a.txt"), "after"));
    let performed = false;
    expect(() => writes.write("unkept", () => (performed = true))).toThrow(expect.objectContaining({ code: "INTERNAL", path: "unkept" }));
    expect(performed).toBe(false);
    expect(writes.restore()).toEqual([]);
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("before");
  });
});
