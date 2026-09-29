/**
 * Parsers `junit` and `openspec-validate` (design §5, REQ-VER-002): status and
 * `metrics` in the strict forms of core-sdd (I-69).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { compileMetricsForms } from "../../../src/core/validate/evidence.js";
import { countJunit, parseJunitDir, parseJunitDocuments } from "../../../src/core/evidence/parsers/junit.js";
import { parseOpenspecValidate } from "../../../src/core/evidence/parsers/openspec-validate.js";
import { findParser } from "../../../src/core/evidence/parsers/index.js";
import { makeTempDir, REPO_ROOT, removeDir } from "../../helpers/cli.js";

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
        <testcase classname="test/a.test.ts" name="two" time="0.1"></testcase>
        <testcase classname="test/a.test.ts" name="three" time="0">
            <skipped/>
        </testcase>
    </testsuite>
    <testsuite name="test/b.test.ts" timestamp="2026-09-22T10:00:00.000Z" hostname="h" tests="2" failures="0" errors="0" skipped="0" time="0.7">
        <testcase classname="test/b.test.ts" name="four" time="0.3">
            <system-out><![CDATA[<testcase name="printed by the test"/>]]></system-out>
        </testcase>
        <testcase classname="test/b.test.ts" name="five" time="0.4"></testcase>
    </testsuite>
</testsuites>
`;

const ONE_FAILURE = `<testsuites tests="4" failures="1">
  <testsuite name='x' tests='4' failures='1' errors='0' skipped='0'>
    <testcase name='a'><failure message="expected 1 to be 2"/></testcase>
    <testcase name='b'/>
    <testcase name='c'></testcase>
    <testcase name='d' time='0.1'/>
  </testsuite>
</testsuites>
`;

/** `node --test --test-reporter=junit` of Node 22.17 (stacks cut): cases outside any suite, nested suites. */
const NODE_TEST = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testcase name="top pass" time="0.001658" classname="test"/>
	<testcase name="top fail" time="0.000800" classname="test" failure="1 == 2">
		<failure type="testCodeFailure" message="1 == 2">
[Error [ERR_TEST_FAILURE]: 1 == 2] {
  code: 'ERR_TEST_FAILURE',
      at TestContext.&lt;anonymous> (file:///a.test.mjs:4:33)
}
		</failure>
	</testcase>
	<testcase name="top skip" time="0.000114" classname="test">
		<skipped type="skipped" message="true"/>
	</testcase>
	<testcase name="top todo" time="0.000108" classname="test">
		<skipped type="todo" message="true"/>
	</testcase>
	<testsuite name="outer" time="0.001373" disabled="0" errors="0" tests="2" failures="1" skipped="1" hostname="h">
		<testcase name="outer pass" time="0.000256" classname="test"/>
		<testsuite name="inner" time="0.000647" disabled="0" errors="0" tests="2" failures="1" skipped="0" hostname="h">
			<testcase name="inner pass" time="0.000215" classname="test"/>
			<testcase name="inner fail" time="0.000250" classname="test" failure="boom">
				<failure type="testCodeFailure" message="boom">
Error [ERR_TEST_FAILURE]: boom
				</failure>
			</testcase>
		</testsuite>
	</testsuite>
	<!-- tests 7 -->
	<!-- suites 2 -->
	<!-- pass 3 -->
	<!-- fail 2 -->
	<!-- cancelled 0 -->
	<!-- skipped 1 -->
	<!-- todo 1 -->
	<!-- duration_ms 111.4628 -->
</testsuites>
`;

describe("parser junit → test-report", () => {
  const valid = form("test-report");

  it("counts every <testcase> once, not the <testsuite> or <testsuites> counters, and not text in CDATA", () => {
    expect(countJunit([VITEST_PASS])).toEqual({ tests: 5, failures: 0, errors: 0, skipped: 1 });
  });

  it("SCN-VER-117 counts node:test cases outside any suite and does not double nested suites (LATTICE, W-3)", () => {
    const result = parseJunitDocuments([NODE_TEST]);
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.metrics).toEqual({ tests: 7, failures: 2, errors: 0, skipped: 2 });
    expect(valid(result.metrics)).toBe(true);
    // Only cases outside a suite were INCONCLUSIVE ("no <testsuite>") before.
    const top = `<testsuites>
	<testcase name="a" classname="test"/>
	<testcase name="b" classname="test"/>
	<!-- tests 2 -->
</testsuites>`;
    expect(parseJunitDocuments([top])).toMatchObject({ status: "PROVEN", metrics: { tests: 2, failures: 0, errors: 0, skipped: 0 } });
    // Suite counters of node:test count a nested suite as a test of its parent (2 + 1 here).
    const nested = '<testsuite name="o" tests="2"><testcase name="a"/><testsuite name="i" tests="1"><testcase name="b"/></testsuite></testsuite>';
    expect(countJunit([nested])).toEqual({ tests: 2, failures: 0, errors: 0, skipped: 0 });
  });

  it("SCN-VER-117 a case with several outcomes: <skipped> hides only <failure>, <error> always counts (I-196)", () => {
    const todo = '<testcase name="t"><skipped type="todo" message="true"/><failure message="x"/></testcase>';
    expect(parseJunitDocuments([`<testsuites>${todo}<testcase name="ok"/></testsuites>`])).toMatchObject({
      status: "PROVEN",
      metrics: { tests: 2, failures: 0, errors: 0, skipped: 1 }
    });
    const skippedTeardown = '<testcase name="s"><skipped message="skip"/><error message="teardown"/></testcase>';
    expect(parseJunitDocuments([`<testsuite>${skippedTeardown}<testcase name="ok"/></testsuite>`])).toMatchObject({
      status: "NOT_PROVEN",
      metrics: { tests: 2, failures: 0, errors: 1, skipped: 1 }
    });
    const failedTeardown = '<testcase name="f"><failure message="x"/><error message="teardown"/></testcase>';
    expect(countJunit([`<testsuite>${failedTeardown}</testsuite>`])).toEqual({ tests: 1, failures: 1, errors: 1, skipped: 0 });
  });

  it("counts a case with an <error> child as an error, and falls back to <testsuite> counters without a case", () => {
    expect(countJunit(['<testsuite tests="9"><testcase name="a"><error message="x"/></testcase></testsuite>'])).toEqual({
      tests: 1,
      failures: 0,
      errors: 1,
      skipped: 0
    });
    expect(countJunit(["<testsuite name='x' tests='2' failures='1'/>"])).toEqual({ tests: 2, failures: 1, errors: 0, skipped: 0 });
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

  it("SCN-VER-118 a skipped test of a scenario is NOT_PROVEN, other skipped tests are not (ADR-0044 п. 2)", () => {
    const report = (name: string) => `<testsuite name="t" tests="3" skipped="2">
    <testcase classname="SCN-VER-009 file" name="ok"></testcase>
    <testcase name="${name}"><skipped/></testcase>
    <testcase name="cache"><skipped/></testcase>
</testsuite>`;
    const result = parseJunitDocuments([report("SCN-VER-001 &amp; retry")]);
    expect(result).toEqual({
      status: "NOT_PROVEN",
      metrics: { tests: 3, failures: 0, errors: 0, skipped: 2 },
      limitations: ["junit: skipped SCN-VER-001"]
    });
    // The same report without the id in the name; `classname` is not the name.
    expect(parseJunitDocuments([report("retry")])).toMatchObject({ status: "PROVEN", limitations: [] });
    // A skipped `todo` of node:test counts too, and so does a report where nothing ran (not INCONCLUSIVE).
    const todo = `<testsuites>
	<testcase name='SCN-VER-002 later' classname="test"><skipped type="todo" message="true"/></testcase>
</testsuites>`;
    expect(parseJunitDocuments([todo])).toEqual({
      status: "NOT_PROVEN",
      metrics: { tests: 1, failures: 0, errors: 0, skipped: 1 },
      limitations: ["junit: skipped SCN-VER-002"]
    });
  });

  it("SCN-VER-118 lists the skipped scenarios once, by document then by appearance, next to a failure", () => {
    const first = `<testsuite>
    <testcase name="SCN-ENF-003 then SCN-VER-001"><skipped/></testcase>
    <testcase name="REQ-VER-002 SCN-VER-0012 xSCN-VER-005"><skipped/></testcase>
    <testcase name="SCN-VER-004 &amp;lt;"><skipped/></testcase>
    <testcase name="SCN-VER-007 runs"><failure message="x"/></testcase>
</testsuite>`;
    const second = '<testsuite><testcase name="SCN-VER-001 again"><skipped/></testcase><testcase name="SCN-KRN-010"><skipped/></testcase></testsuite>';
    const result = parseJunitDocuments([first, second]);
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.limitations).toEqual(["junit: skipped SCN-ENF-003, SCN-VER-001, SCN-VER-004, SCN-KRN-010"]);
    expect(result.metrics).toEqual({ tests: 6, failures: 1, errors: 0, skipped: 5 });
  });

  it("SCN-VER-118 reads a name with an unescaped > whole (XML allows it in an attribute value)", () => {
    const doc = `<testsuite><testcase name="a > b SCN-VER-009" classname='x > y'><skipped/></testcase><testcase name="ok"/></testsuite>`;
    const result = parseJunitDocuments([doc]);
    expect(result.status).toBe("NOT_PROVEN");
    expect(result.limitations).toEqual(["junit: skipped SCN-VER-009"]);
    expect(result.metrics).toEqual({ tests: 2, failures: 0, errors: 0, skipped: 1 });
  });

  it("SCN-VER-118 reads the files of {out} in the order of their names", () => {
    const dir = makeTempDir("warrant-unit-junit-");
    try {
      mkdirSync(path.join(dir, "a"));
      writeFileSync(path.join(dir, "b.xml"), '<testsuite><testcase name="SCN-VER-002"><skipped/></testcase></testsuite>');
      writeFileSync(path.join(dir, "a", "z.xml"), '<testsuite><testcase name="SCN-VER-003"><skipped/></testcase></testsuite>');
      writeFileSync(path.join(dir, "a.xml"), '<testsuite><testcase name="SCN-VER-001"><skipped/></testcase></testsuite>');
      writeFileSync(path.join(dir, "notes.txt"), '<testcase name="SCN-VER-009"><skipped/></testcase>');
      expect(parseJunitDir(dir).limitations).toEqual(["junit: skipped SCN-VER-001, SCN-VER-003, SCN-VER-002"]);
    } finally {
      removeDir(dir);
    }
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
