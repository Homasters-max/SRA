/**
 * Evidence records, manifest, attestation and the state directory
 * (REQ-VER-001, design §6, §7; SCN-VER-002).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { bytesHash } from "../../../src/core/canon/hash.js";
import { attestationFromEnv } from "../../../src/core/evidence/attestation.js";
import { buildManifest } from "../../../src/core/evidence/manifest.js";
import {
  buildCheckRecord,
  collectArtifacts,
  contextHash,
  type CheckRecordInput
} from "../../../src/core/evidence/record.js";
import { evidenceDir, listRecordIds, rawDir } from "../../../src/core/evidence/store.js";
import { projectUri, stateDir } from "../../../src/core/fs.js";
import { validateDocument } from "../../../src/core/schemas/loader.js";
import { makeTempDir, removeDir } from "../../helpers/cli.js";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

const POLICY_HASH = `sha256:${"a".repeat(64)}`;

function input(extra: Partial<CheckRecordInput> = {}): CheckRecordInput {
  return {
    id: "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3",
    change: "add-search",
    check: { id: "tests-passed", version: "1.0.0", level: "L1" },
    kind: "test-report",
    status: "PROVEN",
    metrics: { tests: 3, failures: 0, errors: 0, skipped: 0 },
    limitations: [],
    commit: "abc1234def",
    baseCommit: "abc1234",
    attestation: { type: "none" },
    effectivePolicyHash: POLICY_HASH,
    argv: ["npm", "test", "--", "--outputFile=.warrant/evidence/add-search/raw/tests-passed/junit.xml"],
    artifacts: [{ uri: ".warrant/evidence/add-search/raw/tests-passed/junit.xml", sha256: `sha256:${"b".repeat(64)}` }],
    createdAt: "2026-09-22T10:00:00.000Z",
    ...extra
  };
}

describe("buildCheckRecord", () => {
  it("builds a record that passes warrant://evidence/1 with every field of design §6", () => {
    const record = buildCheckRecord(input());
    expect(validateDocument(record).ok).toBe(true);
    expect(record).toMatchObject({
      id: "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3",
      claim: { text: "tests-passed passed for add-search", targets: [] },
      kind: "test-report",
      level: "L1",
      evidence_status: "PROVEN",
      subject: {
        commit: "abc1234def",
        base_commit: "abc1234",
        spec_revision: "openspec/changes/add-search@abc1234def",
        dataset_snapshot: null
      },
      produced_by: { type: "check", id: "tests-passed", version: "1.0.0" },
      attestation: { type: "none" },
      effective_policy_hash: POLICY_HASH,
      metrics: { tests: 3, failures: 0, errors: 0, skipped: 0 }
    });
    // No Run in phase 3 (REQ-VER-001).
    expect(record["produced_by"]).not.toHaveProperty("run");
  });

  it("omits base_commit and metrics when there are none, and records the nogit limitation as given", () => {
    const record = buildCheckRecord(
      input({ baseCommit: undefined, metrics: undefined, commit: "nogit", limitations: ["no git: commit unknown"] })
    );
    expect(validateDocument(record).ok).toBe(true);
    expect(record["subject"]).not.toHaveProperty("base_commit");
    expect(record).not.toHaveProperty("metrics");
    expect(record["limitations"]).toEqual(["no git: commit unknown"]);
  });

  it("hashes the context {change, commit, check@version, effective_policy_hash, argv}", () => {
    const record = buildCheckRecord(input());
    const expected = contextHash({
      change: "add-search",
      commit: "abc1234def",
      check: "tests-passed@1.0.0",
      effective_policy_hash: POLICY_HASH,
      argv: input().argv
    });
    expect(record["context_hash"]).toBe(expected);
    expect(buildCheckRecord(input({ argv: ["npm", "test"] }))["context_hash"]).not.toBe(expected);
    expect(buildCheckRecord(input({ commit: "fff0000" }))["context_hash"]).not.toBe(expected);
    // created_at and the id are not part of the context.
    expect(buildCheckRecord(input({ createdAt: "2026-09-23T00:00:00.000Z" }))["context_hash"]).toBe(expected);
  });
});

describe("attestationFromEnv (P-15, design §7)", () => {
  it("is none outside CI", () => {
    expect(attestationFromEnv({})).toEqual({ type: "none" });
  });

  it("is ci with the run URL under GitHub Actions (SCN-VER-002)", () => {
    expect(
      attestationFromEnv({
        GITHUB_ACTIONS: "true",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_RUN_ID: "42"
      })
    ).toEqual({ type: "ci", ref: "https://github.com/o/r/actions/runs/42" });
  });

  it("is none when any of the four variables is missing or GITHUB_ACTIONS is not true", () => {
    const full = { GITHUB_ACTIONS: "true", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "42" };
    for (const key of Object.keys(full)) {
      expect(attestationFromEnv({ ...full, [key]: "" })).toEqual({ type: "none" });
    }
    expect(attestationFromEnv({ ...full, GITHUB_ACTIONS: "1" })).toEqual({ type: "none" });
  });
});

describe("buildManifest", () => {
  it("sorts evidence, updates commit and versions, and keeps runs and gates", () => {
    const previous = {
      $schema: "warrant://evidence-manifest/1",
      change: "add-search",
      commit: "old",
      versions: { warrant: "0.1.0", openspec: "1.13.0" },
      runs: ["RUN-01J8Z3M5K9X7Q2R4T6V8W0Y1A3"],
      evidence: ["EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3"],
      gates: { "spec-valid": "PASS" }
    };
    const manifest = buildManifest(previous, {
      change: "add-search",
      commit: "new",
      versions: { warrant: "0.2.0", openspec: "1.13.1", effective_policy_hash: POLICY_HASH },
      evidence: ["EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1B4", "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3"]
    });
    expect(validateDocument(manifest).ok).toBe(true);
    expect(manifest).toEqual({
      $schema: "warrant://evidence-manifest/1",
      change: "add-search",
      commit: "new",
      versions: { warrant: "0.2.0", openspec: "1.13.1", effective_policy_hash: POLICY_HASH },
      runs: ["RUN-01J8Z3M5K9X7Q2R4T6V8W0Y1A3"],
      evidence: ["EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3", "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1B4"],
      gates: { "spec-valid": "PASS" }
    });
  });
});

describe("store", () => {
  it("puts <state> at .warrant unless WARRANT_STATE_DIR is set", () => {
    const root = path.resolve("/project");
    expect(stateDir(root, {})).toBe(path.join(root, ".warrant"));
    expect(stateDir(root, { WARRANT_STATE_DIR: "../state" })).toBe(path.resolve(root, "../state"));
    expect(evidenceDir(root, "add-search", {})).toBe(path.join(root, ".warrant", "evidence", "add-search"));
    expect(rawDir(root, "add-search", "tests-passed", {})).toBe(
      path.join(root, ".warrant", "evidence", "add-search", "raw", "tests-passed")
    );
  });

  it("references files inside the project relatively and outside it by file:// URI", () => {
    const root = path.resolve("/project");
    expect(projectUri(root, path.join(root, ".warrant", "evidence", "x", "a.json"))).toBe(".warrant/evidence/x/a.json");
    expect(projectUri(root, path.resolve("/elsewhere/a.json"))).toMatch(/^file:\/\//);
  });

  it("lists the record ids of a directory and collects artifacts with their hashes", () => {
    const root = makeTempDir("warrant-unit-evidence-");
    tempDirs.push(root);
    const dir = path.join(root, ".warrant", "evidence", "add-search");
    mkdirSync(path.join(dir, "raw", "tests-passed", "nested"), { recursive: true });
    writeFileSync(path.join(dir, "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1B4.json"), "{}\n");
    writeFileSync(path.join(dir, "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3.json"), "{}\n");
    writeFileSync(path.join(dir, "manifest.json"), "{}\n");
    writeFileSync(path.join(dir, "raw", "tests-passed", "junit.xml"), "<testsuites/>\n");
    writeFileSync(path.join(dir, "raw", "tests-passed", "nested", "log.txt"), "log\n");

    expect(listRecordIds(dir)).toEqual(["EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3", "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1B4"]);
    expect(collectArtifacts(root, path.join(dir, "raw", "tests-passed"))).toEqual([
      { uri: ".warrant/evidence/add-search/raw/tests-passed/junit.xml", sha256: bytesHash("<testsuites/>\n") },
      { uri: ".warrant/evidence/add-search/raw/tests-passed/nested/log.txt", sha256: bytesHash("log\n") }
    ]);
  });
});
