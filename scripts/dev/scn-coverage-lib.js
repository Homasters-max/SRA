/**
 * Logic of `scripts/dev/scn-coverage.js` (ADR-0033 п. 6, R4): which scenarios of a Change's delta specs no test names.
 * A scenario is `<!-- id: SCN-… -->` in a spec file, outside `## REMOVED Requirements`; a test names it by the id
 * anywhere in its text (the SCN tag in the test name, packages/cli/CLAUDE.md). Pure — the caller reads the files.
 * A development check for the skill `review-impl`; the product check `scn-covered` is BL-25 (phase 5).
 */

const SCN_ID = /<!--\s*id:\s*(SCN-[A-Z0-9]+-\d+)\s*-->/;
const SCN_REF = /SCN-[A-Z0-9]+-\d+/g;

/** Scenario ids of a spec text, in order, without those under `## REMOVED Requirements`. */
export function scenarioIds(text) {
  const out = [];
  let removed = false;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (line.startsWith("## ")) removed = /^##\s+REMOVED\b/i.test(line);
    const m = SCN_ID.exec(line);
    if (m && !removed) out.push(m[1]);
  }
  return out;
}

/** Scenario ids a test text mentions. */
export function referencedIds(text) {
  return new Set(String(text ?? "").match(SCN_REF) ?? []);
}

/** `{ total, covered, missing }` — scenarios of `specTexts` against the ids named in `testTexts`. */
export function coverage(specTexts, testTexts) {
  const ids = [...new Set(specTexts.flatMap(scenarioIds))];
  const named = new Set(testTexts.flatMap((t) => [...referencedIds(t)]));
  const missing = ids.filter((id) => !named.has(id));
  return { total: ids.length, covered: ids.length - missing.length, missing };
}
