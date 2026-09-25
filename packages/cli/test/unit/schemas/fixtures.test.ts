import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DOCUMENT_SCHEMAS } from "../../../src/core/schemas/registry.js";
import { validateFile } from "../../../src/core/schemas/semantic.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "schemas");

interface Expectation {
  code: string;
  path: string;
  scenario: string;
  /** Some rules (change-record naming) only apply when the file path is known. */
  needsFilePath?: boolean;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * The spec quotes pointers at different depths: `/krn` for the offending key,
 * `/gates` for the object holding an unknown transition. An error satisfies an
 * expectation when it points at exactly that place or anywhere below it.
 */
function pointerMatches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const pointer = actual.includes("#") ? actual.slice(actual.indexOf("#") + 1) : actual;
  return pointer === expected || pointer.startsWith(`${expected}/`);
}

/**
 * Scenarios of openspec/specs/kernel (and enforcement, `run/1`) whose document is a fixture: `<schema>/<file>` → SCN id, shown in the test name
 * (SCN tag, packages/cli/CLAUDE.md). A valid fixture is the example the scenario names, with the substitutions the
 * scenario states (ULID ids, URL refs) and concrete values for the placeholders of the document (`<login>`, `sha256:…`);
 * an invalid one is its counter-example, and its `.expect.json` names the same id in `scenario`.
 */
const SCENARIOS: Record<string, string> = {
  "areas/valid-single-area.json": "SCN-KRN-040",
  "areas/invalid-lowercase-area.json": "SCN-KRN-041",
  "change-record/valid-doc-example.json": "SCN-KRN-022",
  "change-record/invalid-risk-without-source.json": "SCN-KRN-023",
  "check/valid-pytest.json": "SCN-KRN-020",
  "check/invalid-level-l2.json": "SCN-KRN-021",
  "config/invalid-pack-without-version.json": "SCN-KRN-009",
  "config/invalid-pack-version-not-range.json": "SCN-KRN-009",
  "config/valid-frontends-claude.json": "SCN-KRN-126",
  "config/invalid-frontends-unknown.json": "SCN-KRN-126",
  "config/invalid-frontends-duplicate.json": "SCN-KRN-126",
  "controller-rules/invalid-unknown-action.json": "SCN-KRN-029",
  "evidence/valid-doc-example.json": "SCN-KRN-024",
  "evidence/invalid-counter-id.json": "SCN-KRN-025",
  "evidence-manifest/valid-doc-example.json": "SCN-KRN-026",
  "evidence-manifest/invalid-verdict-outside-enum.json": "SCN-KRN-027",
  "gate/valid-tests-passed.json": "SCN-KRN-018",
  "lock/invalid-hash-not-sha256.json": "SCN-KRN-011",
  "openspec-rules/valid-doc-example.json": "SCN-KRN-034",
  "openspec-rules/invalid-unknown-operation.json": "SCN-KRN-035",
  "openspec-schema/valid-warrant-sdd.json": "SCN-KRN-036",
  "overlay/valid-security-high.json": "SCN-KRN-016",
  "overlay/invalid-dimension-value.json": "SCN-KRN-017",
  "profile/valid-data-change.json": "SCN-KRN-014",
  "profile/invalid-unknown-transition.json": "SCN-KRN-015",
  "risk-floor/valid-doc-example.json": "SCN-KRN-030",
  "risk-floor/invalid-foreign-dimension-value.json": "SCN-KRN-031",
  "risk-levels/valid-doc-example.json": "SCN-KRN-032",
  "risk-levels/invalid-missing-default.json": "SCN-KRN-033",
  "run/valid-after-start.json": "SCN-ENF-001",
  "run/invalid-event-decision-ask.json": "SCN-ENF-002",
  "run/invalid-event-without-decision.json": "SCN-ENF-002",
  "run/invalid-event-frontend-key.json": "SCN-ENF-003",
  "waiver/valid-doc-example.json": "SCN-KRN-038",
  "waiver/invalid-missing-expires-at.json": "SCN-KRN-039"
};

/** ` (SCN-…)` for a fixture of the table, empty otherwise. */
function tag(schema: string, file: string): string {
  const id = SCENARIOS[`${schema}/${file}`];
  return id === undefined ? "" : ` (${id})`;
}

describe("schema fixtures", () => {
  const dirs = readdirSync(FIXTURES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  it("covers every document schema (task 2.2)", () => {
    expect(dirs).toEqual([...DOCUMENT_SCHEMAS].sort());
  });

  it("every fixture of the scenario table exists, and an invalid one's .expect.json names the same scenario", () => {
    for (const [rel, id] of Object.entries(SCENARIOS)) {
      const [schema = "", file = ""] = rel.split("/");
      expect(readdirSync(join(FIXTURES, schema)), rel).toContain(file);
      if (file.startsWith("invalid-")) {
        const expectation = readJson(join(FIXTURES, schema, file.replace(/\.json$/, ".expect.json"))) as Expectation;
        expect(expectation.scenario, rel).toBe(id);
      }
    }
  });

  for (const schema of dirs) {
    const dir = join(FIXTURES, schema);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".expect.json"));

    describe(schema, () => {
      it("has at least one valid and one invalid fixture", () => {
        expect(files.some((f) => f.startsWith("valid-"))).toBe(true);
        expect(files.some((f) => f.startsWith("invalid-"))).toBe(true);
      });

      for (const file of files.filter((f) => f.startsWith("valid-"))) {
        it(`accepts ${file}${tag(schema, file)}`, () => {
          // No file path: fixture names encode `valid-*`, not the document id,
          // and the change-record naming rule is asserted in semantic.test.ts.
          const result = validateFile(readJson(join(dir, file)));
          if (!result.ok) {
            throw new Error(`expected valid, got: ${JSON.stringify(result.errors, null, 2)}`);
          }
          expect(result.schema.name).toBe(schema);
        });
      }

      for (const file of files.filter((f) => f.startsWith("invalid-"))) {
        it(`rejects ${file}${tag(schema, file)}`, () => {
          const expectation = readJson(
            join(dir, file.replace(/\.json$/, ".expect.json"))
          ) as Expectation;
          const json = readJson(join(dir, file));
          const filePath = expectation.needsFilePath === true ? join(dir, file) : undefined;
          const result = validateFile(json, filePath);

          expect(result.ok, `${schema}/${file} (${expectation.scenario}) should be rejected`).toBe(false);
          if (result.ok) return;

          const hit = result.errors.find(
            (e) => e.code === expectation.code && pointerMatches(e.path, expectation.path)
          );
          if (hit === undefined) {
            throw new Error(
              `${expectation.scenario}: expected ${expectation.code} at ${expectation.path}, got ` +
                JSON.stringify(result.errors, null, 2)
            );
          }
        });
      }
    });
  }
});

describe("controller rules keep document order (SCN-KRN-028)", () => {
  it("reads the core-sdd table back in source order", () => {
    const file = join(FIXTURES, "controller-rules", "valid-doc-example.json");
    const json = readJson(file) as { rules: { id: string }[] };
    expect(validateFile(json).ok).toBe(true);
    expect(json.rules.map((r) => r.id)).toEqual([
      "policy-conflict",
      "gate-failed-hard",
      "gate-failed-waivable",
      "blocking-unknown",
      "missing-artifact",
      "approval-pending",
      "impl-incomplete",
      "awaiting-attestation",
      "verify-incomplete",
      "gaps",
      "done"
    ]);
  });
});
