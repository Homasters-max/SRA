/**
 * Parser `junit` → kind `test-report` (design §5).
 *
 * A document is counted by its `<testcase>` elements, wherever they lie: a
 * case with a `<failure>` child is a failure, with `<error>` an error, with
 * `<skipped>` skipped. Reporters disagree on the `<testsuite>` counters —
 * `node:test` writes cases outside any suite and counts a nested suite as a
 * test of its parent, so a sum over suites misses the first and doubles the
 * second (connection of LATTICE, W-3; a departure from design §5 of
 * `phase-3-verification`, by the maintainer). Only a document without a single
 * `<testcase>` falls back to the counters of its `<testsuite …>` opening tags
 * (`<testsuites>` totals are ignored). No XML library is needed: comments and
 * CDATA are dropped first, the rest are tags. The metrics follow the strict
 * form of core-sdd (I-69): all four counters, always.
 */
import { readFileSync } from "node:fs";

import { walkFiles } from "../../fs.js";
import type { ParseResult } from "./types.js";

export interface JunitCounts {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
}

/** `<testsuite` followed by a non-name character, so `<testsuites` never matches. */
const SUITE_RE = /<testsuite(?![\w:.-])([^>]*)>/g;

function attribute(attributes: string, name: string): number {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"(\\d+)"|'(\\d+)')`).exec(attributes);
  if (match === null) return 0;
  return Number.parseInt(match[1] ?? match[2] ?? "0", 10);
}

/** `<testcase` opening tag; group 1 is `/` when it closes itself. */
const CASE_RE = /<testcase(?![\w:.-])[^>]*?(\/?)>/g;

const CASE_END_RE = /<\/testcase\s*>/g;

/** Comments (`<!-- tests 2 -->` of `node:test`) and CDATA (captured output) are not markup. */
const NOT_MARKUP_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;

function hasChild(body: string, name: string): boolean {
  return new RegExp(`<${name}(?![\\w:.-])`).test(body);
}

/** Counts of the `<testcase>` elements of one document; null when it has none. */
function countCases(text: string): JunitCounts | null {
  const counts: JunitCounts = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  for (const match of text.matchAll(CASE_RE)) {
    counts.tests += 1;
    if (match[1] === "/") continue;
    const start = match.index + match[0].length;
    CASE_END_RE.lastIndex = start;
    const end = CASE_END_RE.exec(text);
    const body = text.slice(start, end === null ? text.length : end.index);
    if (hasChild(body, "failure")) counts.failures += 1;
    else if (hasChild(body, "error")) counts.errors += 1;
    else if (hasChild(body, "skipped")) counts.skipped += 1;
  }
  return counts.tests === 0 ? null : counts;
}

/** Sums of the `<testsuite>` counters of one document; null when it has none. */
function countSuites(text: string): JunitCounts | null {
  const counts: JunitCounts = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  let suites = 0;
  for (const match of text.matchAll(SUITE_RE)) {
    const attributes = match[1] ?? "";
    suites += 1;
    counts.tests += attribute(attributes, "tests");
    counts.failures += attribute(attributes, "failures");
    counts.errors += attribute(attributes, "errors");
    counts.skipped += attribute(attributes, "skipped");
  }
  return suites === 0 ? null : counts;
}

/**
 * Sums the counts of the given documents — each by its `<testcase>` elements,
 * or by its `<testsuite>` counters when it has no case; null when no document
 * has either.
 */
export function countJunit(documents: readonly string[]): JunitCounts | null {
  const total: JunitCounts = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  let found = false;
  for (const document of documents) {
    const text = document.replace(NOT_MARKUP_RE, "");
    const counts = countCases(text) ?? countSuites(text);
    if (counts === null) continue;
    found = true;
    total.tests += counts.tests;
    total.failures += counts.failures;
    total.errors += counts.errors;
    total.skipped += counts.skipped;
  }
  return found ? total : null;
}

/**
 * Status of a junit report: any failure or error → NOT_PROVEN; no test ran —
 * none at all, or every one skipped (review of phase 3, R-4) → INCONCLUSIVE.
 */
export function junitStatus(counts: JunitCounts): ParseResult["status"] {
  if (counts.failures + counts.errors > 0) return "NOT_PROVEN";
  if (counts.tests - counts.skipped <= 0) return "INCONCLUSIVE";
  return "PROVEN";
}

/** Parses the junit documents (texts) into a result. */
export function parseJunitDocuments(documents: readonly string[]): ParseResult {
  const counts = countJunit(documents);
  if (counts === null) {
    return { status: "INCONCLUSIVE", limitations: ["junit: no <testcase> or <testsuite> found in {out}"] };
  }
  const status = junitStatus(counts);
  const limitations = status === "INCONCLUSIVE" && counts.tests > 0 ? [`junit: all ${counts.tests} tests skipped`] : [];
  return { status, metrics: { ...counts }, limitations };
}

/** Reads every `*.xml` under `{out}` (sorted) and parses them together. */
export function parseJunitDir(outDir: string): ParseResult {
  const documents = walkFiles(outDir)
    .filter((file) => file.toLowerCase().endsWith(".xml"))
    .map((file) => readFileSync(file, "utf8"));
  return parseJunitDocuments(documents);
}
