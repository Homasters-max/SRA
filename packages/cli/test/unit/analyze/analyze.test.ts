/**
 * `core/analyze` as pure functions (REQ-VER-010, design §3): `parseDelta` by
 * sections of a delta spec, and `analyze` over texts already read —
 * `UNSATISFIED` (SCN-VER-062, 063), `CONFLICT` (SCN-VER-064), `ORPHAN`
 * (SCN-VER-065), `skipped[]` without the diff (SCN-VER-067) or `paths.tests`,
 * the order of the findings. No file, no process.
 */
import { describe, expect, it } from "vitest";

import { parseDelta, type DeltaRequirement } from "../../../src/core/analyze/delta.js";
import { analyze, countFindings, type AnalyzeInput, type TestFile } from "../../../src/core/analyze/index.js";

const TASKS = "openspec/changes/add-search/tasks.md";

function input(extra: Partial<AnalyzeInput> = {}): AnalyzeInput {
  return {
    delta: [],
    mainIds: new Set(),
    tasksText: "",
    tasksPath: TASKS,
    testFiles: { ok: true, value: [] },
    changedTests: { ok: true, value: [] },
    ...extra
  };
}

const tests = (...files: TestFile[]): AnalyzeInput["testFiles"] => ({ ok: true, value: files });
const changed = (...paths: string[]): AnalyzeInput["changedTests"] => ({ ok: true, value: paths });
const added = (req: string, ...scenarios: string[]): DeltaRequirement => ({ section: "ADDED", req, scenarios });

describe("parseDelta", () => {
  it("reads requirements and their scenarios by section; other sections and code spans are not ids", () => {
    const text = [
      "# Spec Delta: search",
      "",
      "## ADDED Requirements",
      "",
      "### Requirement: Search",
      "<!-- id: REQ-SRC-004 -->",
      "The format is `<!-- id: REQ-SRC-900 -->`.",
      "#### Scenario: Found",
      "<!-- id: SCN-SRC-010 -->",
      "#### Scenario: Not found",
      "<!-- id: SCN-SRC-011 -->",
      "",
      "## MODIFIED Requirements",
      "### Requirement: Index",
      "<!-- id: REQ-SRC-001 -->",
      "",
      "## REMOVED Requirements",
      "### Requirement: Legacy",
      "<!-- id: REQ-SRC-002 -->",
      "#### Scenario: Old",
      "<!-- id: SCN-SRC-005 -->",
      "",
      "## RENAMED Requirements",
      "- FROM: `### Requirement: Index`",
      "",
      "## Notes",
      "<!-- id: REQ-SRC-999 -->"
    ].join("\r\n");
    expect(parseDelta(text)).toEqual([
      { section: "ADDED", req: "REQ-SRC-004", scenarios: ["SCN-SRC-010", "SCN-SRC-011"] },
      { section: "MODIFIED", req: "REQ-SRC-001", scenarios: [] },
      { section: "REMOVED", req: "REQ-SRC-002", scenarios: ["SCN-SRC-005"] }
    ]);
  });
});

describe("analyze", () => {
  it("UNSATISFIED missing task: REQ and its SCN absent from tasks.md, the SCN tagged in a test (SCN-VER-062)", () => {
    const result = analyze(
      input({
        delta: [added("REQ-SRC-004", "SCN-SRC-010")],
        tasksText: "- [ ] 1.1 search\n",
        testFiles: tests({ path: "tests/test_search.py", text: "# SCN-SRC-010\n" })
      })
    );
    expect(result).toEqual({ findings: [{ code: "UNSATISFIED", id: "REQ-SRC-004", missing: ["task"] }], skipped: [] });
  });

  it("a mention of one SCN of the REQ in tasks.md is enough (SCN-VER-062)", () => {
    const result = analyze(
      input({
        delta: [added("REQ-SRC-004", "SCN-SRC-010", "SCN-SRC-011")],
        tasksText: "- [ ] 1.1 search (SCN-SRC-011)\n",
        testFiles: tests({ path: "tests/test_search.py", text: "SCN-SRC-010" })
      })
    );
    expect(result.findings).toEqual([]);
  });

  it("UNSATISFIED missing test: no SCN of the REQ under paths.tests; a REQ without SCN too (SCN-VER-063)", () => {
    const result = analyze(
      input({
        delta: [added("REQ-SRC-004", "SCN-SRC-010"), { section: "MODIFIED", req: "REQ-SRC-005", scenarios: [] }],
        tasksText: "REQ-SRC-004, REQ-SRC-005",
        testFiles: tests({ path: "tests/test_other.py", text: "SCN-SRC-0100 XSCN-SRC-010" })
      })
    );
    expect(result.findings).toEqual([
      { code: "UNSATISFIED", id: "REQ-SRC-004", missing: ["test"] },
      { code: "UNSATISFIED", id: "REQ-SRC-005", missing: ["test"] }
    ]);
    const neither = analyze(input({ delta: [added("REQ-SRC-004", "SCN-SRC-010")] }));
    expect(neither.findings).toEqual([{ code: "UNSATISFIED", id: "REQ-SRC-004", missing: ["task", "test"] }]);
  });

  it("CONFLICT: tasks.md names a REMOVED or undeclared REQ/SCN; main and delta declarations are defined (SCN-VER-064)", () => {
    const result = analyze(
      input({
        delta: [{ section: "REMOVED", req: "REQ-SRC-002", scenarios: [] }],
        mainIds: new Set(["REQ-SRC-001", "SCN-SRC-001", "REQ-SRC-002"]),
        tasksText: "- REQ-SRC-002\n- REQ-SRC-001 (SCN-SRC-001)\n- SCN-SRC-777\n- REQ-SRC-002 again\n"
      })
    );
    expect(result.findings).toEqual([
      { code: "CONFLICT", id: "REQ-SRC-002", path: TASKS },
      { code: "CONFLICT", id: "SCN-SRC-777", path: TASKS }
    ]);
  });

  it("ORPHAN: only changed test files, only undefined SCN (SCN-VER-065)", () => {
    const result = analyze(
      input({
        mainIds: new Set(["SCN-SRC-001"]),
        testFiles: tests(
          { path: "tests/test_search.py", text: "SCN-SRC-099 SCN-SRC-001 REQ-SRC-777" },
          { path: "tests/test_old.py", text: "SCN-SRC-098" }
        ),
        changedTests: changed("tests/test_search.py")
      })
    );
    expect(result).toEqual({ findings: [{ code: "ORPHAN", id: "SCN-SRC-099", path: "tests/test_search.py" }], skipped: [] });
  });

  it("without the diff ORPHAN is skipped with the reason, UNSATISFIED and CONFLICT computed (SCN-VER-067)", () => {
    const result = analyze(
      input({
        delta: [added("REQ-SRC-004", "SCN-SRC-010")],
        tasksText: "SCN-SRC-777",
        testFiles: tests({ path: "tests/test_search.py", text: "SCN-SRC-099" }),
        changedTests: { ok: false, reason: "the project is not a git repository with a commit" }
      })
    );
    expect(result.findings).toEqual([
      { code: "CONFLICT", id: "SCN-SRC-777", path: TASKS },
      { code: "UNSATISFIED", id: "REQ-SRC-004", missing: ["task", "test"] }
    ]);
    expect(result.skipped).toEqual([{ code: "ORPHAN", reason: "diff unknown: the project is not a git repository with a commit" }]);
  });

  it("without paths.tests the test half of UNSATISFIED and ORPHAN are skipped", () => {
    const result = analyze(
      input({
        delta: [added("REQ-SRC-004", "SCN-SRC-010")],
        tasksText: "REQ-SRC-004",
        testFiles: { ok: false, reason: "paths.tests is not set in .warrant/warrant.json" }
      })
    );
    expect(result.findings).toEqual([]);
    expect(result.skipped.map((s) => s.code)).toEqual(["UNSATISFIED", "ORPHAN"]);
  });

  it("a consistent Change has no finding; counts name every code (SCN-VER-066)", () => {
    const result = analyze(
      input({
        delta: [added("REQ-SRC-004", "SCN-SRC-010")],
        tasksText: "REQ-SRC-004",
        testFiles: tests({ path: "tests/test_search.py", text: "SCN-SRC-010" }),
        changedTests: changed("tests/test_search.py")
      })
    );
    expect(result).toEqual({ findings: [], skipped: [] });
    expect(countFindings(result.findings)).toEqual({ UNSATISFIED: 0, CONFLICT: 0, ORPHAN: 0 });
  });
});
