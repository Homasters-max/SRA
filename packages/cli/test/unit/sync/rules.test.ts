import { describe, expect, it } from "vitest";

import { mergeRules } from "../../../src/core/sync/rules.js";

describe("mergeRules (ADR-0015 point 2)", () => {
  it("keeps the pack order and drops exact duplicates (SCN-KRN-062)", () => {
    const merged = mergeRules([{ rules: { specs: ["A"] } }, { rules: { specs: ["B", "A"] } }]);
    expect(merged.rules?.specs).toEqual(["A", "B"]);
  });

  it("puts the project context after the pack context, separated by a blank line (SCN-KRN-062)", () => {
    const merged = mergeRules([{ context: "Pack line." }, { context: "Project line." }]);
    expect(merged.context).toBe("Pack line.\n\nProject line.");
  });

  it("ignores empty context layers instead of emitting blank paragraphs", () => {
    expect(mergeRules([{ context: "A" }, { context: "   " }, {}, { context: "B" }]).context).toBe("A\n\nB");
    expect(mergeRules([{}, {}]).context).toBeUndefined();
  });

  it("unions operations.<op>.guidance in order", () => {
    const merged = mergeRules([
      { operations: { apply: { guidance: ["one", "two"] } } },
      { operations: { apply: { guidance: ["two", "three"] }, archive: { guidance: ["four"] } } }
    ]);
    expect(merged.operations?.apply?.guidance).toEqual(["one", "two", "three"]);
    expect(merged.operations?.archive?.guidance).toEqual(["four"]);
  });

  it("introduces a key only when some layer declares it", () => {
    const merged = mergeRules([{ rules: { specs: ["A"] } }, { rules: { design: ["B"] } }]);
    expect(Object.keys(merged.rules ?? {})).toEqual(["specs", "design"]);
  });

  it("drops keys whose union is empty and returns an empty document for empty layers", () => {
    expect(mergeRules([{ rules: { specs: [] } }]).rules).toBeUndefined();
    expect(mergeRules([])).toEqual({});
  });
});
