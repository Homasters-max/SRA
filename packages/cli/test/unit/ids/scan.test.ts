import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { checkAreas, checkDuplicates, loadAreas, originOf, scanIds, scanMalformed, scanMarkdown } from "../../../src/core/ids/scan.js";
import { highestNumber } from "../../../src/core/ids/allocate.js";
import { makeTempDir, removeDir } from "../../helpers/cli.js";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

function write(root: string, rel: string, text: string): void {
  const absolute = path.join(root, rel);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, text);
}

const SPEC = [
  "## ADDED Requirements",
  "",
  "### Requirement: Something",
  "<!-- id: REQ-KRN-001 -->",
  "",
  "The system SHALL do something.",
  "",
  "#### Scenario: Happy path",
  "<!-- id: SCN-KRN-001 -->",
  "- **WHEN** a",
  "- **THEN** b",
  ""
].join("\n");

describe("scanMarkdown", () => {
  it("finds every id with its prefix, area, number and line", () => {
    const found = scanMarkdown(SPEC, "openspec/specs/kernel/spec.md");
    expect(found.map((f) => f.id)).toEqual(["REQ-KRN-001", "SCN-KRN-001"]);
    expect(found[0]).toMatchObject({ prefix: "REQ", area: "KRN", nnn: 1, line: 4 });
    expect(found[1]?.line).toBe(9);
  });

  it("ignores an id comment quoted in inline code (I-44)", () => {
    const text = "- **WHEN** comment `<!-- id: REQ-KRN-099 -->` stands above the heading\n<!-- id: REQ-KRN-002 -->\n";
    expect(scanMarkdown(text, "f.md").map((f) => f.id)).toEqual(["REQ-KRN-002"]);
    expect(scanMarkdown(text, "f.md")[0]?.line).toBe(2);
    expect(scanMalformed("see `<!-- id: bad -->` in prose", "f.md")).toEqual([]);
  });

  it("ignores comments that are not id comments", () => {
    expect(scanMarkdown("<!-- a note -->\n<!-- idea: x -->", "f.md")).toEqual([]);
  });
});

describe("scanMalformed", () => {
  it("reports an id comment whose payload is not PREFIX-AREA-NNN", () => {
    const errors = scanMalformed("<!-- id: REQ-KRN-1 -->\n<!-- id: BAD-KRN-001 -->", "f.md");
    expect(errors.map((e) => e.code)).toEqual(["ID_FORMAT", "ID_FORMAT"]);
    expect(errors[0]?.message).toContain("REQ-KRN-1");
  });

  it("accepts a well-formed comment", () => {
    expect(scanMalformed("<!-- id: REQ-KRN-001 -->", "f.md")).toEqual([]);
  });
});

describe("checkAreas", () => {
  it("reports AREA_UNKNOWN for an area outside the registry (SCN-KRN-047)", () => {
    const ids = scanMarkdown("<!-- id: REQ-ZZZ-001 -->", "openspec/specs/x/spec.md");
    const errors = checkAreas(ids, new Set(["KRN"]));
    expect(errors.map((e) => e.code)).toEqual(["AREA_UNKNOWN"]);
    expect(errors[0]?.message).toContain("ZZZ");
  });

  it("accepts a declared area", () => {
    expect(checkAreas(scanMarkdown(SPEC, "f.md"), new Set(["KRN"]))).toEqual([]);
  });
});

describe("checkDuplicates", () => {
  it("names both locations of a duplicated id", () => {
    const ids = [...scanMarkdown(SPEC, "a.md"), ...scanMarkdown(SPEC, "b.md")];
    const errors = checkDuplicates(ids);
    expect(errors.map((e) => e.code)).toEqual(["ID_DUPLICATE", "ID_DUPLICATE"]);
    expect(errors[0]?.message).toContain("a.md:4");
    expect(errors[0]?.message).toContain("b.md:4");
    expect(errors[0]?.path).toBe("b.md");
  });
});

describe("origins (B6)", () => {
  it("labels specs, active changes and archive directories", () => {
    expect(originOf("openspec/specs/kernel/spec.md")).toEqual({ origin: "specs", archiveDir: null });
    expect(originOf("openspec/changes/x/specs/kernel/spec.md")).toEqual({ origin: "changes", archiveDir: null });
    expect(originOf("openspec/changes/archive/2026-01-01-x/specs/kernel/spec.md")).toEqual({
      origin: "archive",
      archiveDir: "openspec/changes/archive/2026-01-01-x"
    });
  });

  it("does not report specs x archive as a duplicate", () => {
    const ids = [
      ...scanMarkdown(SPEC, "openspec/specs/kernel/spec.md"),
      ...scanMarkdown(SPEC, "openspec/changes/archive/2026-01-01-x/specs/kernel/spec.md")
    ];
    expect(checkDuplicates(ids)).toEqual([]);
  });

  it("does not report a MODIFIED delta of an active change against the main spec (I-46)", () => {
    const ids = [
      ...scanMarkdown(SPEC, "openspec/specs/kernel/spec.md"),
      ...scanMarkdown(SPEC, "openspec/changes/x/specs/kernel/spec.md")
    ];
    expect(checkDuplicates(ids)).toEqual([]);
  });

  it("does not report archive x archive across different archive directories", () => {
    const ids = [
      ...scanMarkdown(SPEC, "openspec/changes/archive/2026-01-01-x/specs/kernel/spec.md"),
      ...scanMarkdown(SPEC, "openspec/changes/archive/2026-02-02-y/specs/kernel/spec.md")
    ];
    expect(checkDuplicates(ids)).toEqual([]);
  });

  it("reports the same id declared in two active changes", () => {
    const ids = [
      ...scanMarkdown(SPEC, "openspec/changes/a/specs/kernel/spec.md"),
      ...scanMarkdown(SPEC, "openspec/changes/b/specs/kernel/spec.md")
    ];
    expect(checkDuplicates(ids).map((e) => e.code)).toEqual(["ID_DUPLICATE", "ID_DUPLICATE"]);
  });

  it("reports the same id declared twice inside one archive directory", () => {
    const ids = [
      ...scanMarkdown(SPEC, "openspec/changes/archive/2026-01-01-x/specs/kernel/spec.md"),
      ...scanMarkdown(SPEC, "openspec/changes/archive/2026-01-01-x/design.md")
    ];
    const errors = checkDuplicates(ids);
    expect(errors.map((e) => e.code)).toEqual(["ID_DUPLICATE", "ID_DUPLICATE"]);
    expect(errors[0]?.message).toContain("openspec/changes/archive/2026-01-01-x/design.md");
  });

  it("counts archive in the highest number used by `warrant id`", () => {
    const root = makeTempDir("warrant-ids-b6-");
    tempDirs.push(root);
    write(root, ".warrant/local/areas.json", JSON.stringify({ $schema: "warrant://areas/1", KRN: { capability: "kernel" } }));
    write(root, "openspec/specs/kernel/spec.md", ["<!-- id: REQ-KRN-001 -->", "text", ""].join("\n"));
    write(
      root,
      "openspec/changes/archive/2026-01-01-x/specs/kernel/spec.md",
      ["<!-- id: REQ-KRN-017 -->", "text", ""].join("\n")
    );
    expect(checkDuplicates(scanIds(root).ids)).toEqual([]);
    expect(highestNumber(root, "REQ", "KRN")).toBe(17);
  });
});

describe("scanIds", () => {
  it("covers specs, changes, archive and the unknowns/assumptions of change records", () => {
    const root = makeTempDir("warrant-ids-");
    tempDirs.push(root);
    write(root, "openspec/specs/kernel/spec.md", SPEC);
    write(root, "openspec/changes/x/specs/kernel/spec.md", "<!-- id: REQ-KRN-002 -->\ntext\n");
    write(root, "openspec/changes/archive/2026-01-01-y/specs/kernel/spec.md", "<!-- id: REQ-KRN-003 -->\ntext\n");
    write(
      root,
      ".warrant/changes/x.json",
      JSON.stringify({
        $schema: "warrant://change-record/1",
        change: "x",
        change_state: "PROPOSED",
        unknowns: [{ id: "UNK-KRN-001", text: "?", blocking: true }],
        assumptions: [{ id: "ASM-KRN-001", text: "!" }]
      })
    );
    write(root, ".warrant/local/areas.json", JSON.stringify({ $schema: "warrant://areas/1", KRN: { capability: "kernel" } }));

    const result = scanIds(root);
    expect(result.ids.map((f) => f.id).sort()).toEqual([
      "ASM-KRN-001",
      "REQ-KRN-001",
      "REQ-KRN-002",
      "REQ-KRN-003",
      "SCN-KRN-001",
      "UNK-KRN-001"
    ]);
    expect(result.malformed).toEqual([]);
    expect(loadAreas(root)).toEqual(new Set(["KRN"]));
  });

  it("reports a malformed id inside a change record", () => {
    const root = makeTempDir("warrant-ids-bad-");
    tempDirs.push(root);
    write(
      root,
      ".warrant/changes/x.json",
      JSON.stringify({ change: "x", unknowns: [{ id: "UNK-1", text: "?" }] })
    );
    const result = scanIds(root);
    expect(result.malformed.map((e) => e.code)).toEqual(["ID_FORMAT"]);
    expect(result.malformed[0]?.path).toBe(".warrant/changes/x.json#/unknowns/0/id");
  });
});
