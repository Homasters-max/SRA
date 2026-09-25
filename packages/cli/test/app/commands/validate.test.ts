/**
 * `warrant validate` in the test process: checks (1)–(7) of REQ-KRN-021 on
 * projects built by `ProjectBuilder` (SCN-KRN-005, 007, 043, 044, 045, 046, 048,
 * 078, 079, 080, 082, 094, 125, SCN-SDD-010). Moved from e2e (ADR-0025, task 5.2);
 * the parse of argv (`--no-generated`), the exit code of the binary and the
 * envelope as the only stdout stay in `e2e/validate.test.ts`.
 *
 * Projects on the fixture packs point the pack loader at them through
 * `WARRANT_PACKS_DIR`, as the e2e runs did through the environment of the binary.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runResolve } from "../../../src/commands/resolve.js";
import type { CliError } from "../../../src/core/errors.js";
import { packContentHash } from "../../../src/core/packs/hash.js";
import type { CommandResult } from "../../../src/io/output.js";
import { CLI_VERSION } from "../../../src/version.js";
import { CLI_ROOT, CORE_SDD_RANGE, REPO_ROOT } from "../../helpers/cli.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { validate } from "../helpers/validate.js";

const FIXTURE_PACKS = path.join(CLI_ROOT, "test", "fixtures", "packs");
const CORE_SDD = path.join(REPO_ROOT, "packs", "core-sdd");

const project = useProjectBuilder();

const PACKS_ENV = "WARRANT_PACKS_DIR";
const packsEnvBefore = process.env[PACKS_ENV];
afterEach(() => {
  if (packsEnvBefore === undefined) delete process.env[PACKS_ENV];
  else process.env[PACKS_ENV] = packsEnvBefore;
});

/** A project with only `.warrant/warrant.json` enabling `packs` of the fixture packs. */
function bare(packs: Record<string, string>): ProjectBuilder {
  process.env[PACKS_ENV] = FIXTURE_PACKS;
  return project()
    .remove(".warrant")
    .write(".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: Object.fromEntries(Object.entries(packs).map(([id, version]) => [id, { version }]))
    });
}

/** A project enabling fixture `packs`, with areas and a lock that matches them (not synced). */
function fixture(packs: Record<string, string>): ProjectBuilder {
  return bare(packs)
    .write(".warrant/local/areas.json", { $schema: "warrant://areas/1", KRN: { capability: "kernel" } })
    .write(".warrant/warrant.lock.json", {
      $schema: "warrant://lock/1",
      kernel: CLI_VERSION,
      openspec: "1.13.1",
      packs: Object.fromEntries(
        Object.keys(packs).map((id) => [
          id,
          {
            version: (JSON.parse(readFileSync(path.join(FIXTURE_PACKS, id, "pack.json"), "utf8")) as { version: string }).version,
            source: "bundled",
            hash: packContentHash(path.join(FIXTURE_PACKS, id))
          }
        ])
      )
    });
}

function find(run: CommandResult, code: string): CliError | undefined {
  return run.errors.find((e) => e.code === code);
}

describe("warrant validate", () => {
  it("accepts a synced project using the bundled pack core-sdd (SCN-KRN-043)", async () => {
    const p = await project().synced();
    const run = await validate(p);
    expect(run.errors).toEqual([]);
    expect(run.ok).toBe(true);
    expect(run.exitCode).toBe(0);
    expect(run.data["checked"]).toMatchObject({ packs: expect.arrayContaining(["core-sdd"]) });
    expect((run.data["checked"] as { files: number }).files).toBeGreaterThan(5);
    // Nothing is skipped any more: check (4) has no flag (SCN-KRN-082).
    expect(run.data["skipped"]).toEqual([]);
  });

  it("validates every file of packs/core-sdd against its own schema", async () => {
    const run = await validate(await project().synced());
    expect(run.ok).toBe(true);
    // pack.json, schema.json, rules.json, levels.json, floors.json and 4 templates.
    expect(packContentHash(CORE_SDD)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("reports SCHEMA_VIOLATION with the file path (SCN-KRN-005)", async () => {
    const p = fixture({ base: "^1.0" });
    // `level` is required by warrant://gate/1 and `waivable` has no default (SCN-KRN-019).
    p.write(".warrant/local/gates/x.json", { $schema: "warrant://gate/1", id: "x", version: "1.0.0" });

    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    expect(run.ok).toBe(false);
    const violation = find(run, "SCHEMA_VIOLATION");
    expect(violation).toBeDefined();
    expect(violation?.path).toContain(".warrant/local/gates/x.json");
  });

  it("reports DUPLICATE_OBJECT_ID when two packs declare the same gate (SCN-KRN-044)", async () => {
    const run = await validate(bare({ base: "^1.0", "dup-gate": "^1.0" }));
    expect(run.exitCode).toBe(3);
    const duplicate = find(run, "DUPLICATE_OBJECT_ID");
    expect(duplicate?.message).toContain("base");
    expect(duplicate?.message).toContain("dup-gate");
  });

  it("reports SECRET_LIKE without the token itself (SCN-KRN-048)", async () => {
    const p = fixture({ base: "^1.0" });
    const token = "ghp_" + "a1b2c3d4e5".repeat(3) + "f6g7h8";
    p.write(".claude/settings.json", `{\n  "token": "${token}"\n}\n`);

    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    const finding = find(run, "SECRET_LIKE");
    expect(finding?.path).toBe(".claude/settings.json");
    expect(finding?.message).toContain("github-personal-token");
    // What the binary prints: the envelope of the result on stdout, warnings on stderr.
    expect(JSON.stringify(run)).not.toContain(token);
    expect(p.warnings.join("")).not.toContain(token);
  });

  it("collects every finding in one run instead of stopping at the first (task 3.7)", async () => {
    const p = bare({ base: "^1.0" });
    p.write(".warrant/local/gates/x.json", { $schema: "warrant://gate/1", id: "x", version: "1.0.0" });
    p.withSpec("kernel", [{ name: "R", id: "REQ-ZZZ-001", body: "The system SHALL x." }]);

    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    const found = new Set<string>(run.errors.map((e) => e.code));
    expect(found.has("SCHEMA_VIOLATION")).toBe(true);
    expect(found.has("AREA_UNKNOWN")).toBe(true);
    expect(found.has("LOCK_MISMATCH")).toBe(true);
    expect(found.size).toBeGreaterThanOrEqual(3);

    // errors[] is sorted by path, then code.
    const keys = run.errors.map((e) => `${e.path ?? ""} ${e.code}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("reports NOT_CANONICAL for a file whose keys are out of order (check 7, REQ-KRN-022)", async () => {
    const p = fixture({ base: "^1.0" });
    // Valid against warrant://areas/1, but `$schema` is not first.
    p.write(
      ".warrant/local/areas.json",
      ['{', '  "KRN": {', '    "capability": "kernel"', "  },", '  "$schema": "warrant://areas/1"', "}", ""].join("\n")
    );

    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    const finding = find(run, "NOT_CANONICAL");
    expect(finding).toBeDefined();
    expect(finding?.path).toBe(".warrant/local/areas.json");
    expect(finding?.message).toBe("file is not in canonical form");
    expect(finding?.hint).toBe("run `warrant fmt`");
  });

  it("reports CONFIG_MISSING before anything else (SCN-KRN-007)", async () => {
    const run = await validate(project().remove(".warrant"));
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("CONFIG_MISSING");
  });

  it("reports LOCK_MISMATCH for a pack left in the lock after its removal from warrant.json (B3, SCN-KRN-094)", async () => {
    const p = fixture({ base: "^1.0" });
    const hash = packContentHash(path.join(FIXTURE_PACKS, "base"));
    p.write(".warrant/warrant.lock.json", {
      $schema: "warrant://lock/1",
      kernel: CLI_VERSION,
      openspec: "1.13.1",
      packs: {
        base: { version: "1.0.0", source: "bundled", hash },
        "bdd-tdd": { version: "0.1.0", source: "bundled", hash }
      }
    });

    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    expect(run.ok).toBe(false);
    const lockErrors = run.errors.filter((e) => e.code === "LOCK_MISMATCH");
    expect(lockErrors).toEqual([
      {
        code: "LOCK_MISMATCH",
        message: expect.stringContaining("bdd-tdd"),
        path: ".warrant/warrant.lock.json#/packs/bdd-tdd",
        hint: "run `warrant sync`"
      }
    ]);
  });

  it("keeps the fix of a missing lock in hint, not in message (SCN-KRN-125)", async () => {
    const run = await validate(bare({ base: "^1.0" }));
    const missing = run.errors.filter((e) => e.code === "LOCK_MISMATCH");
    expect(missing).toEqual([
      { code: "LOCK_MISMATCH", message: "lock file is missing", path: ".warrant/warrant.lock.json", hint: "run `warrant sync`" }
    ]);
    expect(missing[0]?.message).not.toMatch(/\brun\b/);
  });
});

describe("warrant validate: check (4) generated files", () => {
  it("passes on a synced project and reports GENERATED_DRIFT once config.yaml is edited (SCN-KRN-045)", async () => {
    const p = await project().synced();
    const clean = await validate(p);
    expect(clean.errors).toEqual([]);
    expect(clean.data["skipped"]).toEqual([]);

    p.write("openspec/config.yaml", p.read("openspec/config.yaml").replace("schema: warrant-sdd", "schema: spec-driven"));

    const drifted = await validate(p);
    expect(drifted.exitCode).toBe(3);
    const drift = drifted.errors.filter((e) => e.code === "GENERATED_DRIFT");
    expect(drift.map((e) => e.path)).toContain("openspec/config.yaml");
  });

  it("reports RULES_ARTIFACT_UNKNOWN for a rules key that is not an artifact of the schema", async () => {
    const p = project().write(".warrant/local/openspec/rules.json", {
      $schema: "warrant://openspec-rules/1",
      rules: { "no-such-artifact": ["nope"] }
    });
    await p.synced();

    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    const finding = find(run, "RULES_ARTIFACT_UNKNOWN");
    expect(finding?.path).toBe(".warrant/local/openspec/rules.json#/rules/no-such-artifact");
  });
});

describe("warrant validate: id placement", () => {
  it("reports ID_PLACEMENT for an id that is not directly under its heading (SCN-KRN-046)", async () => {
    const steps = "- **WHEN** a\n- **THEN** b";
    const p = fixture({ base: "^1.0" }).withChange("demo", {
      specs: {
        kernel: [
          {
            name: "Correctly placed",
            id: "REQ-KRN-001",
            body: "The system SHALL keep the id under its heading.",
            scenarios: [{ name: "Ok", id: "SCN-KRN-001", steps }]
          },
          {
            name: "Id after the body",
            id: "REQ-KRN-099",
            idAfterBody: true,
            body: "The system SHALL report this one.",
            scenarios: [{ name: "Also ok", id: "SCN-KRN-002", steps }]
          }
        ]
      }
    });

    const run = await validate(p);
    const placement = run.errors.filter((e) => e.code === "ID_PLACEMENT");
    expect(placement.map((e) => e.message.split(" ")[0])).toEqual(["REQ-KRN-099"]);
    expect(placement[0]?.path).toBe("openspec/changes/demo/specs/kernel/spec.md");
    expect(run.data["skipped"]).not.toContain("ids-placement");
  });
});

// I-43 is rolled back: there is no way to exempt `openspec/**` entries of
// `lock.generated` from check (2) any more (REQ-KRN-025, task 4.1).
describe("warrant validate: every lock.generated entry is checked", () => {
  function lockedProject(): ProjectBuilder {
    const p = project();
    const lock = JSON.parse(p.read(".warrant/warrant.lock.json")) as Record<string, unknown>;
    lock["generated"] = {
      "openspec/config.yaml": "sha256:" + "0".repeat(64),
      ".warrant/schemas/common.1.schema.json": "sha256:" + "0".repeat(64)
    };
    return p
      .write(".warrant/warrant.lock.json", lock)
      .write("openspec/config.yaml", "schema: spec-driven\n")
      .write(".warrant/schemas/common.1.schema.json", "{}\n");
  }

  it("reports both the openspec/** entry and the schema copy", async () => {
    const run = await validate(lockedProject());
    expect(run.exitCode).toBe(3);
    const paths = run.errors.map((e) => e.path);
    expect(paths).toContain(".warrant/warrant.lock.json#/generated/openspec/config.yaml");
    expect(paths).toContain(".warrant/warrant.lock.json#/generated/.warrant/schemas/common.1.schema.json");
  });
});

describe("warrant validate: overrides may only strengthen (B1)", () => {
  /** The pack copy of `risk-high`, so a test override can drop exactly one thing. */
  const riskHigh = JSON.parse(readFileSync(path.join(CORE_SDD, "overlays", "risk-high.json"), "utf8"));

  it("reports OVERRIDE_WEAKENS for an override that narrows match (SCN-KRN-078)", async () => {
    const p = project().write(".warrant/local/risk-high.json", {
      ...riskHigh,
      overrides: "core-sdd:risk-high",
      match: { risk_level: ["HIGH"], profiles: ["never"] }
    });

    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    const finding = find(run, "OVERRIDE_WEAKENS");
    expect(finding).toBeDefined();
    expect(finding?.path).toBe(".warrant/local/risk-high.json#/match");
    expect(finding?.message).toContain("match.profiles");
  });

  it("accepts an override that widens match instead of narrowing it", async () => {
    const p = project().write(".warrant/local/risk-high.json", {
      ...riskHigh,
      overrides: "core-sdd:risk-high",
      match: { risk_level: ["HIGH", "MEDIUM"] }
    });

    const run = await validate(p);
    expect(run.errors.filter((e) => e.code === "OVERRIDE_WEAKENS")).toEqual([]);
  });

  it("reports OVERRIDE_WEAKENS for an override that empties extends (SCN-KRN-079)", async () => {
    const factory = JSON.parse(readFileSync(path.join(CORE_SDD, "profiles", "factory-change.json"), "utf8"));
    const p = project().write(".warrant/local/factory-change.json", {
      ...factory,
      overrides: "core-sdd:factory-change",
      extends: []
    });

    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    const finding = run.errors.find(
      (e) => e.code === "OVERRIDE_WEAKENS" && e.path === ".warrant/local/factory-change.json#/extends"
    );
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("extends: feature");
  });

  it("reports OVERRIDE_WEAKENS when an override drops human-approval (SCN-SDD-010)", async () => {
    const p = project().write(".warrant/local/risk-high.json", {
      ...riskHigh,
      overrides: "core-sdd:risk-high",
      gates: { ...riskHigh.gates, "VERIFYING->MERGED": [] }
    });

    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    const finding = find(run, "OVERRIDE_WEAKENS");
    expect(finding?.message).toContain("gates.VERIFYING->MERGED: human-approval");
    expect(finding?.path).toBe(".warrant/local/risk-high.json");
  });
});

describe("warrant validate: a pack directory is never a project layer (B2)", () => {
  /** A minimal pack manifest that a project could drop into `.warrant/local/`. */
  function manifest(id: string): object {
    return {
      $schema: "warrant://pack/1",
      id,
      version: "0.1.0",
      kernel: ">=0.1 <1.0",
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
    const p = project()
      .write(".warrant/local/experimental/pack.json", manifest("experimental"))
      .write(".warrant/local/experimental/overlays/loud.json", loudOverlay)
      .write(".warrant/changes/demo.json", {
        $schema: "warrant://change-record/1",
        change: "demo",
        change_state: "PROPOSED"
      });

    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    const finding = run.errors.find(
      (e) => e.code === "CONFIG_INVALID" && e.path === ".warrant/local/experimental/pack.json"
    );
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("experimental");

    // Its overlay contributes to no Change: `resolve` never sees `loud-artifact`.
    const resolved = await invoke(() => runResolve(p.ctx, "demo"));
    expect(JSON.stringify(resolved)).not.toContain("loud-artifact");
  });

  it("still reads a local directory that carries no pack.json", async () => {
    const p = await project().synced();
    p.write(".warrant/local/overlays/loud.json", loudOverlay);

    const run = await validate(p);
    expect(run.errors).toEqual([]);
  });
});

describe("warrant validate: id equals the file base name (task 3.6)", () => {
  it("reports SEMANTIC_INVALID for an object whose id is not its file name", async () => {
    const p = project().write(".warrant/local/overlays/quiet.json", {
      $schema: "warrant://overlay/1",
      id: "loud",
      version: "1.0.0",
      description: "An overlay stored under the wrong file name.",
      match: {}
    });

    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    const finding = find(run, "SEMANTIC_INVALID");
    expect(finding).toBeDefined();
    expect(finding?.path).toBe(".warrant/local/overlays/quiet.json#/id");
    expect(finding?.message).toContain("quiet");
  });
});
