/**
 * `analyze` (REQ-VER-010, N19, N20, ADR-0036 п. 2): the consistency of the delta
 * specs, `tasks.md` and the tests of a Change by ids and references — a pure
 * function; the caller reads the files (`input.ts`). `warrant analyze` prints
 * its result, gate `analyze-clean` judges by it (REQ-VER-004).
 *
 * An id is defined when it is declared in the main specs or in `ADDED` /
 * `MODIFIED` of the delta, and not declared in `REMOVED`. Findings:
 *
 * - `UNSATISFIED` `{ id, missing[] }` — a REQ of `ADDED` / `MODIFIED` that
 *   `tasks.md` mentions neither itself nor through one of its SCN (`task`), or
 *   none of whose SCN is mentioned by a file under `paths.tests` (`test`; a REQ
 *   without SCN too);
 * - `CONFLICT` `{ id, path }` — `tasks.md` mentions a REQ or SCN that is not
 *   defined;
 * - `ORPHAN` `{ id, path }` — a test file changed in the diff (not removed)
 *   mentions an SCN that is not defined.
 *
 * Without `paths.tests` the test half of `UNSATISFIED` and `ORPHAN` are not
 * computed; without the diff `ORPHAN` is not: each goes to `skipped[]` with
 * the reason. Findings are sorted by code, id and path.
 */
import type { Availability } from "../git/facts.js";
import { findReferences } from "../ids/references.js";
import type { DeltaRequirement } from "./delta.js";

export type AnalyzeCode = "UNSATISFIED" | "CONFLICT" | "ORPHAN";

export type Missing = "task" | "test";

export type AnalyzeFinding =
  | { code: "UNSATISFIED"; id: string; missing: Missing[] }
  | { code: "CONFLICT"; id: string; path: string }
  | { code: "ORPHAN"; id: string; path: string };

/** A finding this run could not compute, and why. */
export interface AnalyzeSkip {
  code: "UNSATISFIED" | "ORPHAN";
  reason: string;
}

export interface AnalyzeResult {
  findings: AnalyzeFinding[];
  skipped: AnalyzeSkip[];
}

/** A file under `paths.tests`: project-relative POSIX path and its text. */
export interface TestFile {
  path: string;
  text: string;
}

export interface AnalyzeInput {
  /** Requirements of every delta spec of the Change. */
  delta: readonly DeltaRequirement[];
  /** REQ and SCN ids declared in `openspec/specs/**`. */
  mainIds: ReadonlySet<string>;
  /** Text of `tasks.md` (empty when there is none) and its project-relative path. */
  tasksText: string;
  tasksPath: string;
  /** Files under `paths.tests`, or why there are none to read (`paths.tests` unset). */
  testFiles: Availability<readonly TestFile[]>;
  /** Paths of the test files changed in the diff and not removed, or why the diff is unknown. */
  changedTests: Availability<readonly string[]>;
}

const referencedIds = (text: string): Set<string> => new Set(findReferences(text).map((r) => r.id));

function compare(a: AnalyzeFinding, b: AnalyzeFinding): number {
  const pa = "path" in a ? a.path : "";
  const pb = "path" in b ? b.path : "";
  const ka = [a.code, a.id, pa];
  const kb = [b.code, b.id, pb];
  for (let i = 0; i < ka.length; i += 1) {
    const x = ka[i] as string;
    const y = kb[i] as string;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function analyze(input: AnalyzeInput): AnalyzeResult {
  const findings: AnalyzeFinding[] = [];
  const skipped: AnalyzeSkip[] = [];

  const removed = new Set<string>();
  const declared = new Set<string>(input.mainIds);
  /** REQ of ADDED / MODIFIED → its SCN, merged when a REQ appears twice. */
  const required = new Map<string, Set<string>>();
  for (const entry of input.delta) {
    const ids = [entry.req, ...entry.scenarios];
    if (entry.section === "REMOVED") {
      for (const id of ids) removed.add(id);
    } else if (entry.section === "ADDED" || entry.section === "MODIFIED") {
      for (const id of ids) declared.add(id);
      const scenarios = required.get(entry.req) ?? new Set<string>();
      for (const scn of entry.scenarios) scenarios.add(scn);
      required.set(entry.req, scenarios);
    }
  }
  const defined = (id: string): boolean => declared.has(id) && !removed.has(id);

  const inTasks = referencedIds(input.tasksText);
  const tests = input.testFiles;
  const inTests = new Set<string>();
  if (tests.ok) for (const file of tests.value) for (const id of referencedIds(file.text)) inTests.add(id);
  else skipped.push({ code: "UNSATISFIED", reason: `tests not checked: ${tests.reason}` });

  for (const [req, scenarios] of required) {
    const missing: Missing[] = [];
    if (!inTasks.has(req) && ![...scenarios].some((scn) => inTasks.has(scn))) missing.push("task");
    if (tests.ok && ![...scenarios].some((scn) => inTests.has(scn))) missing.push("test");
    if (missing.length > 0) findings.push({ code: "UNSATISFIED", id: req, missing });
  }

  for (const id of inTasks) if (!defined(id)) findings.push({ code: "CONFLICT", id, path: input.tasksPath });

  if (!tests.ok) {
    skipped.push({ code: "ORPHAN", reason: tests.reason });
  } else if (!input.changedTests.ok) {
    skipped.push({ code: "ORPHAN", reason: `diff unknown: ${input.changedTests.reason}` });
  } else {
    const texts = new Map(tests.value.map((file) => [file.path, file.text]));
    for (const path of new Set(input.changedTests.value)) {
      const text = texts.get(path);
      if (text === undefined) continue;
      for (const id of referencedIds(text)) {
        if (id.startsWith("SCN-") && !defined(id)) findings.push({ code: "ORPHAN", id, path });
      }
    }
  }

  return { findings: findings.sort(compare), skipped };
}

/** `counts` of `warrant analyze`: findings by code, every code present. */
export function countFindings(findings: readonly AnalyzeFinding[]): Record<AnalyzeCode, number> {
  const counts: Record<AnalyzeCode, number> = { UNSATISFIED: 0, CONFLICT: 0, ORPHAN: 0 };
  for (const finding of findings) counts[finding.code] += 1;
  return counts;
}
