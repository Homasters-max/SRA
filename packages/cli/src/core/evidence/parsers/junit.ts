/**
 * Parser `junit` → kind `test-report` (design §5).
 *
 * A document is counted by its `<testcase>` elements, wherever they lie: a
 * case with a `<skipped>` child is skipped, with `<failure>` and no `<skipped>`
 * a failure (a failed `todo` of `node:test` carries both and does not fail the
 * run), with `<error>` an error, always — a teardown error of a skipped or
 * failed pytest test is never hidden (I-196). Reporters disagree on the `<testsuite>` counters —
 * `node:test` writes cases outside any suite and counts a nested suite as a
 * test of its parent, so a sum over suites misses the first and doubles the
 * second (connection of LATTICE, W-3; a departure from design §5 of
 * `phase-3-verification`, by the maintainer). Only a document without a single
 * `<testcase>` falls back to the counters of its `<testsuite …>` opening tags
 * (`<testsuites>` totals are ignored). No XML library is needed: comments and
 * CDATA are dropped first, the rest are tags. The metrics follow the strict
 * form of core-sdd (I-69): all four counters, always. A skipped case whose
 * `name` names a scenario (`SCN-…`) makes the report NOT_PROVEN with the
 * limitation `junit: skipped SCN-…` (ADR-0044 п. 2, design §3 of `lattice-issues`).
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

/**
 * `<testcase` opening tag; group 1 is `/` when it closes itself. A quoted
 * attribute value is taken whole, so an unescaped `>` inside `name` (XML
 * allows it) does not end the tag early (review lattice-issues, REQ-VER-002);
 * the alternatives start with different characters — no catastrophic backtracking.
 */
const CASE_RE = /<testcase(?![\w:.-])(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/g;

const CASE_END_RE = /<\/testcase\s*>/g;

/** Comments (`<!-- tests 2 -->` of `node:test`) and CDATA (captured output) are not markup. */
const NOT_MARKUP_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;

function hasChild(body: string, name: string): boolean {
  return new RegExp(`<${name}(?![\\w:.-])`).test(body);
}

/** The `name` attribute of a `<testcase …>` opening tag (`classname` is another attribute). */
const NAME_RE = /\sname\s*=\s*(?:"([^"]*)"|'([^']*)')/;

const ENTITY_RE = /&(amp|lt|gt|quot|apos);/g;

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The `name` of a case with the predefined XML entities expanded in one pass (`&amp;lt;` stays `&lt;`). */
function caseName(openingTag: string): string {
  const match = NAME_RE.exec(openingTag);
  const raw = match === null ? "" : (match[1] ?? match[2] ?? "");
  return raw.replace(ENTITY_RE, (_, entity: string) => ENTITIES[entity] ?? "");
}

/**
 * A scenario id (`SCN-<AREA>-NNN`, ADR-0012) — the `SCN` half of `REFERENCE_RE`
 * of `core/ids/references.ts`, same boundaries. A copy, not an import:
 * `core/ids` → `core/git` → `core/evidence` would close a module cycle
 * (ADR-0030; design I-209 of `lattice-issues`).
 */
const SCENARIO_RE = /(?<![A-Za-z0-9-])SCN-[A-Z]{2,5}-\d{3}(?![A-Za-z0-9-])/g;

/** Scenario ids named by a test, in order of appearance. */
function scenariosOf(name: string): string[] {
  return [...name.matchAll(SCENARIO_RE)].map((match) => match[0]);
}

interface DocumentCases {
  counts: JunitCounts;
  /** Scenario ids in the names of the skipped cases, in order of appearance (repeats kept). */
  skippedScenarios: string[];
}

/** Counts of the `<testcase>` elements of one document; null when it has none. */
function countCases(text: string): DocumentCases | null {
  const counts: JunitCounts = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  const skippedScenarios: string[] = [];
  for (const match of text.matchAll(CASE_RE)) {
    counts.tests += 1;
    if (match[1] === "/") continue;
    const start = match.index + match[0].length;
    CASE_END_RE.lastIndex = start;
    const end = CASE_END_RE.exec(text);
    const body = text.slice(start, end === null ? text.length : end.index);
    const skipped = hasChild(body, "skipped");
    if (skipped) {
      counts.skipped += 1;
      skippedScenarios.push(...scenariosOf(caseName(match[0])));
    } else if (hasChild(body, "failure")) counts.failures += 1;
    if (hasChild(body, "error")) counts.errors += 1;
  }
  return counts.tests === 0 ? null : { counts, skippedScenarios };
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
  return scanJunit(documents)?.counts ?? null;
}

/**
 * The summed counts of the documents and the scenario ids in the names of
 * their skipped cases — without repeats, documents in the given order (sorted
 * `{out}`), cases in order of appearance (ADR-0044 п. 2); null when no document
 * has a case or a suite.
 */
function scanJunit(documents: readonly string[]): DocumentCases | null {
  const total: JunitCounts = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  const scenarios = new Set<string>();
  let found = false;
  for (const document of documents) {
    const text = document.replace(NOT_MARKUP_RE, "");
    const cases = countCases(text);
    const counts = cases?.counts ?? countSuites(text);
    if (counts === null) continue;
    found = true;
    total.tests += counts.tests;
    total.failures += counts.failures;
    total.errors += counts.errors;
    total.skipped += counts.skipped;
    for (const id of cases?.skippedScenarios ?? []) scenarios.add(id);
  }
  return found ? { counts: total, skippedScenarios: [...scenarios] } : null;
}

/**
 * Status of a junit report: any failure or error → NOT_PROVEN; a skipped test
 * of a scenario (`SCN-…` in its name, ADR-0044 п. 2) → NOT_PROVEN; no test ran —
 * none at all, or every one skipped (review of phase 3, R-4) → INCONCLUSIVE.
 */
export function junitStatus(counts: JunitCounts, skippedScenarios: readonly string[]): ParseResult["status"] {
  if (counts.failures + counts.errors > 0) return "NOT_PROVEN";
  if (skippedScenarios.length > 0) return "NOT_PROVEN";
  if (counts.tests - counts.skipped <= 0) return "INCONCLUSIVE";
  return "PROVEN";
}

/** Parses the junit documents (texts, in the sorted order of `{out}`) into a result. */
export function parseJunitDocuments(documents: readonly string[]): ParseResult {
  const scan = scanJunit(documents);
  if (scan === null) {
    return { status: "INCONCLUSIVE", limitations: ["junit: no <testcase> or <testsuite> found in {out}"] };
  }
  const { counts, skippedScenarios } = scan;
  const status = junitStatus(counts, skippedScenarios);
  const limitations: string[] = [];
  if (skippedScenarios.length > 0) limitations.push(`junit: skipped ${skippedScenarios.join(", ")}`);
  if (status === "INCONCLUSIVE" && counts.tests > 0) limitations.push(`junit: all ${counts.tests} tests skipped`);
  return { status, metrics: { ...counts }, limitations };
}

/** Reads every `*.xml` under `{out}` (sorted) and parses them together. */
export function parseJunitDir(outDir: string): ParseResult {
  const documents = walkFiles(outDir)
    .filter((file) => file.toLowerCase().endsWith(".xml"))
    .map((file) => readFileSync(file, "utf8"));
  return parseJunitDocuments(documents);
}
