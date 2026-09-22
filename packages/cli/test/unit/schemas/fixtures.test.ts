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

describe("schema fixtures", () => {
  const dirs = readdirSync(FIXTURES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  it("covers every document schema (task 2.2)", () => {
    expect(dirs).toEqual([...DOCUMENT_SCHEMAS].sort());
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
        it(`accepts ${file}`, () => {
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
        it(`rejects ${file}`, () => {
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
