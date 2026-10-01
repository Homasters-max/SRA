import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { loadConfig } from "../../../src/core/config.js";
import { exitCodeFor, type WarrantError } from "../../../src/core/errors.js";
import { idOccurrenceRe, renumber } from "../../../src/core/ids/renumber.js";
import { makeTempDir, removeDir } from "../../helpers/cli.js";
import { write } from "../../helpers/synced.js";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

function read(root: string, rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function project(state = "SPECIFIED"): string {
  const root = makeTempDir("warrant-renum-");
  tempDirs.push(root);
  write(root, ".warrant/warrant.json", {
    $schema: "warrant://config/1",
    kernel: "0.1",
    openspec: "1.13.x",
    packs: {},
    paths: { tests: "tests" }
  });
  write(root, ".warrant/local/areas.json", { $schema: "warrant://areas/1", KRN: { capability: "kernel" } });
  write(root, ".warrant/changes/add-search.json", {
    $schema: "warrant://change-record/1",
    change: "add-search",
    change_state: state
  });
  return root;
}

function caught(fn: () => unknown): WarrantError {
  try {
    fn();
  } catch (thrown) {
    return thrown as WarrantError;
  }
  throw new Error("expected a WarrantError");
}

describe("idOccurrenceRe", () => {
  it("matches only whole ids", () => {
    const re = idOccurrenceRe("REQ-KRN-007");
    expect("REQ-KRN-007".replace(re, "X")).toBe("X");
    expect("REQ-KRN-0071 XREQ-KRN-007 AREQ-KRN-007B".replace(re, "X")).toBe(
      "REQ-KRN-0071 XREQ-KRN-007 AREQ-KRN-007B"
    );
    expect("see (REQ-KRN-007).".replace(re, "X")).toBe("see (X).");
  });
});

describe("renumber", () => {
  it("rewrites inside the change and the test root, leaving everything else alone (SCN-KRN-059)", () => {
    const root = project();
    write(root, "openspec/changes/add-search/specs/kernel/spec.md", "<!-- id: REQ-KRN-007 -->\nREQ-KRN-0071 stays.\n");
    write(root, "openspec/changes/add-search/tasks.md", "- REQ-KRN-007 done\n");
    write(root, "tests/search.test.ts", "// covers REQ-KRN-007\n");
    write(root, "openspec/specs/kernel/spec.md", "<!-- id: REQ-KRN-007 -->\n");
    write(root, "docs/other.md", "REQ-KRN-007 elsewhere\n");

    const result = renumber(root, loadConfig(root), "REQ-KRN-007", "REQ-KRN-013", "add-search");

    expect(result.rewritten).toEqual([
      "openspec/changes/add-search/specs/kernel/spec.md",
      "openspec/changes/add-search/tasks.md",
      "tests/search.test.ts"
    ]);
    expect(read(root, "openspec/changes/add-search/specs/kernel/spec.md")).toBe(
      "<!-- id: REQ-KRN-013 -->\nREQ-KRN-0071 stays.\n"
    );
    expect(read(root, "tests/search.test.ts")).toBe("// covers REQ-KRN-013\n");
    // Outside the change directory and the test root nothing moves.
    expect(read(root, "openspec/specs/kernel/spec.md")).toBe("<!-- id: REQ-KRN-007 -->\n");
    expect(read(root, "docs/other.md")).toBe("REQ-KRN-007 elsewhere\n");
  });

  it("rewrites unknown/assumption ids in the Change record", () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", {
      $schema: "warrant://change-record/1",
      change: "add-search",
      change_state: "SPECIFIED",
      unknowns: [{ id: "UNK-KRN-004", text: "q", blocking: false }]
    });
    const result = renumber(root, loadConfig(root), "UNK-KRN-004", "UNK-KRN-011", "add-search");
    expect(result.rewritten).toEqual([".warrant/changes/add-search.json"]);
    expect(read(root, ".warrant/changes/add-search.json")).toContain('"UNK-KRN-011"');
  });

  it("refuses when the Change is MERGED and touches no file (SCN-KRN-060)", () => {
    const root = project("MERGED");
    write(root, "openspec/changes/add-search/tasks.md", "REQ-KRN-007\n");
    const error = caught(() => renumber(root, loadConfig(root), "REQ-KRN-007", "REQ-KRN-013", "add-search"));
    expect(error.code).toBe("ID_IMMUTABLE");
    expect(exitCodeFor([error])).toBe(3);
    expect(read(root, "openspec/changes/add-search/tasks.md")).toBe("REQ-KRN-007\n");
  });

  it("refuses when the new id already exists anywhere in the project", () => {
    const root = project();
    write(root, "openspec/changes/add-search/tasks.md", "REQ-KRN-007\n");
    write(root, "openspec/specs/kernel/spec.md", "<!-- id: REQ-KRN-013 -->\n");
    const error = caught(() => renumber(root, loadConfig(root), "REQ-KRN-007", "REQ-KRN-013", "add-search"));
    expect(error.code).toBe("ID_TAKEN");
    expect(read(root, "openspec/changes/add-search/tasks.md")).toBe("REQ-KRN-007\n");
  });

  it("refuses an unknown Change and a malformed or cross-prefix id", () => {
    const root = project();
    expect(caught(() => renumber(root, loadConfig(root), "REQ-KRN-007", "REQ-KRN-013", "nope")).code).toBe("CHANGE_NOT_FOUND");
    expect(caught(() => renumber(root, loadConfig(root), "REQ-KRN-7", "REQ-KRN-013", "add-search")).code).toBe("ID_FORMAT");
    expect(caught(() => renumber(root, loadConfig(root), "REQ-KRN-007", "SCN-KRN-013", "add-search")).code).toBe("ID_FORMAT");
  });

  it("refuses with USAGE when the old id occurs nowhere in the change", () => {
    const root = project();
    write(root, "openspec/changes/add-search/tasks.md", "nothing here\n");
    expect(caught(() => renumber(root, loadConfig(root), "REQ-KRN-007", "REQ-KRN-013", "add-search")).code).toBe("USAGE");
  });
});
