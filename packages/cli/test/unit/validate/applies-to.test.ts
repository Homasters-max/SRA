/**
 * `appliesTo` of the registry of `validate` (A-9, design §3): which `file`
 * checks read a project path under `validate --files` (REQ-KRN-032); a
 * `project` check reads none.
 */
import { describe, expect, it } from "vitest";

import type { WarrantConfig } from "../../../src/core/config.js";
import { VALIDATE_CHECKS } from "../../../src/core/validate/registry.js";

function config(tests?: string): WarrantConfig {
  return {
    kernel: "0.5",
    openspec: "1.13.x",
    packs: [],
    defaults: { checkTimeoutS: undefined },
    paths: tests === undefined ? {} : { tests },
    roles: new Map(),
    frontends: []
  };
}

/** Ids of the checks whose `appliesTo` accepts `file`, in registry order. */
function accepting(file: string, cfg: WarrantConfig = config()): string[] {
  return VALIDATE_CHECKS.filter((check) => check.appliesTo(file, cfg)).map((check) => check.id);
}

describe("validate registry: appliesTo", () => {
  it("project checks accept no path", () => {
    const project = VALIDATE_CHECKS.filter((check) => check.level === "project");
    expect(project.map((check) => check.id)).toEqual(["lock", "generated", "rules", "links", "waivers", "evidence"]);
    for (const file of [".warrant/warrant.lock.json", ".warrant/warrant.json", "openspec/config.yaml", "packs/core-sdd/pack.json"]) {
      expect(project.filter((check) => check.appliesTo(file, config()))).toEqual([]);
    }
  });

  it.each([
    [".warrant/local/areas.json", ["packs", "schema", "secrets", "canonical"]],
    [".warrant/warrant.json", ["packs", "schema", "secrets", "canonical"]],
    [".warrant/warrant.lock.json", ["secrets", "canonical"]],
    [".warrant/schemas/config.1.schema.json", ["secrets"]],
    [".warrant/evidence/add-search/raw/unit/report.json", []],
    [".claude/settings.json", ["secrets"]],
    ["packs/core-sdd/pack.json", ["packs"]],
    ["openspec/specs/search/spec.md", ["ids", "ids-immutable"]],
    ["openspec/changes/add-search/specs/search/spec.md", ["ids", "ids-immutable"]],
    ["openspec/changes/add-search/tasks.md", ["ids", "ids-immutable", "dangling"]],
    ["openspec/changes/archive/2026-09-01-old/specs/search/spec.md", ["ids"]],
    ["openspec/changes/archive/2026-09-01-old/tasks.md", ["ids"]],
    ["openspec/config.yaml", []],
    ["docs/notes.md", []],
    ["tests/search.test.ts", []]
  ])("%s → %j", (file, expected) => {
    expect(accepting(file)).toEqual(expected);
  });

  it("dangling reads the files under paths.tests only when it is set", () => {
    expect(accepting("tests/search.test.ts", config("tests"))).toEqual(["dangling"]);
    expect(accepting("tests", config("tests/"))).toEqual(["dangling"]);
    expect(accepting("tests-old/a.ts", config("tests"))).toEqual([]);
  });
});
