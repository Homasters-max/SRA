/**
 * `warrant validate` checks (8), (10), (11), (12) and (13) of REQ-KRN-021 in
 * the test process: path rules, links between Changes, waivers, evidence and
 * dangling references (SCN-KRN-084, 092, 095, 098, 099, 111, 113, 114). Check (9)
 * is in `validate-ids-head.test.ts`. Moved from e2e (ADR-0025, task 5.2).
 */
import { describe, expect, it } from "vitest";

import { runFmt } from "../../../src/commands/fmt.js";
import type { CliError } from "../../../src/core/errors.js";
import type { CommandResult } from "../../../src/io/output.js";
import { deltaSpecMarkdown, type ModelRequirement } from "../helpers/fakes/spec-model.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { errorCodes, validate } from "../helpers/validate.js";

const project = useProjectBuilder();

function synced(): Promise<ProjectBuilder> {
  return project().synced();
}

function findError(run: CommandResult, code: string): CliError | undefined {
  return run.errors.find((e) => e.code === code);
}

describe("warrant validate (8): path rules", () => {
  it("reports RULE_SCOPE for a rule confined to openspec/changes/**, and passes a rule on ** (SCN-KRN-095)", async () => {
    const p = await synced();
    p.write(".warrant/local/rules/spec-style.json", {
      $schema: "warrant://rule/1",
      id: "spec-style",
      paths: ["openspec/changes/**/*.md"],
      text: "Specs are written in the imperative."
    });
    const bad = await validate(p);
    expect(bad.exitCode).toBe(3);
    expect(errorCodes(bad)).toEqual(["RULE_SCOPE"]);
    expect(findError(bad, "RULE_SCOPE")?.path).toContain(".warrant/local/rules/spec-style.json");

    p.write(".warrant/local/rules/spec-style.json", {
      $schema: "warrant://rule/1",
      id: "spec-style",
      paths: ["**"],
      text: "Specs are written in the imperative."
    });
    // A rule on ** is delivered through AGENTS.md, which `sync` generates (REQ-KRN-033).
    await p.synced();
    const good = await validate(p);
    expect(good.errors).toEqual([]);
    expect(good.exitCode).toBe(0);
  });

  it("reports a rule whose id is not its file name", async () => {
    const p = await synced();
    p.write(".warrant/local/rules/spec-style.json", {
      $schema: "warrant://rule/1",
      id: "other-name",
      paths: ["**"],
      text: "Specs are written in the imperative."
    });
    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    expect(findError(run, "SEMANTIC_INVALID")?.path).toBe(".warrant/local/rules/spec-style.json#/id");
  });
});

describe("warrant validate (10): targets of amends and supersedes", () => {
  it("reports LINK_TARGET_INVALID for an amends target that is not MERGED (SCN-KRN-098)", async () => {
    const p = await synced();
    p.withRecord("add-search", "SPECIFIED").withRecord("fix-search", "PROPOSED", { amends: ["add-search"] });
    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    expect(errorCodes(run)).toEqual(["LINK_TARGET_INVALID"]);
    expect(findError(run, "LINK_TARGET_INVALID")?.path).toBe(".warrant/changes/fix-search.json#/amends/0");

    p.withRecord("add-search", "MERGED");
    const merged = await validate(p);
    expect(merged.errors).toEqual([]);
  });

  it("requires supersedes targets to be ABANDONED and to exist", async () => {
    const p = await synced();
    p.withRecord("add-search", "MERGED").withRecord("new-search", "PROPOSED", { supersedes: ["add-search", "no-such-change"] });
    const run = await validate(p);
    const paths = run.errors.filter((e) => e.code === "LINK_TARGET_INVALID").map((e) => e.path);
    expect(paths).toEqual([".warrant/changes/new-search.json#/supersedes/0", ".warrant/changes/new-search.json#/supersedes/1"]);
  });
});

describe("warrant validate (11): waivers", () => {
  function waiver(extra: Record<string, unknown>): Record<string, unknown> & { id: string } {
    return {
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
    const p = await synced();
    p.withRecord("add-search", "IMPLEMENTING")
      .withWaiver(waiver({ gate: "scope-valid" }))
      .withWaiver(waiver({ id: "WAV-2026-002", approved_by: "human:bob" }));
    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    const found = run.errors.filter((e) => e.code === "WAIVER_INVALID");
    expect(found.map((e) => e.path)).toEqual([
      ".warrant/waivers/WAV-2026-001.json#/gate",
      ".warrant/waivers/WAV-2026-002.json#/approved_by"
    ]);
    expect(found[0]?.message).toContain("not waivable");
    expect(found[1]?.message).toContain("human:bob");
    expect(errorCodes(run)).toEqual(["WAIVER_INVALID", "WAIVER_INVALID"]);
  });

  it("reports a waiver for an unknown change and an unknown gate", async () => {
    const p = await synced();
    p.withWaiver(waiver({ change: "nosuch", gate: "no-such-gate" }));
    const run = await validate(p);
    expect(run.errors.filter((e) => e.code === "WAIVER_INVALID").map((e) => e.path)).toEqual([
      ".warrant/waivers/WAV-2026-001.json#/change",
      ".warrant/waivers/WAV-2026-001.json#/gate"
    ]);
  });

  it("warns WAIVER_EXPIRED on stderr for an expired ACTIVE waiver and stays ok (SCN-KRN-099)", async () => {
    const p = await synced();
    p.withRecord("add-search", "IMPLEMENTING").withWaiver(waiver({ expires_at: "2020-01-01" }));
    const run = await validate(p);
    expect(run.errors).toEqual([]);
    expect(run.ok).toBe(true);
    expect(run.exitCode).toBe(0);
    const stderr = p.warnings.join("");
    expect(stderr).toContain("WAIVER_EXPIRED");
    expect(stderr).toContain(".warrant/waivers/WAV-2026-001.json");
  });

  it("accepts a PROPOSED waiver without approved_by: nothing to compare with roles yet (REQ-KRN-019, SCN-KRN-111)", async () => {
    const p = await synced();
    const proposed = waiver({ waiver_state: "PROPOSED" });
    delete proposed["approved_by"];
    p.withRecord("add-search", "IMPLEMENTING").withWaiver(proposed);
    const run = await validate(p);
    expect(run.errors).toEqual([]);
    expect(run.ok).toBe(true);
    expect(run.exitCode).toBe(0);

    // The same file in ACTIVE is a schema violation, not a role finding.
    p.withWaiver({ ...proposed, waiver_state: "ACTIVE" });
    const active = await validate(p);
    expect(active.exitCode).toBe(3);
    expect(new Set(errorCodes(active))).toEqual(new Set(["SCHEMA_VIOLATION"]));
    expect(active.errors.map((e) => e.path)).toContain(".warrant/waivers/WAV-2026-001.json#/approved_by");
  });

  it("reports PACK_FORM_UNKNOWN for targets[]: no gate declares their form in phase 3 (D-13)", async () => {
    const p = await synced();
    p.withRecord("add-search", "IMPLEMENTING").withWaiver(waiver({ targets: [{ path: "src/search.ts" }] }));
    const run = await validate(p);
    expect(errorCodes(run)).toEqual(["PACK_FORM_UNKNOWN"]);
    expect(findError(run, "PACK_FORM_UNKNOWN")?.path).toBe(".warrant/waivers/WAV-2026-001.json#/targets");
  });
});

describe("warrant validate (12): evidence records and manifests", () => {
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

  async function seeded(): Promise<ProjectBuilder> {
    return (await synced()).withRecord("add-search", "IMPLEMENTING");
  }

  it("accepts records whose metrics match the pack form, with raw/ ignored", async () => {
    const p = await seeded();
    p.write(`${DIR}/${ID_A}.json`, evidence(ID_A))
      .write(`${DIR}/manifest.json`, manifest([ID_A]))
      .write(`${DIR}/raw/tests-passed/junit.xml`, "<testsuites/>\n");
    const run = await validate(p);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
  });

  it("leaves raw output alone in checks (1), (6) and (7) and in fmt (I-76)", async () => {
    const p = await seeded();
    p.write(`${DIR}/${ID_A}.json`, evidence(ID_A)).write(`${DIR}/manifest.json`, manifest([ID_A]));
    // What `openspec validate --json` prints: no `$schema`, not canonical.
    p.write(`${DIR}/raw/openspec-validate/stdout.json`, '{"items":[],   "version":"1.0"}');
    // A test report may quote a secret-scanner fixture; raw output is never committed.
    p.write(`${DIR}/raw/tests-passed/junit.xml`, `<testcase name="ghp_${"a".repeat(36)}"/>\n`);
    const run = await validate(p);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    const fmt = await invoke(() => runFmt(p.ctx, [], { check: true }));
    expect(fmt.errors).toEqual([]);
    expect(fmt.exitCode).toBe(0);
  });

  it("reports the pack form violation with the file and /metrics/tests (SCN-KRN-084)", async () => {
    const p = await seeded();
    p.write(`${DIR}/${ID_A}.json`, evidence(ID_A, { metrics: { tests: "many", failures: 0, errors: 0, skipped: 0 } }))
      .write(`${DIR}/manifest.json`, manifest([ID_A]));
    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    expect(run.errors).toEqual([
      expect.objectContaining({ code: "SCHEMA_VIOLATION", path: `${DIR}/${ID_A}.json#/metrics/tests` })
    ]);
  });

  it("reports PACK_FORM_UNKNOWN for non-empty metrics of a kind without a form (SCN-KRN-084)", async () => {
    const p = await seeded();
    p.write(`${DIR}/${ID_A}.json`, evidence(ID_A, { kind: "human-approval", metrics: { findings: 3 } }))
      .write(`${DIR}/${ID_B}.json`, evidence(ID_B, { kind: "human-approval", metrics: {} }))
      .write(`${DIR}/manifest.json`, manifest([ID_A, ID_B]));
    const run = await validate(p);
    expect(run.errors).toEqual([
      expect.objectContaining({ code: "PACK_FORM_UNKNOWN", path: `${DIR}/${ID_A}.json#/metrics` })
    ]);
  });

  it("judges review metrics by evidence/review.metrics.schema.json: a string count is SCHEMA_VIOLATION, numbers pass (SCN-SDD-024)", async () => {
    const p = await seeded();
    /** A record of kind `review` in the shape `run submit` writes (REQ-ENF-007). */
    const review = (id: string, metrics: Record<string, unknown>): Record<string, unknown> =>
      evidence(id, {
        kind: "review",
        level: "L2",
        subject: { commit: "abc1234def", spec_revision: "openspec/changes/add-search@abc1234def", spec_tree: `sha256:${"2".repeat(64)}` },
        produced_by: { type: "skill", id: "specification/adversarial-review", version: "0.2.0", run: "RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y" },
        limitations: ["produced locally, unattested", "same model family as author"],
        metrics
      });
    p.write(`${DIR}/${ID_A}.json`, review(ID_A, { BLOCKER: "one", MAJOR: 0, MINOR: 0, INFO: 0 }))
      .write(`${DIR}/${ID_B}.json`, review(ID_B, { BLOCKER: 0, MAJOR: 1, MINOR: 0, INFO: 2 }))
      .write(`${DIR}/manifest.json`, manifest([ID_A, ID_B]));
    const run = await validate(p);
    expect(run.errors).toEqual([
      expect.objectContaining({ code: "SCHEMA_VIOLATION", path: `${DIR}/${ID_A}.json#/metrics/BLOCKER` })
    ]);
  });

  it("takes base_commit and numeric metrics through the kernel schema, and rejects metrics: 5 there (SCN-KRN-092)", async () => {
    const p = await seeded();
    // `{ tests, failures }` passes the kernel schema; only the strict core-sdd form asks for more (I-69).
    p.write(`${DIR}/${ID_A}.json`, evidence(ID_A, { metrics: { tests: 387, failures: 0 } }))
      .write(`${DIR}/${ID_B}.json`, evidence(ID_B, { metrics: 5 }))
      .write(`${DIR}/manifest.json`, manifest([ID_A, ID_B]));
    const run = await validate(p);
    const paths = run.errors.map((e) => `${e.code} ${e.path ?? ""}`);
    expect(paths).toEqual([
      `SCHEMA_VIOLATION ${DIR}/${ID_A}.json#/metrics/errors`,
      `SCHEMA_VIOLATION ${DIR}/${ID_A}.json#/metrics/skipped`,
      `SCHEMA_VIOLATION ${DIR}/${ID_B}.json#/metrics`
    ]);
  });

  it("reports a kind no enabled pack declares", async () => {
    const p = await seeded();
    p.write(`${DIR}/${ID_A}.json`, evidence(ID_A, { kind: "mutation-report", metrics: {} }))
      .write(`${DIR}/manifest.json`, manifest([ID_A]));
    const run = await validate(p);
    expect(run.errors).toEqual([
      expect.objectContaining({ code: "SEMANTIC_INVALID", path: `${DIR}/${ID_A}.json#/kind` })
    ]);
  });

  it("requires manifest.evidence[] to list exactly the records of the directory", async () => {
    const p = await seeded();
    p.write(`${DIR}/${ID_A}.json`, evidence(ID_A)).write(`${DIR}/manifest.json`, manifest([ID_B]));
    const run = await validate(p);
    const paths = run.errors.map((e) => `${e.code} ${e.path ?? ""}`);
    expect(paths).toEqual([`SEMANTIC_INVALID ${DIR}/manifest.json#/evidence`, `SEMANTIC_INVALID ${DIR}/manifest.json#/evidence/0`]);
  });
});

describe("warrant validate (13): dangling REQ/SCN references", () => {
  /** REQ-SRC-001 with SCN-SRC-002: the main spec `search`, and the delta of the archived `add-search`. */
  const SEARCH: ModelRequirement = {
    name: "Search",
    id: "REQ-SRC-001",
    body: "The system SHALL find records by name.",
    scenarios: [{ name: "Found", id: "SCN-SRC-002", steps: "- **WHEN** a known name is searched\n- **THEN** the record is returned" }]
  };

  function withConfigTests(p: ProjectBuilder, tests: string): void {
    const config = JSON.parse(p.read(".warrant/warrant.json")) as Record<string, unknown>;
    p.write(".warrant/warrant.json", { ...config, paths: { tests } });
  }

  it("reports ID_DANGLING for an undeclared id in tasks.md of an active Change (SCN-KRN-113)", async () => {
    const p = await synced();
    p.withRecord("add-search", "SPECIFIED")
      .withChange("add-search", {
        proposal: "Search.",
        tasks: "## 1. Search\n\n- [ ] 1.1 Implement REQ-SRC-001 (SCN-SRC-002)\n- [ ] 1.2 Cover `SCN-SRC-042`\n"
      })
      .withSpec("search", [SEARCH], "Search behaviour for the tests.");
    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    expect(errorCodes(run)).toEqual(["ID_DANGLING"]);
    const found = findError(run, "ID_DANGLING");
    expect(found?.path).toBe("openspec/changes/add-search/tasks.md");
    expect(found?.message).toContain("SCN-SRC-042");
    expect(found?.message).toContain("line 4");
  });

  it("checks paths.tests only when set, counts archive declarations, skips archived tasks.md (SCN-KRN-114)", async () => {
    const p = await synced();
    const archived = "openspec/changes/archive/2026-09-20-add-search";
    // An archived Change is not in `openspec list`, so `FakeOpenSpec` does not learn it.
    p.write(`${archived}/proposal.md`, "## Why\n\nSearch.\n")
      .write(`${archived}/specs/search/spec.md`, deltaSpecMarkdown([SEARCH]))
      .write(`${archived}/tasks.md`, "## 1. Search\n\n- [x] 1.1 Implement SCN-SRC-555\n")
      .write("tests/search.test.py", "# REQ-SRC-001\ndef test_search():\n    pass  # REQ-SRC-777\n")
      .write("tests/fixture.bin", Buffer.from([0x52, 0x45, 0x51, 0x00]).toString("latin1") + "REQ-SRC-778")
      .write("tests/huge.txt", `REQ-SRC-779\n${"x".repeat(1024 * 1024)}`);

    const without = await validate(p);
    expect(without.errors).toEqual([]);
    expect(without.ok).toBe(true);

    withConfigTests(p, "tests");
    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    const dangling = run.errors.filter((e) => e.code === "ID_DANGLING");
    expect(dangling.map((e) => `${e.path ?? ""} ${e.message.split(" ")[0] ?? ""}`)).toEqual(["tests/search.test.py REQ-SRC-777"]);
    expect(dangling[0]?.message).toContain("line 3");
    expect(errorCodes(run)).toEqual(["ID_DANGLING"]);
  });
});
