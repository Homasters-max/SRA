/**
 * Parsers `junit` and `openspec-validate` (design §5, REQ-VER-002): status and
 * `metrics` in the strict forms of core-sdd (I-69).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { compileMetricsForms } from "../../../src/core/validate/evidence.js";
import { countJunit, parseJunitDocuments } from "../../../src/core/evidence/parsers/junit.js";
import { parseOpenspecValidate } from "../../../src/core/evidence/parsers/openspec-validate.js";
import { findParser } from "../../../src/core/evidence/parsers/index.js";
import { REPO_ROOT } from "../../helpers/cli.js";

function form(kind: string) {
  const file = path.join(REPO_ROOT, "packs", "core-sdd", "evidence", `${kind}.metrics.schema.json`);
  const compiled = compileMetricsForms([
    { kind, pack: "core-sdd", metricsSchema: { path: file, json: JSON.parse(readFileSync(file, "utf8")) } }
  ]);
  expect(compiled.errors).toEqual([]);
  return compiled.forms.get(kind) as (value: unknown) => boolean;
}

const VITEST_PASS = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="5" failures="0" errors="0" time="1.2">
    <testsuite name="test/a.test.ts" timestamp="2026-09-22T10:00:00.000Z" hostname="h" tests="3" failures="0" errors="0" skipped="1" time="0.5">
        <testcase classname="test/a.test.ts" name="one" time="0.1"></testcase>
    </testsuite>
    <testsuite name="test/b.test.ts" timestamp="2026-09-22T10:00:00.000Z" hostname="h" tests="2" failures="0" errors="0" skipped="0" time="0.7">
    </testsuite>
</testsuites>
`;

const ONE_FAILURE = `<testsuites tests="4" failures="1">
  <testsuite name='x' tests='4' failures='1' errors='0' skipped='0'>
    <testcase name="a"><failure message="expected 1 to be 2"/></testcase>
  </testsuite>
</testsuites>
`;

describe("parser junit → test-report", () => {
  const valid = form("test-report");

  it("sums every <testsuite> once and ignores the <testsuites> totals", () => {
    expect(countJunit([VITEST_PASS])).toEqual({ tests: 5, failures: 0, errors: 0, skipped: 1 });
  });

  it("is PROVEN without failures, with metrics in the pack form", () => {
    const result = parseJunitDocuments([VITEST_PASS]);
    expect(result.status).toBe("PROVEN");
    expect(result.metrics).toEqual({ tests: 5, failures: 0, errors: 0, skipped: 1 });
    expect(valid(result.metrics)).toBe(true);
  });

  it("is NOT_PROVEN with one failure (single-quoted attributes too)", () => {
    const result = parseJunitDocuments([ONE_FAILURE]);
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.metrics).toEqual({ tests: 4, failures: 1, errors: 0, skipped: 0 });
    expect(valid(result.metrics)).toBe(true);
  });

  it("is NOT_PROVEN on errors alone", () => {
    expect(parseJunitDocuments(['<testsuite tests="2" errors="1"/>']).status).toBe("NOT_PROVEN");
  });

  it("is INCONCLUSIVE when no test ran (tests=0)", () => {
    const result = parseJunitDocuments(['<testsuites><testsuite name="empty" tests="0" failures="0"></testsuite></testsuites>']);
    expect(result.status).toBe("INCONCLUSIVE");
    expect(result.metrics).toEqual({ tests: 0, failures: 0, errors: 0, skipped: 0 });
    expect(valid(result.metrics)).toBe(true);
  });

  it("is INCONCLUSIVE when every test was skipped (review R-4)", () => {
    const result = parseJunitDocuments(['<testsuite tests="3" failures="0" skipped="3"/>', '<testsuite tests="1" skipped="1"/>']);
    expect(result.status).toBe("INCONCLUSIVE");
    expect(result.metrics).toEqual({ tests: 4, failures: 0, errors: 0, skipped: 4 });
    expect(result.limitations).toEqual(["junit: all 4 tests skipped"]);
    // One test that ran is enough.
    expect(parseJunitDocuments(['<testsuite tests="4" skipped="3"/>'])).toMatchObject({ status: "PROVEN", limitations: [] });
  });

  it("is INCONCLUSIVE without metrics when there is no report at all", () => {
    const result = parseJunitDocuments([]);
    expect(result.status).toBe("INCONCLUSIVE");
    expect(result.metrics).toBeUndefined();
    expect(result.limitations.length).toBe(1);
    expect(parseJunitDocuments(["<testsuites/>"]).status).toBe("INCONCLUSIVE");
  });

  it("sums several documents", () => {
    expect(countJunit([VITEST_PASS, ONE_FAILURE])).toEqual({ tests: 9, failures: 1, errors: 0, skipped: 1 });
  });
});

/** `openspec validate <change> --strict --json` as OpenSpec 1.13.1 prints it. */
function report(valid: boolean, issues: { level: string; path: string; message: string }[]): string {
  return JSON.stringify({
    items: [{ id: "add-search", type: "change", valid, issues, durationMs: 21 }],
    summary: { totals: { items: 1, passed: valid ? 1 : 0, failed: valid ? 0 : 1 } },
    version: "1.0",
    root: { path: "/p", source: "nearest" }
  });
}

describe("parser openspec-validate → spec-report", () => {
  const valid = form("spec-report");

  it("is PROVEN for a valid change without issues", () => {
    const result = parseOpenspecValidate(report(true, []));
    expect(result).toEqual({ status: "PROVEN", metrics: { issues: 0 }, limitations: [] });
    expect(valid(result.metrics)).toBe(true);
  });

  it("is NOT_PROVEN with issues, counting warnings too", () => {
    const result = parseOpenspecValidate(
      report(false, [
        { level: "WARNING", path: "x/spec.md", message: "should contain SHALL" },
        { level: "ERROR", path: "x/spec.md", message: "must include at least one scenario" }
      ])
    );
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.metrics).toEqual({ issues: 2 });
    expect(valid(result.metrics)).toBe(true);
  });

  it("is NOT_PROVEN on an ERROR issue even if the item says valid", () => {
    const result = parseOpenspecValidate(report(true, [{ level: "ERROR", path: "p", message: "m" }]));
    expect(result.status).toBe("NOT_PROVEN");
  });

  it("stays PROVEN on warnings of a valid item", () => {
    const result = parseOpenspecValidate(report(true, [{ level: "WARNING", path: "p", message: "m" }]));
    expect(result).toEqual({ status: "PROVEN", metrics: { issues: 1 }, limitations: [] });
  });

  it("reads the flat form {valid, issues} and skips warnings printed before the JSON", () => {
    expect(parseOpenspecValidate('Warning: deprecated\n{ "valid": true, "issues": [] }').status).toBe("PROVEN");
    expect(parseOpenspecValidate('{ "valid": false, "issues": [{ "level": "ERROR" }] }')).toMatchObject({
      status: "NOT_PROVEN",
      metrics: { issues: 1 }
    });
  });

  it("is INCONCLUSIVE for an unknown item and for output that is not JSON", () => {
    const unknown = parseOpenspecValidate(
      JSON.stringify({ status: [{ severity: "error", code: "unknown_item", message: "Unknown item 'x'" }] })
    );
    expect(unknown.status).toBe("INCONCLUSIVE");
    expect(unknown.metrics).toEqual({ issues: 1 });
    expect(unknown.limitations[0]).toContain("Unknown item 'x'");
    expect(parseOpenspecValidate("boom")).toEqual({
      status: "INCONCLUSIVE",
      limitations: ["openspec-validate: output is not a JSON report"]
    });
  });
});

describe("parser catalogue", () => {
  it("maps parser names to kinds and knows which one reads stdout", () => {
    expect(findParser("junit")).toMatchObject({ kind: "test-report", readsStdout: false });
    expect(findParser("openspec-validate")).toMatchObject({ kind: "spec-report", readsStdout: true, stdoutFile: "stdout.json" });
    expect(findParser("pytest")).toBeUndefined();
  });
});
