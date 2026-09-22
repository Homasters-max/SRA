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

/**
 * A project enabling the given packs, with a lock that matches them.
 *
 * With `synced` the project is additionally run through `openspec init` and
 * `warrant sync`, so check (4) — which has no opt-out since task 4.1 — has the
 * generated files it compares against. Needs `openspec` on PATH.
 */
async function project(packs: Record<string, string>, packsDir: string, synced = false): Promise<string> {
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
  if (synced) {
    if (!runOpenspec(["init", "--tools", "none"], root).ok) throw new Error("openspec init failed");
    const sync = await runCli(["sync"], root, { WARRANT_PACKS_DIR: packsDir });
    if (sync.status !== 0) throw new Error(`warrant sync failed: ${sync.stdout}${sync.stderr}`);
  }
  return root;
}

describe("warrant validate", () => {
  it.skipIf(!openspecAvailable())(
    "accepts a synced project using the bundled pack core-sdd (SCN-KRN-043)",
    async () => {
      const root = await project({ "core-sdd": "^0.1" }, path.join(REPO_ROOT, "packs"), true);
      const run = await runCli(["validate"], root);
      expect(run.json?.errors).toEqual([]);
      expect(run.json?.ok).toBe(true);
      expect(run.status).toBe(0);
      expect(run.json?.command).toBe("validate");
      expect(run.json?.data.checked.packs).toContain("core-sdd");
      expect(run.json?.data.checked.files).toBeGreaterThan(5);
      // Nothing is skipped any more: check (4) has no flag (SCN-KRN-082).
      expect(run.json?.data.skipped).toEqual([]);
    },
    60_000
  );

  it.skipIf(!openspecAvailable())(
    "validates every file of packs/core-sdd against its own schema",
    async () => {
      const root = await project({ "core-sdd": "^0.1" }, path.join(REPO_ROOT, "packs"), true);
      const run = await runCli(["validate"], root);
      expect(run.json?.ok).toBe(true);
      // pack.json, schema.json, rules.json, levels.json, floors.json and 4 templates.
      expect(packContentHash(CORE_SDD)).toMatch(/^sha256:[0-9a-f]{64}$/);
    },
    60_000
  );

  it("reports SCHEMA_VIOLATION with the file path and prints nothing but the envelope (SCN-KRN-005)", async () => {
    const root = await project({ base: "^1.0" }, FIXTURE_PACKS);
    // `level` is required by warrant://gate/1 and `waivable` has no default (SCN-KRN-019).
    write(root, ".warrant/local/gates/x.json", { $schema: "warrant://gate/1", id: "x", version: "1.0.0" });

    const run = await runCli(["validate"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
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

  it("reports DUPLICATE_OBJECT_ID when two packs declare the same gate (SCN-KRN-044)", async () => {
    const root = makeTempDir("warrant-e2e-dup-");
    tempDirs.push(root);
    write(root, ".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { base: { version: "^1.0" }, "dup-gate": { version: "^1.0" } }
    });

    const run = await runCli(["validate"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
    expect(run.status).toBe(3);
    const duplicate = run.json?.errors.find((e: { code: string }) => e.code === "DUPLICATE_OBJECT_ID");
    expect(duplicate.message).toContain("base");
    expect(duplicate.message).toContain("dup-gate");
  });

  it("reports SECRET_LIKE without the token itself (SCN-KRN-048)", async () => {
    const root = await project({ base: "^1.0" }, FIXTURE_PACKS);
    const token = "ghp_" + "a1b2c3d4e5".repeat(3) + "f6g7h8";
    write(root, ".claude/settings.json", `{\n  "token": "${token}"\n}\n`);

    const run = await runCli(["validate"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
    expect(run.status).toBe(3);
    const finding = run.json?.errors.find((e: { code: string }) => e.code === "SECRET_LIKE");
    expect(finding.path).toBe(".claude/settings.json");
    expect(finding.message).toContain("github-personal-token");
    expect(run.stdout).not.toContain(token);
    expect(run.stderr).not.toContain(token);
  });

  it("collects every finding in one run instead of stopping at the first (task 3.7)", async () => {
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

    const run = await runCli(["validate"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
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

  it("reports NOT_CANONICAL for a file whose keys are out of order (check 7, REQ-KRN-022)", async () => {
    const root = await project({ base: "^1.0" }, FIXTURE_PACKS);
    // Valid against warrant://areas/1, but `$schema` is not first.
    write(
      root,
      ".warrant/local/areas.json",
      ['{', '  "KRN": {', '    "capability": "kernel"', "  },", '  "$schema": "warrant://areas/1"', "}", ""].join("\n")
    );

    const run = await runCli(["validate"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
    expect(run.status).toBe(3);
    const finding = run.json?.errors.find((e: { code: string }) => e.code === "NOT_CANONICAL");
    expect(finding).toBeDefined();
    expect(finding.path).toBe(".warrant/local/areas.json");
    expect(finding.message).toContain("warrant fmt");
  });

  it("reports CONFIG_MISSING before anything else (SCN-KRN-007)", async () => {
    const root = makeTempDir("warrant-e2e-empty-");
    tempDirs.push(root);
    const run = await runCli(["validate"], root);
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("CONFIG_MISSING");
  });

  it("rejects the removed flag --no-generated with USAGE (SCN-KRN-082)", async () => {
    const root = await project({ base: "^1.0" }, FIXTURE_PACKS);
    const run = await runCli(["validate", "--no-generated"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("USAGE");
    // `generated` is not a skip any run can report any more.
    expect(run.json?.data?.skipped ?? []).not.toContain("generated");
  });
});

describe("warrant validate: check (4) generated files", () => {
  it.skipIf(!openspecAvailable())(
    "passes on a synced project and reports GENERATED_DRIFT once config.yaml is edited (SCN-KRN-045)",
    async () => {
      const root = makeTempDir("warrant-e2e-gen-");
      tempDirs.push(root);
      write(root, ".warrant/warrant.json", {
        $schema: "warrant://config/1",
        kernel: "0.1",
        openspec: "1.13.x",
        packs: { "core-sdd": { version: "^0.1" } }
      });
      expect(runOpenspec(["init", "--tools", "none"], root).ok).toBe(true);
      expect((await runCli(["sync"], root)).status).toBe(0);

      const clean = await runCli(["validate"], root);
      expect(clean.json?.errors).toEqual([]);
      expect(clean.json?.data.skipped).toEqual([]);

      const config = path.join(root, "openspec", "config.yaml");
      writeFileSync(config, readFileSync(config, "utf8").replace("schema: warrant-sdd", "schema: spec-driven"), "utf8");

      const drifted = await runCli(["validate"], root);
      expect(drifted.status).toBe(3);
      const drift = drifted.json?.errors.filter((e: { code: string }) => e.code === "GENERATED_DRIFT");
      expect(drift.map((e: { path: string }) => e.path)).toContain("openspec/config.yaml");
    },
    60_000
  );

  it.skipIf(!openspecAvailable())(
    "reports RULES_ARTIFACT_UNKNOWN for a rules key that is not an artifact of the schema",
    async () => {
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
      expect((await runCli(["sync"], root)).status).toBe(0);

      const run = await runCli(["validate"], root);
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
    async () => {
      const root = await project({ base: "^1.0" }, FIXTURE_PACKS);
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

      const run = await runCli(["validate"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
      const placement = run.json?.errors.filter((e: { code: string }) => e.code === "ID_PLACEMENT");
      expect(placement.map((e: { message: string }) => e.message.split(" ")[0])).toEqual(["REQ-KRN-099"]);
      expect(placement[0].path).toBe("openspec/changes/demo/specs/kernel/spec.md");
      expect(run.json?.data.skipped).not.toContain("ids-placement");
    },
    60_000
  );
});

// I-43 is rolled back: there is no way to exempt `openspec/**` entries of
// `lock.generated` from check (2) any more (REQ-KRN-025, task 4.1).
describe("warrant validate: every lock.generated entry is checked", () => {
  async function lockedProject(): Promise<string> {
    const root = await project({ "core-sdd": "^0.1" }, path.join(REPO_ROOT, "packs"));
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

  it("reports both the openspec/** entry and the schema copy", async () => {
    const run = await runCli(["validate"], await lockedProject());
    expect(run.status).toBe(3);
    const paths = run.json?.errors.map((e: { path?: string }) => e.path);
    expect(paths).toContain(".warrant/warrant.lock.json#/generated/openspec/config.yaml");
    expect(paths).toContain(".warrant/warrant.lock.json#/generated/.warrant/schemas/common.1.schema.json");
  });
});

describe("warrant validate: overrides may only strengthen (B1)", () => {
  /** The pack copy of `risk-high`, so a test override can drop exactly one thing. */
  const riskHigh = JSON.parse(readFileSync(path.join(CORE_SDD, "overlays", "risk-high.json"), "utf8"));

  it("reports OVERRIDE_WEAKENS for an override that narrows match (SCN-KRN-078)", async () => {
    const root = await project({ "core-sdd": "^0.1" }, path.join(REPO_ROOT, "packs"));
    write(root, ".warrant/local/risk-high.json", {
      ...riskHigh,
      overrides: "core-sdd:risk-high",
      match: { risk_level: ["HIGH"], profiles: ["never"] }
    });

    const run = await runCli(["validate"], root);
    expect(run.status).toBe(3);
    const finding = run.json?.errors.find((e: { code: string }) => e.code === "OVERRIDE_WEAKENS");
    expect(finding).toBeDefined();
    expect(finding.path).toBe(".warrant/local/risk-high.json#/match");
    expect(finding.message).toContain("match.profiles");
  });

  it("accepts an override that widens match instead of narrowing it", async () => {
    const root = await project({ "core-sdd": "^0.1" }, path.join(REPO_ROOT, "packs"));
    write(root, ".warrant/local/risk-high.json", {
      ...riskHigh,
      overrides: "core-sdd:risk-high",
      match: { risk_level: ["HIGH", "MEDIUM"] }
    });

    const run = await runCli(["validate"], root);
    expect(run.json?.errors.filter((e: { code: string }) => e.code === "OVERRIDE_WEAKENS")).toEqual([]);
  });

  it("reports OVERRIDE_WEAKENS for an override that empties extends (SCN-KRN-079)", async () => {
    const root = await project({ "core-sdd": "^0.1" }, path.join(REPO_ROOT, "packs"));
    const factory = JSON.parse(readFileSync(path.join(CORE_SDD, "profiles", "factory-change.json"), "utf8"));
    write(root, ".warrant/local/factory-change.json", {
      ...factory,
      overrides: "core-sdd:factory-change",
      extends: []
    });

    const run = await runCli(["validate"], root);
    expect(run.status).toBe(3);
    const finding = run.json?.errors.find(
      (e: { code: string; path?: string }) =>
        e.code === "OVERRIDE_WEAKENS" && e.path === ".warrant/local/factory-change.json#/extends"
    );
    expect(finding).toBeDefined();
    expect(finding.message).toContain("extends: feature");
  });

  it("reports OVERRIDE_WEAKENS when an override drops human-approval (SCN-SDD-010)", async () => {
    const root = await project({ "core-sdd": "^0.1" }, path.join(REPO_ROOT, "packs"));
    write(root, ".warrant/local/risk-high.json", {
      ...riskHigh,
      overrides: "core-sdd:risk-high",
      gates: { ...riskHigh.gates, "VERIFYING->MERGED": [] }
    });

    const run = await runCli(["validate"], root);
    expect(run.status).toBe(3);
    const finding = run.json?.errors.find((e: { code: string }) => e.code === "OVERRIDE_WEAKENS");
    expect(finding.message).toContain("gates.VERIFYING->MERGED: human-approval");
    expect(finding.path).toBe(".warrant/local/risk-high.json");
  });
});

describe("warrant validate: a pack directory is never a project layer (B2)", () => {
  /** A minimal pack manifest that a project could drop into `.warrant/local/`. */
  function manifest(id: string): object {
    return {
      $schema: "warrant://pack/1",
      id,
      version: "0.1.0",
      kernel: ">=0.1 <0.2",
      description: `Experimental pack ${id}.`,
      depends_on: {},
      provides: { overlays: ["overlays/loud.json"] }
    };
  }

  const loudOverlay = {
    $schema: "warrant://overlay/1",
    id: "loud",
    version: "1.0.0",
    description: "An overlay that would apply to every change if it were read.",
    match: {},
    artifacts: { required: ["loud-artifact"] }
  };

  it("reports CONFIG_INVALID and ignores the overlays of a pack nobody enabled (SCN-KRN-080)", async () => {
    const root = await project({ "core-sdd": "^0.1" }, path.join(REPO_ROOT, "packs"));
    write(root, ".warrant/local/experimental/pack.json", manifest("experimental"));
    write(root, ".warrant/local/experimental/overlays/loud.json", loudOverlay);
    write(root, ".warrant/changes/demo.json", {
      $schema: "warrant://change-record/1",
      change: "demo",
      change_state: "PROPOSED"
    });

    const run = await runCli(["validate"], root);
    expect(run.status).toBe(3);
    const finding = run.json?.errors.find(
      (e: { code: string; path?: string }) =>
        e.code === "CONFIG_INVALID" && e.path === ".warrant/local/experimental/pack.json"
    );
    expect(finding).toBeDefined();
    expect(finding.message).toContain("experimental");

    // Its overlay contributes to no Change: `resolve` never sees `loud-artifact`.
    const resolved = await runCli(["resolve", "demo"], root);
    expect(JSON.stringify(resolved.json)).not.toContain("loud-artifact");
  });

  it.skipIf(!openspecAvailable())(
    "still reads a local directory that carries no pack.json",
    async () => {
      const root = await project({ "core-sdd": "^0.1" }, path.join(REPO_ROOT, "packs"), true);
      write(root, ".warrant/local/overlays/loud.json", loudOverlay);

      const run = await runCli(["validate"], root);
      expect(run.json?.errors).toEqual([]);
    },
    60_000
  );
});

describe("warrant validate: id equals the file base name (task 3.6)", () => {
  it("reports SEMANTIC_INVALID for an object whose id is not its file name", async () => {
    const root = await project({ "core-sdd": "^0.1" }, path.join(REPO_ROOT, "packs"));
    write(root, ".warrant/local/overlays/quiet.json", {
      $schema: "warrant://overlay/1",
      id: "loud",
      version: "1.0.0",
      description: "An overlay stored under the wrong file name.",
      match: {}
    });

    const run = await runCli(["validate"], root);
    expect(run.status).toBe(3);
    const finding = run.json?.errors.find((e: { code: string }) => e.code === "SEMANTIC_INVALID");
    expect(finding).toBeDefined();
    expect(finding.path).toBe(".warrant/local/overlays/quiet.json#/id");
    expect(finding.message).toContain("quiet");
  });
});
