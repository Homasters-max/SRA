import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  areasDocument,
  changeNameConflict,
  changeRecord,
  configDocument,
  isChangeName,
  openspecRange,
  rulesDocument,
  schemaFromConfigYaml
} from "../../src/core/init/scaffold.js";
import { validateDocument } from "../../src/core/schemas/loader.js";
import { makeTempDir, removeDir } from "../helpers/cli.js";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

describe("init scaffold helpers", () => {
  it("accepts kebab-case change names only", () => {
    for (const ok of ["add-search", "phase-1-kernel", "x", "a1-b2"]) expect(isChangeName(ok)).toBe(true);
    for (const bad of ["Add-Search", "add_search", "-add", "add-", "add--search", "add search", ""]) {
      expect(isChangeName(bad)).toBe(false);
    }
  });

  it("pins the openspec minor line and allows patch upgrades", () => {
    expect(openspecRange("1.13.1")).toBe("1.13.x");
    expect(openspecRange("0.9.0-beta.2")).toBe("0.9.x");
  });

  it("reads the schema name out of a generated config.yaml", () => {
    expect(schemaFromConfigYaml("# generated\nschema: warrant-sdd\ncontext: |\n  x\n")).toBe("warrant-sdd");
    expect(schemaFromConfigYaml('schema: "warrant-sdd"\n')).toBe("warrant-sdd");
    // A `schema:` key nested under another mapping is indented and must not match.
    expect(schemaFromConfigYaml("rules:\n  schema: nope\n")).toBeNull();
    expect(schemaFromConfigYaml("context: none\n")).toBeNull();
  });

  it("writes documents their own schemas accept", () => {
    const record = changeRecord("add-search", "2026-09-22T09:00:00Z");
    for (const doc of [configDocument("0.1", "1.13.1", "0.1.0"), areasDocument(), rulesDocument(), record]) {
      expect(validateDocument(doc)).toEqual({ ok: true, schema: { name: expect.any(String), major: 1 } });
    }
    expect(record["change_state"]).toBe("PROPOSED");
    expect(record["classification"]).toBeUndefined();
    expect(record["transitions"]).toEqual([{ to: "PROPOSED", at: "2026-09-22T09:00:00Z", by: "cli:local" }]);
  });

  it("finds a name taken by a record, an active change or the archive (ADR-0012 section 6)", () => {
    const root = makeTempDir("warrant-conflict-");
    tempDirs.push(root);
    expect(changeNameConflict(root, "add-search")).toBeNull();

    mkdirSync(path.join(root, "openspec", "changes", "archive", "2026-09-01-add-search"), { recursive: true });
    expect(changeNameConflict(root, "add-search")).toBe("openspec/changes/archive/2026-09-01-add-search");
    expect(changeNameConflict(root, "other")).toBeNull();
    // Only an exact name or a date-prefixed one counts: `search` is not `add-search`.
    expect(changeNameConflict(root, "search")).toBeNull();
    mkdirSync(path.join(root, "openspec", "changes", "archive", "moved-by-hand"), { recursive: true });
    expect(changeNameConflict(root, "moved-by-hand")).toBe("openspec/changes/archive/moved-by-hand");
    expect(changeNameConflict(root, "hand")).toBeNull();

    mkdirSync(path.join(root, "openspec", "changes", "other"), { recursive: true });
    expect(changeNameConflict(root, "other")).toBe("openspec/changes/other");

    mkdirSync(path.join(root, ".warrant", "changes"), { recursive: true });
    writeFileSync(path.join(root, ".warrant", "changes", "third.json"), "{}", "utf8");
    expect(changeNameConflict(root, "third")).toBe(".warrant/changes/third.json");
  });
});
