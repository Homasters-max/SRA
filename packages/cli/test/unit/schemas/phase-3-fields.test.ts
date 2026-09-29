/**
 * Fields added to the kernel schemas in phase 3 (debt A/B after ADR-0016…0022):
 * every addition is optional, so `/1` stays `/1` (REQ-KRN-001).
 *
 * The fixtures under `test/fixtures/schemas/<schema>/` carry the documents;
 * this file names the scenarios they stand for.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateFile } from "../../../src/core/schemas/semantic.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "schemas");

function fixture(schema: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, schema, file), "utf8")) as Record<string, unknown>;
}

/** Error pointers of a rejected document; an empty list for an accepted one. */
function pointers(json: unknown): string[] {
  const result = validateFile(json);
  if (result.ok) return [];
  return result.errors.map((e) => {
    const p = e.path ?? "";
    return p.includes("#") ? p.slice(p.indexOf("#") + 1) : p;
  });
}

function expectValid(json: unknown): void {
  const result = validateFile(json);
  if (!result.ok) throw new Error(`expected valid, got: ${JSON.stringify(result.errors, null, 2)}`);
}

describe("evidence/1: metrics and base_commit", () => {
  it("accepts metrics of any object shape: the shape is the pack's (SCN-KRN-084, kernel part)", () => {
    expectValid(fixture("evidence", "valid-metrics-shape-left-to-pack.json"));
  });

  it("accepts subject.base_commit and numeric metrics (SCN-KRN-092)", () => {
    expectValid(fixture("evidence", "valid-metrics-base-commit.json"));
  });

  it("rejects metrics that is not an object (SCN-KRN-092)", () => {
    expect(pointers(fixture("evidence", "invalid-metrics-not-object.json"))).toContain("/metrics");
  });
});

describe("evidence/1: subject.tree (phase-4c, ADR-0037 п. 2)", () => {
  const withSubject = (extra: Record<string, unknown>): Record<string, unknown> => {
    const doc = fixture("evidence", "valid-metrics-base-commit.json");
    return { ...doc, subject: { ...(doc["subject"] as Record<string, unknown>), ...extra } };
  };

  it("accepts a tree id of 40 or 64 lowercase hex characters, rejects anything else, and never beside spec_tree (SCN-KRN-141)", () => {
    expectValid(withSubject({ tree: "0123456789abcdef0123456789abcdef01234567" }));
    expectValid(withSubject({ tree: "a".repeat(64) }));
    expect(pointers(withSubject({ tree: "HEAD^{tree}" }))).toContain("/subject/tree");
    expect(pointers(withSubject({ tree: "A".repeat(40) }))).toContain("/subject/tree");
    expect(pointers(withSubject({ tree: "a".repeat(41) }))).toContain("/subject/tree");
    expect(pointers(withSubject({ tree: "a".repeat(40), spec_tree: `sha256:${"b".repeat(64)}` }))).toContain("/subject");
  });
});

describe("config/1: defaults.check_timeout_s", () => {
  it("accepts a positive integer and a config without defaults (SCN-KRN-086)", () => {
    expectValid(fixture("config", "valid-defaults-timeout.json"));
    expectValid(fixture("config", "valid-minimal.json"));
  });

  it("rejects 0 and a string (SCN-KRN-086)", () => {
    expect(pointers(fixture("config", "invalid-timeout-zero.json"))).toContain("/defaults/check_timeout_s");
    expect(pointers(fixture("config", "invalid-timeout-string.json"))).toContain("/defaults/check_timeout_s");
  });
});

describe("lock/1: skills.*.source", () => {
  it("accepts a bundled skill whose path is relative to the pack (SCN-KRN-087, schema part)", () => {
    expectValid(fixture("lock", "valid-bundled-skill.json"));
  });

  it("rejects a source other than bundled", () => {
    expect(pointers(fixture("lock", "invalid-skill-source.json"))).toContain(
      "/skills/specification~1adversarial-review/source"
    );
  });
});

describe("pack/1: provides.rules and two forms of evidence_kinds", () => {
  it("accepts a kind id next to a kind object with metrics_schema (SCN-KRN-088)", () => {
    expectValid(fixture("pack", "valid-evidence-kind-forms.json"));
  });

  it("rejects a kind object without kind or with metrics_schema outside the pack (SCN-KRN-088)", () => {
    for (const file of ["invalid-evidence-kind-without-kind.json", "invalid-metrics-schema-outside-pack.json"]) {
      const found = pointers(fixture("pack", file));
      expect(found.length, file).toBeGreaterThan(0);
      expect(
        found.every((p) => p === "/provides/evidence_kinds/1" || p.startsWith("/provides/evidence_kinds/1/")),
        `${file}: ${found.join(", ")}`
      ).toBe(true);
    }
  });
});

describe("check/1: scoped_command, placeholders and execution", () => {
  it("accepts the mutation example of 06 section 2 with four execution fields (SCN-KRN-089)", () => {
    expectValid(fixture("check", "valid-mutation-execution.json"));
  });

  it("accepts {change} and {out} inside run.command", () => {
    expectValid(fixture("check", "valid-change-placeholder.json"));
  });

  it("rejects {base} and {paths} in run.command, pointing at the element (SCN-KRN-090)", () => {
    expect(pointers(fixture("check", "invalid-unknown-placeholder.json"))).toContain("/run/command/2");
    expect(pointers(fixture("check", "invalid-paths-in-command.json"))).toContain("/run/command/2");
  });

  it("rejects an unknown placeholder in scoped_command and a placeholder hidden on a later line", () => {
    const base = fixture("check", "valid-mutation-execution.json");
    const run = base["run"] as Record<string, unknown>;
    expect(pointers({ ...base, run: { ...run, scoped_command: ["mutmut", "{paths}", "{outdir}"] } })).toContain(
      "/run/scoped_command/2"
    );
    expect(pointers({ ...base, run: { command: ["node", "-e", "x\n{base}"] } })).toContain("/run/command/2");
  });

  it("leaves braces that are not a {name} token alone", () => {
    const base = fixture("check", "valid-mutation-execution.json");
    expectValid({ ...base, run: { command: ["node", "-e", "setTimeout(() => {}, 1000); const o = { a: 1 }"] } });
  });

  it("rejects an execution.local outside allowed | scoped-only | ci-only", () => {
    expect(pointers(fixture("check", "invalid-execution-local.json"))).toContain("/execution/local");
  });
});

describe("change-record/1: amends and supersedes", () => {
  it("accepts kebab-case Change ids (SCN-KRN-091)", () => {
    expectValid(fixture("change-record", "valid-links.json"));
  });

  it("rejects a name that is not kebab-case (SCN-KRN-091)", () => {
    expect(pointers(fixture("change-record", "invalid-amends-not-kebab.json"))).toContain("/amends/0");
  });

  it("accepts a risk value from a named human", () => {
    const record = fixture("change-record", "valid-doc-example.json");
    expectValid({ ...record, classification: { risk: { security_impact: { value: "HIGH", from: "human:kat" } } } });
  });
});

describe("waiver/1: targets", () => {
  it("accepts the partial waiver example of 05 section 7 (SCN-KRN-093)", () => {
    expectValid(fixture("waiver", "valid-partial-targets.json"));
  });

  it("rejects a target that is not an object (SCN-KRN-093)", () => {
    expect(pointers(fixture("waiver", "invalid-target-not-object.json"))).toContain("/targets/0");
  });
});

describe("phase-3b: ref of a risk value and approved_by of a PROPOSED waiver", () => {
  it("accepts a ref on a human risk value and rejects it on a floor value (SCN-KRN-110)", () => {
    expectValid(fixture("change-record", "valid-risk-human-ref.json"));
    expect(pointers(fixture("change-record", "invalid-risk-ref-not-human.json"))).toContain(
      "/classification/risk/blast_radius"
    );
  });

  it("rejects a ref with a proposer source and a ref that is not a URL (SCN-KRN-110)", () => {
    const record = fixture("change-record", "valid-doc-example.json");
    const withRisk = (entry: Record<string, unknown>): Record<string, unknown> => ({
      ...record,
      classification: { risk: { blast_radius: entry } }
    });
    const ref = "https://github.com/o/r/pull/7#issuecomment-1";
    expect(pointers(withRisk({ value: "LOCAL", from: "proposer:llm", ref }))).toContain("/classification/risk/blast_radius");
    expect(pointers(withRisk({ value: "LOCAL", from: "human:kat", ref: "not a url" }))).toContain(
      "/classification/risk/blast_radius/ref"
    );
  });

  it("accepts a PROPOSED waiver without approved_by and rejects the same waiver in ACTIVE (SCN-KRN-111)", () => {
    expectValid(fixture("waiver", "valid-proposed-without-approver.json"));
    expect(pointers(fixture("waiver", "invalid-active-without-approver.json"))).toContain("/approved_by");
    const proposed = fixture("waiver", "valid-proposed-without-approver.json");
    for (const state of ["REVOKED", "EXPIRED"]) {
      expect(pointers({ ...proposed, waiver_state: state }), state).toContain("/approved_by");
    }
  });
});

describe("slice-fixes: resolved_as and ref of an UNKNOWN", () => {
  const unknown = {
    id: "UNK-SRC-001",
    text: "Можно ли переписывать историю?",
    blocking: true,
    resolution: "Нет",
    resolved_as: "decision",
    ref: "https://github.com/o/r/pull/7#issuecomment-1"
  };
  const withUnknown = (entry: Record<string, unknown>): Record<string, unknown> => ({
    ...fixture("change-record", "valid-doc-example.json"),
    unknowns: [entry]
  });
  const underFirst = (json: unknown): boolean => pointers(json).some((p) => p.startsWith("/unknowns/0"));

  it("accepts a closed UNKNOWN with resolved_as and ref (SCN-KRN-143)", () => {
    expectValid(withUnknown(unknown));
  });

  it("rejects resolved_as outside the enum and ref or resolved_as without resolution (SCN-KRN-143)", () => {
    expect(underFirst(withUnknown({ ...unknown, resolved_as: "guess" }))).toBe(true);
    const { resolution: _answer, ...open } = unknown;
    expect(pointers(withUnknown(open))).toContain("/unknowns/0");
    const { resolved_as: _kind, ...refOnly } = open;
    expect(pointers(withUnknown(refOnly))).toContain("/unknowns/0");
    expect(underFirst(withUnknown({ ...unknown, ref: "ftp://example.com/x" }))).toBe(true);
  });
});

describe("rule/1", () => {
  it("accepts a rule with enforced_by (SCN-KRN-108)", () => {
    expectValid(fixture("rule", "valid-json-canonical.json"));
    expectValid(fixture("rule", "valid-without-enforced-by.json"));
  });

  it("rejects an empty or missing paths (SCN-KRN-109)", () => {
    expect(pointers(fixture("rule", "invalid-empty-paths.json"))).toContain("/paths");
    expect(pointers(fixture("rule", "invalid-missing-paths.json"))).toContain("/paths");
  });
});

describe("gate/1: requires_evidence[].check (ADR-0044 п. 6)", () => {
  const withRequirement = (entry: Record<string, unknown>): Record<string, unknown> => ({
    ...fixture("gate", "valid-tests-passed.json"),
    requires_evidence: [entry]
  });

  it("accepts a kebab-case check id and rejects any other (SCN-KRN-159)", () => {
    expectValid(withRequirement({ kind: "test-report", status: "PROVEN", check: "dev-check" }));
    expect(pointers(withRequirement({ kind: "test-report", status: "PROVEN", check: "Dev Check" }))).toContain(
      "/requires_evidence/0/check"
    );
  });
});
