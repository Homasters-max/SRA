import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { canonicalText } from "../../src/core/canon/format-json.js";
import { packContentHash } from "../../src/core/packs/hash.js";
import { openspecAvailable, runOpenspec } from "../../src/core/openspec/cli.js";
import { CLI_VERSION } from "../../src/version.js";
import { CLI_ROOT, REPO_ROOT, makeTempDir, removeDir, runCli } from "../helpers/cli.js";

const FIXTURE_PACKS = path.join(CLI_ROOT, "test", "fixtures", "packs");
const CORE_SDD = path.join(REPO_ROOT, "packs", "core-sdd");
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

/**
 * Objects are written in canonical form so check (7) stays quiet: these
 * fixtures exist to exercise the other checks, not the formatter.
 */
function write(root: string, rel: string, content: string | object): void {
  const absolute = path.join(root, rel);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, typeof content === "string" ? content : canonicalText(content).text, "utf8");
}

/** A project enabling the given packs, with a lock that matches them. */
function project(packs: Record<string, string>, packsDir: string): string {
  const root = makeTempDir("warrant-e2e-");
  tempDirs.push(root);
  write(root, ".warrant/warrant.json", {
    $schema: "warrant://config/1",
    kernel: "0.1",
    openspec: "1.13.x",
    packs: Object.fromEntries(Object.entries(packs).map(([id, version]) => [id, { version }]))
  });
  write(root, ".warrant/local/areas.json", { $schema: "warrant://areas/1", KRN: { capability: "kernel" } });
  write(root, ".warrant/warrant.lock.json", {
    $schema: "warrant://lock/1",
    kernel: CLI_VERSION,
    openspec: "1.13.1",
    packs: Object.fromEntries(
      Object.keys(packs).map((id) => [
        id,
        { version: "0.1.0", source: "bundled", hash: packContentHash(path.join(packsDir, id)) }
      ])
    )
  });
  return root;
}

describe("warrant validate", () => {
  it("accepts a project using the bundled pack core-sdd (SCN-KRN-043)", () => {
    const root = project({ "core-sdd": "^0.1" }, path.join(REPO_ROOT, "packs"));
    const run = runCli(["validate", "--no-generated"], root);
    expect(run.json?.errors).toEqual([]);
    expect(run.json?.ok).toBe(true);
    expect(run.status).toBe(0);
    expect(run.json?.command).toBe("validate");
    expect(run.json?.data.checked.packs).toContain("core-sdd");
    expect(run.json?.data.checked.files).toBeGreaterThan(5);
    expect(run.json?.data.skipped).toContain("generated");
    expect(run.json?.data.skipped).not.toContain("canonical");
  });

  it("validates every file of packs/core-sdd against its own schema", () => {
    const root = project({ "core-sdd": "^0.1" }, path.join(REPO_ROOT, "packs"));
    const run = runCli(["validate", "--no-generated"], root);
    expect(run.json?.ok).toBe(true);
    // pack.json, schema.json, rules.json, levels.json, floors.json and 4 templates.
    expect(packContentHash(CORE_SDD)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("reports SCHEMA_VIOLATION with the file path and prints nothing but the envelope (SCN-KRN-005)", () => {
    const root = project({ base: "^1.0" }, FIXTURE_PACKS);
    // `level` is required by warrant://gate/1 and `waivable` has no default (SCN-KRN-019).
    write(root, ".warrant/local/gates/x.json", { $schema: "warrant://gate/1", id: "x", version: "1.0.0" });

    const run = runCli(["validate", "--no-generated"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
    expect(run.status).toBe(3);
    expect(run.json?.ok).toBe(false);
    const violation = run.json?.errors.find((e: { code: string }) => e.code === "SCHEMA_VIOLATION");
    expect(violation).toBeDefined();
    expect(violation.path).toContain(".warrant/local/gates/x.json");
    // stdout is exactly one JSON object and nothing else.
    expect(run.stdout.trim().startsWith("{")).toBe(true);
    expect(run.stdout.trim().endsWith("}")).toBe(true);
    expect(JSON.stringify(run.json)).toBeTruthy();
  });

  it("reports DUPLICATE_OBJECT_ID when two packs declare the same gate (SCN-KRN-044)", () => {
    const root = makeTempDir("warrant-e2e-dup-");
    tempDirs.push(root);
    write(root, ".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { base: { version: "^1.0" }, "dup-gate": { version: "^1.0" } }
    });

    const run = runCli(["validate", "--no-generated"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
    expect(run.status).toBe(3);
    const duplicate = run.json?.errors.find((e: { code: string }) => e.code === "DUPLICATE_OBJECT_ID");
    expect(duplicate.message).toContain("base");
    expect(duplicate.message).toContain("dup-gate");
  });

  it("reports SECRET_LIKE without the token itself (SCN-KRN-048)", () => {
    const root = project({ base: "^1.0" }, FIXTURE_PACKS);
    const token = "ghp_" + "a1b2c3d4e5".repeat(3) + "f6g7h8";
    write(root, ".claude/settings.json", `{\n  "token": "${token}"\n}\n`);

    const run = runCli(["validate", "--no-generated"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
    expect(run.status).toBe(3);
    const finding = run.json?.errors.find((e: { code: string }) => e.code === "SECRET_LIKE");
    expect(finding.path).toBe(".claude/settings.json");
    expect(finding.message).toContain("github-personal-token");
    expect(run.stdout).not.toContain(token);
    expect(run.stderr).not.toContain(token);
  });

  it("collects every finding in one run instead of stopping at the first (task 3.7)", () => {
    const root = makeTempDir("warrant-e2e-many-");
    tempDirs.push(root);
    write(root, ".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { base: { version: "^1.0" } }
    });
    write(root, ".warrant/local/gates/x.json", { $schema: "warrant://gate/1", id: "x", version: "1.0.0" });
    write(root, "openspec/specs/kernel/spec.md", "### Requirement: R\n<!-- id: REQ-ZZZ-001 -->\n\nThe system SHALL x.\n");

    const run = runCli(["validate", "--no-generated"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
    expect(run.status).toBe(3);
    const found = new Set<string>(run.json?.errors.map((e: { code: string }) => e.code));
    expect(found.has("SCHEMA_VIOLATION")).toBe(true);
    expect(found.has("AREA_UNKNOWN")).toBe(true);
    expect(found.has("LOCK_MISMATCH")).toBe(true);
    expect(found.size).toBeGreaterThanOrEqual(3);

    // errors[] is sorted by path, then code.
    const keys = run.json?.errors.map((e: { path?: string; code: string }) => `${e.path ?? ""} ${e.code}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("reports NOT_CANONICAL for a file whose keys are out of order (check 7, REQ-KRN-022)", () => {
    const root = project({ base: "^1.0" }, FIXTURE_PACKS);
    // Valid against warrant://areas/1, but `$schema` is not first.
    write(
      root,
      ".warrant/local/areas.json",
      ['{', '  "KRN": {', '    "capability": "kernel"', "  },", '  "$schema": "warrant://areas/1"', "}", ""].join("\n")
    );

    const run = runCli(["validate", "--no-generated"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
    expect(run.status).toBe(3);
    const finding = run.json?.errors.find((e: { code: string }) => e.code === "NOT_CANONICAL");
    expect(finding).toBeDefined();
    expect(finding.path).toBe(".warrant/local/areas.json");
    expect(finding.message).toContain("warrant fmt");
  });

  it("reports CONFIG_MISSING before anything else (SCN-KRN-007)", () => {
    const root = makeTempDir("warrant-e2e-empty-");
    tempDirs.push(root);
    const run = runCli(["validate"], root);
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("CONFIG_MISSING");
  });

  it("accepts --no-generated and records the skip", () => {
    const root = project({ base: "^1.0" }, FIXTURE_PACKS);
    const run = runCli(["validate", "--no-generated"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
    expect(run.json?.data.skipped).toContain("generated");
    expect(run.stderr).toContain("--no-generated");
  });
});

describe("warrant validate: check (4) generated files", () => {
  it.skipIf(!openspecAvailable())(
    "passes on a synced project and reports GENERATED_DRIFT once config.yaml is edited (SCN-KRN-045)",
    () => {
      const root = makeTempDir("warrant-e2e-gen-");
      tempDirs.push(root);
      write(root, ".warrant/warrant.json", {
        $schema: "warrant://config/1",
        kernel: "0.1",
        openspec: "1.13.x",
        packs: { "core-sdd": { version: "^0.1" } }
      });
      expect(runOpenspec(["init", "--tools", "none"], root).ok).toBe(true);
      expect(runCli(["sync"], root).status).toBe(0);

      const clean = runCli(["validate"], root);
      expect(clean.json?.errors).toEqual([]);
      expect(clean.json?.data.skipped).toEqual([]);

      const config = path.join(root, "openspec", "config.yaml");
      writeFileSync(config, readFileSync(config, "utf8").replace("schema: warrant-sdd", "schema: spec-driven"), "utf8");

      const drifted = runCli(["validate"], root);
      expect(drifted.status).toBe(3);
      const drift = drifted.json?.errors.filter((e: { code: string }) => e.code === "GENERATED_DRIFT");
      expect(drift.map((e: { path: string }) => e.path)).toContain("openspec/config.yaml");
    },
    60_000
  );

  it.skipIf(!openspecAvailable())(
    "reports RULES_ARTIFACT_UNKNOWN for a rules key that is not an artifact of the schema",
    () => {
      const root = makeTempDir("warrant-e2e-rules-");
      tempDirs.push(root);
      write(root, ".warrant/warrant.json", {
        $schema: "warrant://config/1",
        kernel: "0.1",
        openspec: "1.13.x",
        packs: { "core-sdd": { version: "^0.1" } }
      });
      expect(runOpenspec(["init", "--tools", "none"], root).ok).toBe(true);
      write(root, ".warrant/local/openspec/rules.json", {
        $schema: "warrant://openspec-rules/1",
        rules: { "no-such-artifact": ["nope"] }
      });
      expect(runCli(["sync"], root).status).toBe(0);

      const run = runCli(["validate"], root);
      expect(run.status).toBe(3);
      const finding = run.json?.errors.find((e: { code: string }) => e.code === "RULES_ARTIFACT_UNKNOWN");
      expect(finding.path).toBe(".warrant/local/openspec/rules.json#/rules/no-such-artifact");
    },
    60_000
  );
});

describe("warrant validate: id placement", () => {
  it.skipIf(!openspecAvailable())(
    "reports ID_PLACEMENT for a comment above its heading (SCN-KRN-046)",
    () => {
      const root = project({ base: "^1.0" }, FIXTURE_PACKS);
      expect(runOpenspec(["init", "--tools", "none"], root).ok).toBe(true);
      expect(runOpenspec(["new", "change", "demo", "--schema", "spec-driven", "--json"], root).ok).toBe(true);

      // `openspec show <change> --json` refuses a change without a proposal.
      write(
        root,
        "openspec/changes/demo/proposal.md",
        "# Proposal\n\n## Why\n\nFixture.\n\n## What Changes\n\n- a spec delta\n\n## Capabilities\n\n### New Capabilities\n- `kernel`: fixture capability\n\n## Impact\n\n- none\n"
      );
      write(
        root,
        "openspec/changes/demo/specs/kernel/spec.md",
        [
          "# Spec Delta",
          "",
          "## Purpose",
          "",
          "A fixture capability used to check where a stable id comment may sit.",
          "",
          "## ADDED Requirements",
          "",
          "### Requirement: Correctly placed",
          "<!-- id: REQ-KRN-001 -->",
          "",
          "The system SHALL keep the id under its heading.",
          "",
          "#### Scenario: Ok",
          "<!-- id: SCN-KRN-001 -->",
          "- **WHEN** a",
          "- **THEN** b",
          "",
          "<!-- id: REQ-KRN-099 -->",
          "### Requirement: Comment above the heading",
          "",
          "The system SHALL report this one.",
          "",
          "#### Scenario: Also ok",
          "<!-- id: SCN-KRN-002 -->",
          "- **WHEN** a",
          "- **THEN** b",
          ""
        ].join("\n")
      );

      const run = runCli(["validate", "--no-generated"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
      const placement = run.json?.errors.filter((e: { code: string }) => e.code === "ID_PLACEMENT");
      expect(placement.map((e: { message: string }) => e.message.split(" ")[0])).toEqual(["REQ-KRN-099"]);
      expect(placement[0].path).toBe("openspec/changes/demo/specs/kernel/spec.md");
      expect(run.json?.data.skipped).not.toContain("ids-placement");
    },
    60_000
  );
});

describe("warrant validate: --no-generated and the lock (I-43)", () => {
  function lockedProject(): string {
    const root = project({ "core-sdd": "^0.1" }, path.join(REPO_ROOT, "packs"));
    const lockPath = path.join(root, ".warrant/warrant.lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.generated = {
      "openspec/config.yaml": "sha256:" + "0".repeat(64),
      ".warrant/schemas/common.1.schema.json": "sha256:" + "0".repeat(64)
    };
    write(root, ".warrant/warrant.lock.json", lock);
    write(root, "openspec/config.yaml", "schema: spec-driven\n");
    write(root, ".warrant/schemas/common.1.schema.json", "{}\n");
    return root;
  }

  it("skips lock hashes of openspec/** with --no-generated but still checks schema copies", () => {
    const run = runCli(["validate", "--no-generated"], lockedProject());
    const paths = run.json?.errors.map((e: { path?: string }) => e.path);
    expect(paths).not.toContain(".warrant/warrant.lock.json#/generated/openspec/config.yaml");
    expect(paths).toContain(".warrant/warrant.lock.json#/generated/.warrant/schemas/common.1.schema.json");
  });

  it("checks lock hashes of openspec/** without the flag", () => {
    const run = runCli(["validate"], lockedProject());
    const paths = run.json?.errors.map((e: { path?: string }) => e.path);
    expect(paths).toContain(".warrant/warrant.lock.json#/generated/openspec/config.yaml");
  });
});
