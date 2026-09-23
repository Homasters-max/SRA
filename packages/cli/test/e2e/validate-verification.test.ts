/**
 * `warrant validate` checks (8), (10), (11), (12) and (13) of REQ-KRN-021: path
 * rules, links between Changes, waivers, evidence and dangling references
 * (SCN-KRN-084, 092, 095, 098, 099, 111, 113, 114). Check (9) is in
 * `validate-ids-head.test.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { openspecAvailable } from "../../src/core/openspec/cli.js";
import { runCli } from "../helpers/cli.js";
import { codes, findError, PACKS, record, useSyncedProject, validate, write } from "../helpers/synced.js";

const hasOpenspec = openspecAvailable();
const project = useSyncedProject();

describe.skipIf(!hasOpenspec)("warrant validate (8): path rules", () => {
  it("reports RULE_SCOPE for a rule confined to openspec/changes/**, and passes a rule on ** (SCN-KRN-095)", async () => {
    const root = project();
    write(root, ".warrant/local/rules/spec-style.json", {
      $schema: "warrant://rule/1",
      id: "spec-style",
      paths: ["openspec/changes/**/*.md"],
      text: "Specs are written in the imperative."
    });
    const bad = await validate(root);
    expect(bad.status).toBe(3);
    expect(codes(bad)).toEqual(["RULE_SCOPE"]);
    expect(findError(bad, "RULE_SCOPE")?.path).toContain(".warrant/local/rules/spec-style.json");

    write(root, ".warrant/local/rules/spec-style.json", {
      $schema: "warrant://rule/1",
      id: "spec-style",
      paths: ["**"],
      text: "Specs are written in the imperative."
    });
    const good = await validate(root);
    expect(good.json?.errors).toEqual([]);
    expect(good.status).toBe(0);
  }, 60_000);

  it("reports a rule whose id is not its file name", async () => {
    const root = project();
    write(root, ".warrant/local/rules/spec-style.json", {
      $schema: "warrant://rule/1",
      id: "other-name",
      paths: ["**"],
      text: "Specs are written in the imperative."
    });
    const run = await validate(root);
    expect(run.status).toBe(3);
    expect(findError(run, "SEMANTIC_INVALID")?.path).toBe(".warrant/local/rules/spec-style.json#/id");
  }, 60_000);
});

describe.skipIf(!hasOpenspec)("warrant validate (10): targets of amends and supersedes", () => {
  it("reports LINK_TARGET_INVALID for an amends target that is not MERGED (SCN-KRN-098)", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "SPECIFIED"));
    write(root, ".warrant/changes/fix-search.json", record("fix-search", "PROPOSED", { amends: ["add-search"] }));
    const run = await validate(root);
    expect(run.status).toBe(3);
    expect(codes(run)).toEqual(["LINK_TARGET_INVALID"]);
    expect(findError(run, "LINK_TARGET_INVALID")?.path).toBe(".warrant/changes/fix-search.json#/amends/0");

    write(root, ".warrant/changes/add-search.json", record("add-search", "MERGED"));
    const merged = await validate(root);
    expect(merged.json?.errors).toEqual([]);
  }, 60_000);

  it("requires supersedes targets to be ABANDONED and to exist", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "MERGED"));
    write(
      root,
      ".warrant/changes/new-search.json",
      record("new-search", "PROPOSED", { supersedes: ["add-search", "no-such-change"] })
    );
    const run = await validate(root);
    const paths = (run.json?.errors as { code: string; path: string }[])
      .filter((e) => e.code === "LINK_TARGET_INVALID")
      .map((e) => e.path);
    expect(paths).toEqual([".warrant/changes/new-search.json#/supersedes/0", ".warrant/changes/new-search.json#/supersedes/1"]);
  }, 60_000);
});

describe.skipIf(!hasOpenspec)("warrant validate (11): waivers", () => {
  function waiver(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      $schema: "warrant://waiver/1",
      id: "WAV-2026-001",
      change: "add-search",
      gate: "analyze-clean",
      reason: "analyze has no producer before phase 4",
      risk: "HIGH",
      compensating_controls: ["maintainer review of PR"],
      owner: "kat",
      approved_by: "human:kat",
      expires_at: "2099-12-31",
      waiver_state: "ACTIVE",
      ...extra
    };
  }

  it("reports WAIVER_INVALID for a gate that is not waivable and for an approver outside roles (SCN-KRN-099)", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "IMPLEMENTING"));
    write(root, ".warrant/waivers/WAV-2026-001.json", waiver({ gate: "scope-valid" }));
    write(root, ".warrant/waivers/WAV-2026-002.json", waiver({ id: "WAV-2026-002", approved_by: "human:bob" }));
    const run = await validate(root);
    expect(run.status).toBe(3);
    const found = (run.json?.errors as { code: string; message: string; path: string }[]).filter(
      (e) => e.code === "WAIVER_INVALID"
    );
    expect(found.map((e) => e.path)).toEqual([
      ".warrant/waivers/WAV-2026-001.json#/gate",
      ".warrant/waivers/WAV-2026-002.json#/approved_by"
    ]);
    expect(found[0]?.message).toContain("not waivable");
    expect(found[1]?.message).toContain("human:bob");
    expect(codes(run)).toEqual(["WAIVER_INVALID", "WAIVER_INVALID"]);
  }, 60_000);

  it("reports a waiver for an unknown change and an unknown gate", async () => {
    const root = project();
    write(root, ".warrant/waivers/WAV-2026-001.json", waiver({ change: "nosuch", gate: "no-such-gate" }));
    const run = await validate(root);
    expect(
      (run.json?.errors as { code: string; path: string }[]).filter((e) => e.code === "WAIVER_INVALID").map((e) => e.path)
    ).toEqual([".warrant/waivers/WAV-2026-001.json#/change", ".warrant/waivers/WAV-2026-001.json#/gate"]);
  }, 60_000);

  it("warns WAIVER_EXPIRED on stderr for an expired ACTIVE waiver and stays ok (SCN-KRN-099)", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "IMPLEMENTING"));
    write(root, ".warrant/waivers/WAV-2026-001.json", waiver({ expires_at: "2020-01-01" }));
    const run = await validate(root);
    expect(run.json?.errors).toEqual([]);
    expect(run.json?.ok).toBe(true);
    expect(run.status).toBe(0);
    expect(run.stderr).toContain("WAIVER_EXPIRED");
    expect(run.stderr).toContain(".warrant/waivers/WAV-2026-001.json");
  }, 60_000);

  it("accepts a PROPOSED waiver without approved_by: nothing to compare with roles yet (REQ-KRN-019, SCN-KRN-111)", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "IMPLEMENTING"));
    const proposed = waiver({ waiver_state: "PROPOSED" });
    delete proposed["approved_by"];
    write(root, ".warrant/waivers/WAV-2026-001.json", proposed);
    const run = await validate(root);
    expect(run.json?.errors).toEqual([]);
    expect(run.json?.ok).toBe(true);
    expect(run.status).toBe(0);

    // The same file in ACTIVE is a schema violation, not a role finding.
    write(root, ".warrant/waivers/WAV-2026-001.json", { ...proposed, waiver_state: "ACTIVE" });
    const active = await validate(root);
    expect(active.status).toBe(3);
    expect(new Set(codes(active))).toEqual(new Set(["SCHEMA_VIOLATION"]));
    expect((active.json?.errors as { path: string }[]).map((e) => e.path)).toContain(
      ".warrant/waivers/WAV-2026-001.json#/approved_by"
    );
  }, 60_000);

  it("reports PACK_FORM_UNKNOWN for targets[]: no gate declares their form in phase 3 (D-13)", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "IMPLEMENTING"));
    write(root, ".warrant/waivers/WAV-2026-001.json", waiver({ targets: [{ path: "src/search.ts" }] }));
    const run = await validate(root);
    expect(codes(run)).toEqual(["PACK_FORM_UNKNOWN"]);
    expect(findError(run, "PACK_FORM_UNKNOWN")?.path).toBe(".warrant/waivers/WAV-2026-001.json#/targets");
  }, 60_000);
});

describe.skipIf(!hasOpenspec)("warrant validate (12): evidence records and manifests", () => {
  const ID_A = "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3";
  const ID_B = "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1B4";
  const DIR = ".warrant/evidence/add-search";

  /** A handwritten record of kind `test-report`, as `check` would write it. */
  function evidence(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      $schema: "warrant://evidence/1",
      id,
      claim: { text: "tests-passed passed for add-search", targets: [] },
      kind: "test-report",
      level: "L1",
      evidence_status: "PROVEN",
      subject: { commit: "abc1234def", base_commit: "abc1234", spec_revision: "openspec/changes/add-search@abc1234def" },
      produced_by: { type: "check", id: "tests-passed", version: "1.0.0" },
      attestation: { type: "none" },
      created_at: "2026-09-22T10:00:00Z",
      metrics: { tests: 387, failures: 0, errors: 0, skipped: 2 },
      ...extra
    };
  }

  function manifest(ids: string[]): Record<string, unknown> {
    return {
      $schema: "warrant://evidence-manifest/1",
      change: "add-search",
      commit: "abc1234def",
      versions: { warrant: "0.2.0", openspec: "1.13.1" },
      evidence: ids
    };
  }

  function seeded(): string {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "IMPLEMENTING"));
    return root;
  }

  it("accepts records whose metrics match the pack form, with raw/ ignored", async () => {
    const root = seeded();
    write(root, `${DIR}/${ID_A}.json`, evidence(ID_A));
    write(root, `${DIR}/manifest.json`, manifest([ID_A]));
    write(root, `${DIR}/raw/tests-passed/junit.xml`, "<testsuites/>\n");
    const run = await validate(root);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
  }, 60_000);

  it("leaves raw output alone in checks (1), (6) and (7) and in fmt (I-76)", async () => {
    const root = seeded();
    write(root, `${DIR}/${ID_A}.json`, evidence(ID_A));
    write(root, `${DIR}/manifest.json`, manifest([ID_A]));
    // What `openspec validate --json` prints: no `$schema`, not canonical.
    write(root, `${DIR}/raw/openspec-validate/stdout.json`, '{"items":[],   "version":"1.0"}');
    // A test report may quote a secret-scanner fixture; raw output is never committed.
    write(root, `${DIR}/raw/tests-passed/junit.xml`, `<testcase name="ghp_${"a".repeat(36)}"/>\n`);
    const run = await validate(root);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    const fmt = await runCli(["fmt", "--check"], root, { WARRANT_PACKS_DIR: PACKS });
    expect(fmt.json?.errors).toEqual([]);
    expect(fmt.status).toBe(0);
  }, 60_000);

  it("reports the pack form violation with the file and /metrics/tests (SCN-KRN-084)", async () => {
    const root = seeded();
    write(root, `${DIR}/${ID_A}.json`, evidence(ID_A, { metrics: { tests: "many", failures: 0, errors: 0, skipped: 0 } }));
    write(root, `${DIR}/manifest.json`, manifest([ID_A]));
    const run = await validate(root);
    expect(run.status).toBe(3);
    expect(run.json?.errors).toEqual([
      expect.objectContaining({ code: "SCHEMA_VIOLATION", path: `${DIR}/${ID_A}.json#/metrics/tests` })
    ]);
  }, 60_000);

  it("reports PACK_FORM_UNKNOWN for non-empty metrics of a kind without a form (SCN-KRN-084)", async () => {
    const root = seeded();
    write(root, `${DIR}/${ID_A}.json`, evidence(ID_A, { kind: "review", metrics: { findings: 3 } }));
    write(root, `${DIR}/${ID_B}.json`, evidence(ID_B, { kind: "review", metrics: {} }));
    write(root, `${DIR}/manifest.json`, manifest([ID_A, ID_B]));
    const run = await validate(root);
    expect(run.json?.errors).toEqual([
      expect.objectContaining({ code: "PACK_FORM_UNKNOWN", path: `${DIR}/${ID_A}.json#/metrics` })
    ]);
  }, 60_000);

  it("takes base_commit and numeric metrics through the kernel schema, and rejects metrics: 5 there (SCN-KRN-092)", async () => {
    const root = seeded();
    // `{ tests, failures }` passes the kernel schema; only the strict core-sdd form asks for more (I-69).
    write(root, `${DIR}/${ID_A}.json`, evidence(ID_A, { metrics: { tests: 387, failures: 0 } }));
    write(root, `${DIR}/${ID_B}.json`, evidence(ID_B, { metrics: 5 }));
    write(root, `${DIR}/manifest.json`, manifest([ID_A, ID_B]));
    const run = await validate(root);
    const paths = (run.json?.errors as { code: string; path: string }[]).map((e) => `${e.code} ${e.path}`);
    expect(paths).toEqual([
      `SCHEMA_VIOLATION ${DIR}/${ID_A}.json#/metrics/errors`,
      `SCHEMA_VIOLATION ${DIR}/${ID_A}.json#/metrics/skipped`,
      `SCHEMA_VIOLATION ${DIR}/${ID_B}.json#/metrics`
    ]);
  }, 60_000);

  it("reports a kind no enabled pack declares", async () => {
    const root = seeded();
    write(root, `${DIR}/${ID_A}.json`, evidence(ID_A, { kind: "mutation-report", metrics: {} }));
    write(root, `${DIR}/manifest.json`, manifest([ID_A]));
    const run = await validate(root);
    expect(run.json?.errors).toEqual([
      expect.objectContaining({ code: "SEMANTIC_INVALID", path: `${DIR}/${ID_A}.json#/kind` })
    ]);
  }, 60_000);

  it("requires manifest.evidence[] to list exactly the records of the directory", async () => {
    const root = seeded();
    write(root, `${DIR}/${ID_A}.json`, evidence(ID_A));
    write(root, `${DIR}/manifest.json`, manifest([ID_B]));
    const run = await validate(root);
    const paths = (run.json?.errors as { code: string; path: string }[]).map((e) => `${e.code} ${e.path}`);
    expect(paths).toEqual([`SEMANTIC_INVALID ${DIR}/manifest.json#/evidence`, `SEMANTIC_INVALID ${DIR}/manifest.json#/evidence/0`]);
  }, 60_000);
});

describe.skipIf(!hasOpenspec)("warrant validate (13): dangling REQ/SCN references", () => {
  const SEARCH_DELTA = `## ADDED Requirements

### Requirement: Search
<!-- id: REQ-SRC-001 -->
The system SHALL find records by name.

#### Scenario: Found
<!-- id: SCN-SRC-002 -->
- **WHEN** a known name is searched
- **THEN** the record is returned
`;

  const SEARCH_SPEC = `# search Specification

## Purpose
Search behaviour for the tests.

## Requirements

### Requirement: Search
<!-- id: REQ-SRC-001 -->
The system SHALL find records by name.

#### Scenario: Found
<!-- id: SCN-SRC-002 -->
- **WHEN** a known name is searched
- **THEN** the record is returned
`;

  function withConfigTests(root: string, tests: string): void {
    const file = path.join(root, ".warrant", "warrant.json");
    const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    write(root, ".warrant/warrant.json", { ...config, paths: { tests } });
  }

  it("reports ID_DANGLING for an undeclared id in tasks.md of an active Change (SCN-KRN-113)", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "SPECIFIED"));
    write(root, "openspec/changes/add-search/proposal.md", "## Why\n\nSearch.\n");
    write(root, "openspec/specs/search/spec.md", SEARCH_SPEC);
    write(
      root,
      "openspec/changes/add-search/tasks.md",
      "## 1. Search\n\n- [ ] 1.1 Implement REQ-SRC-001 (SCN-SRC-002)\n- [ ] 1.2 Cover `SCN-SRC-042`\n"
    );
    const run = await validate(root);
    expect(run.status).toBe(3);
    expect(codes(run)).toEqual(["ID_DANGLING"]);
    const found = findError(run, "ID_DANGLING");
    expect(found?.path).toBe("openspec/changes/add-search/tasks.md");
    expect(found?.message).toContain("SCN-SRC-042");
    expect(found?.message).toContain("line 4");
  }, 60_000);

  it("checks paths.tests only when set, counts archive declarations, skips archived tasks.md (SCN-KRN-114)", async () => {
    const root = project();
    const archived = "openspec/changes/archive/2026-09-20-add-search";
    write(root, `${archived}/proposal.md`, "## Why\n\nSearch.\n");
    write(root, `${archived}/specs/search/spec.md`, SEARCH_DELTA);
    write(root, `${archived}/tasks.md`, "## 1. Search\n\n- [x] 1.1 Implement SCN-SRC-555\n");
    write(root, "tests/search.test.py", "# REQ-SRC-001\ndef test_search():\n    pass  # REQ-SRC-777\n");
    write(root, "tests/fixture.bin", Buffer.from([0x52, 0x45, 0x51, 0x00]).toString("latin1") + "REQ-SRC-778");
    write(root, "tests/huge.txt", `REQ-SRC-779\n${"x".repeat(1024 * 1024)}`);

    const without = await validate(root);
    expect(without.json?.errors).toEqual([]);
    expect(without.json?.ok).toBe(true);

    withConfigTests(root, "tests");
    const run = await validate(root);
    expect(run.status).toBe(3);
    const dangling = (run.json?.errors as { code: string; message: string; path: string }[]).filter(
      (e) => e.code === "ID_DANGLING"
    );
    expect(dangling.map((e) => `${e.path} ${e.message.split(" ")[0] ?? ""}`)).toEqual(["tests/search.test.py REQ-SRC-777"]);
    expect(dangling[0]?.message).toContain("line 3");
    expect(codes(run)).toEqual(["ID_DANGLING"]);
  }, 120_000);
});
