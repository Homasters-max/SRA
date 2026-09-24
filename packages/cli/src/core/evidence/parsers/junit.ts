/**
 * Parser `junit` → kind `test-report` (design §5).
 *
 * Only the counters of the `<testsuite …>` opening tags are read; their
 * attributes are flat, so no XML library is needed. `<testsuites>` totals are
 * ignored and every `<testsuite>` is summed once, whichever reporter nested
 * them. The metrics follow the strict form of core-sdd (I-69): all four
 * counters, always.
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

/** Sums the counters over every `<testsuite>` of the given documents; null when there is none. */
export function countJunit(documents: readonly string[]): JunitCounts | null {
  const total: JunitCounts = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  let suites = 0;
  for (const text of documents) {
    for (const match of text.matchAll(SUITE_RE)) {
      const attributes = match[1] ?? "";
      suites += 1;
      total.tests += attribute(attributes, "tests");
      total.failures += attribute(attributes, "failures");
      total.errors += attribute(attributes, "errors");
      total.skipped += attribute(attributes, "skipped");
    }
  }
  return suites === 0 ? null : total;
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
    return { status: "INCONCLUSIVE", limitations: ["junit: no <testsuite> found in {out}"] };
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
