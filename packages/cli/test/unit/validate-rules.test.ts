/** Scope of path rules, check (8) of `validate` (ADR-0022 point 4, SCN-KRN-095). */
import { describe, expect, it } from "vitest";

import { checkRuleScope, globInsideChanges, rulesSummary } from "../../src/core/validate/rules.js";
import type { LoadedRule } from "../../src/core/packs/types.js";

function rule(id: string, paths: string[], enforcedBy?: string): LoadedRule {
  return { id, pack: "local", path: `.warrant/local/rules/${id}.json`, paths, text: `Rule ${id}.`, enforcedBy };
}

describe("globInsideChanges", () => {
  it("is true only for globs whose literal prefix is openspec/changes/", () => {
    expect(globInsideChanges("openspec/changes/**/*.md")).toBe(true);
    expect(globInsideChanges("./openspec/changes/archive/**")).toBe(true);
    expect(globInsideChanges("openspec/changes")).toBe(true);
    expect(globInsideChanges("**")).toBe(false);
    expect(globInsideChanges("openspec/**")).toBe(false);
    expect(globInsideChanges("openspec/changes-log.md")).toBe(false);
  });
});

describe("checkRuleScope", () => {
  it("reports a rule whose paths all lie inside openspec/changes/** (SCN-KRN-095)", () => {
    expect(checkRuleScope([rule("spec-style", ["openspec/changes/**/*.md"])])).toEqual([
      expect.objectContaining({ code: "RULE_SCOPE", path: ".warrant/local/rules/spec-style.json#/paths" })
    ]);
  });

  it("accepts a rule that reaches outside openspec/changes/** with at least one path", () => {
    expect(checkRuleScope([rule("a", ["**"]), rule("b", ["openspec/changes/**", "docs/**"])])).toEqual([]);
  });
});

describe("rulesSummary", () => {
  it("counts rules and those without enforced_by (SCN-KRN-104)", () => {
    expect(rulesSummary([rule("a", ["**"], "validate"), rule("b", ["**"]), rule("c", ["**"], "fmt --check")])).toEqual({
      total: 3,
      unenforced: 1
    });
  });
});
