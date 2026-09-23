import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { loadPacks, weakenings } from "../../../src/core/packs/loader.js";
import { CLI_ROOT, CORE_SDD_RANGE, makeTempDir, removeDir } from "../../helpers/cli.js";

const FIXTURE_PACKS = path.join(CLI_ROOT, "test", "fixtures", "packs");

const tempDirs: string[] = [];

function project(config: Record<string, unknown>, files: Record<string, unknown> = {}): string {
  const root = makeTempDir("warrant-loader-");
  tempDirs.push(root);
  mkdirSync(path.join(root, ".warrant", "local"), { recursive: true });
  writeFileSync(
    path.join(root, ".warrant", "warrant.json"),
    JSON.stringify({ $schema: "warrant://config/1", kernel: "0.1", openspec: "1.13.x", ...config }, null, 2)
  );
  for (const [rel, json] of Object.entries(files)) {
    const absolute = path.join(root, rel);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, JSON.stringify(json, null, 2));
  }
  return root;
}

function codes(errors: { code: string }[]): string[] {
  return errors.map((e) => e.code).sort();
}

beforeAll(() => {
  process.env["WARRANT_PACKS_DIR"] = FIXTURE_PACKS;
});

afterAll(() => {
  delete process.env["WARRANT_PACKS_DIR"];
  for (const dir of tempDirs) removeDir(dir);
});

afterEach(() => {
  process.env["WARRANT_PACKS_DIR"] = FIXTURE_PACKS;
});

describe("loadPacks", () => {
  it("loads a bundled pack and its objects", () => {
    const result = loadPacks(project({ packs: { base: { version: "^1.0" } } }));
    expect(result.errors).toEqual([]);
    expect(result.packs.map((p) => p.id)).toEqual(["base"]);
    expect(result.packs[0]?.source).toBe("bundled");
    expect(result.objects.map((o) => `${o.kind}:${o.id}`).sort()).toEqual(["gate:tests-passed", "profile:feature"]);
  });

  it("reports PACK_NOT_FOUND for a pack that is neither bundled nor local", () => {
    const result = loadPacks(project({ packs: { nowhere: { version: "^1.0" } } }));
    expect(codes(result.errors)).toEqual(["PACK_NOT_FOUND"]);
  });

  it("reports a kernel range this CLI does not satisfy", () => {
    const result = loadPacks(project({ packs: { "bad-kernel": { version: "^1.0" } } }));
    expect(codes(result.errors)).toEqual(["CONFIG_INVALID"]);
    expect(result.errors[0]?.message).toMatch(/requires kernel/);
  });

  it("reports a pack version outside the configured range", () => {
    const result = loadPacks(project({ packs: { base: { version: "^2.0" } } }));
    expect(codes(result.errors)).toEqual(["CONFIG_INVALID"]);
    expect(result.errors[0]?.message).toMatch(/does not satisfy/);
  });

  it("reports DUPLICATE_OBJECT_ID when two packs declare the same gate (SCN-KRN-044)", () => {
    const result = loadPacks(project({ packs: { base: { version: "^1.0" }, "dup-gate": { version: "^1.0" } } }));
    expect(codes(result.errors)).toEqual(["DUPLICATE_OBJECT_ID"]);
    const error = result.errors[0];
    expect(error?.message).toContain("base");
    expect(error?.message).toContain("dup-gate");
    expect(error?.path).toContain("dup-gate");
  });

  it("reports a dependency cycle as CONFIG_INVALID", () => {
    const result = loadPacks(project({ packs: { "cycle-a": { version: "^1.0" }, "cycle-b": { version: "^1.0" } } }));
    expect(result.errors.some((e) => e.code === "CONFIG_INVALID" && /cycle/.test(e.message))).toBe(true);
  });

  it("orders packs by depends_on", () => {
    // cycle-b is reached through cycle-a's depends_on, so it is ordered first.
    const result = loadPacks(project({ packs: { "cycle-a": { version: "^1.0" } } }));
    expect(result.packs.map((p) => p.id)).toEqual(["cycle-a"]);
    expect(result.errors.some((e) => e.code === "PACK_NOT_FOUND")).toBe(true);
  });

  it("accepts a local override that strengthens", () => {
    const root = project(
      { packs: { base: { version: "^1.0" } } },
      {
        ".warrant/local/gates/tests-passed.json": {
          $schema: "warrant://gate/1",
          id: "tests-passed",
          version: "1.0.1",
          overrides: "base:tests-passed",
          level: "L1",
          requires_evidence: [
            { kind: "test-report", status: "PROVEN" },
            { kind: "review", status: "PROVEN" }
          ],
          waivable: false,
          accepts_attestation: ["ci"]
        }
      }
    );
    const result = loadPacks(root);
    expect(result.errors).toEqual([]);
    const gate = result.objects.find((o) => o.kind === "gate");
    expect(gate?.pack).toBe("local");
    expect(gate?.path).toBe(".warrant/local/gates/tests-passed.json");
  });

  it("reports OVERRIDE_WEAKENS when the override drops a requirement", () => {
    const root = project(
      { packs: { base: { version: "^1.0" } } },
      {
        ".warrant/local/gates/tests-passed.json": {
          $schema: "warrant://gate/1",
          id: "tests-passed",
          version: "1.0.1",
          overrides: "base:tests-passed",
          level: "L1",
          requires_evidence: [],
          waivable: true
        }
      }
    );
    const result = loadPacks(root);
    expect(codes(result.errors)).toEqual(["OVERRIDE_WEAKENS"]);
    expect(result.errors[0]?.message).toContain("test-report");
    expect(result.errors[0]?.message).toContain("waivable");
  });

  it("reports OVERRIDE_INVALID when the target does not exist", () => {
    const root = project(
      { packs: { base: { version: "^1.0" } } },
      {
        ".warrant/local/gates/ghost.json": {
          $schema: "warrant://gate/1",
          id: "ghost",
          version: "1.0.0",
          overrides: "base:no-such-gate",
          level: "L1",
          waivable: false
        }
      }
    );
    expect(codes(loadPacks(root).errors)).toEqual(["OVERRIDE_INVALID"]);
  });

  it("reports DUPLICATE_OBJECT_ID for a local object with a pack id and no overrides", () => {
    const root = project(
      { packs: { base: { version: "^1.0" } } },
      {
        ".warrant/local/gates/tests-passed.json": {
          $schema: "warrant://gate/1",
          id: "tests-passed",
          version: "1.0.1",
          level: "L1",
          waivable: false
        }
      }
    );
    expect(codes(loadPacks(root).errors)).toEqual(["DUPLICATE_OBJECT_ID"]);
  });

  it("adds a local object with a fresh id to the object set", () => {
    const root = project(
      { packs: { base: { version: "^1.0" } } },
      {
        ".warrant/local/gates/local-only.json": {
          $schema: "warrant://gate/1",
          id: "local-only",
          version: "1.0.0",
          level: "L0",
          waivable: false
        }
      }
    );
    const result = loadPacks(root);
    expect(result.errors).toEqual([]);
    expect(result.objects.find((o) => o.id === "local-only")?.pack).toBe("local");
  });

  it("throws CONFIG_MISSING when warrant.json is absent", () => {
    const root = makeTempDir("warrant-empty-");
    tempDirs.push(root);
    expect(() => loadPacks(root)).toThrowError(/warrant.json not found/);
  });

  it("throws CONFIG_INVALID with a pointer path for a malformed warrant.json", () => {
    const root = makeTempDir("warrant-bad-config-");
    tempDirs.push(root);
    mkdirSync(path.join(root, ".warrant"), { recursive: true });
    writeFileSync(
      path.join(root, ".warrant", "warrant.json"),
      JSON.stringify({ $schema: "warrant://config/1", kernel: "0.1", openspec: "1.13.x", packs: { base: {} } })
    );
    try {
      loadPacks(root);
      throw new Error("expected CONFIG_INVALID");
    } catch (thrown) {
      expect((thrown as { code?: string }).code).toBe("CONFIG_INVALID");
      expect((thrown as { path?: string }).path).toContain("/packs/base/version");
    }
    rmSync(root, { recursive: true, force: true });
  });
});

describe("weakenings", () => {
  it("accepts a profile override that only adds", () => {
    const original = { artifacts: { required: ["a"] }, gates: { "A->B": ["g1"] } };
    const override = { artifacts: { required: ["a", "b"] }, gates: { "A->B": ["g1", "g2"] } };
    expect(weakenings("profile", original, override)).toEqual([]);
  });

  it("names every dropped item of a profile override", () => {
    const original = {
      artifacts: { required: ["a"], forbidden: ["f"] },
      gates: { "A->B": ["g1"] },
      capabilities: { forbidden: ["CAP"] },
      approvals: [{ role: "r", at: "A->B" }],
      evidence: { required: ["e"] }
    };
    const lost = weakenings("profile", original, {});
    expect(lost).toEqual([
      "artifacts.required: a",
      "artifacts.forbidden: f",
      "gates.A->B: g1",
      "capabilities.forbidden: CAP",
      "evidence.required: e",
      "approvals: r@A->B"
    ]);
  });

  it("treats a widened accepts_attestation as a weakening", () => {
    const lost = weakenings(
      "gate",
      { accepts_attestation: ["ci"], waivable: false },
      { accepts_attestation: ["ci", "none"], waivable: false }
    );
    expect(lost).toEqual(["accepts_attestation: none"]);
  });
});

describe("loadPacks: rules and evidence kinds (phase 3)", () => {
  it("collects provides.rules and .warrant/local/rules/ (ADR-0022)", () => {
    const root = project(
      { packs: { rules: { version: "^1.0" } } },
      {
        ".warrant/local/rules/local-rule.json": {
          $schema: "warrant://rule/1",
          id: "local-rule",
          paths: ["src/**"],
          text: "Local rule.",
          enforced_by: "validate"
        }
      }
    );
    const result = loadPacks(root);
    expect(result.errors).toEqual([]);
    // Sorted by id, whatever their source.
    expect(result.rules.map((r) => `${r.pack}:${r.id}:${r.enforcedBy ?? "-"}`)).toEqual([
      "rules:json-canonical:fmt --check",
      "rules:language-split:-",
      "local:local-rule:validate"
    ]);
  });

  it("reports DUPLICATE_OBJECT_ID for a local rule that repeats a pack rule id", () => {
    const root = project(
      { packs: { rules: { version: "^1.0" } } },
      {
        ".warrant/local/rules/json-canonical.json": {
          $schema: "warrant://rule/1",
          id: "json-canonical",
          paths: ["**"],
          text: "Again."
        }
      }
    );
    expect(codes(loadPacks(root).errors)).toEqual(["DUPLICATE_OBJECT_ID"]);
  });

  it("normalises both forms of evidence_kinds and reads the metrics schema (D-13)", () => {
    process.env["WARRANT_PACKS_DIR"] = path.join(CLI_ROOT, "..", "..", "packs");
    const result = loadPacks(project({ packs: { "core-sdd": { version: CORE_SDD_RANGE } } }));
    expect(result.errors).toEqual([]);
    const kinds = Object.fromEntries(result.evidenceKinds.map((k) => [k.kind, k.metricsSchema?.path ?? null]));
    expect(Object.keys(kinds)).toEqual(["test-report", "spec-report", "review", "human-approval"]);
    expect(kinds["review"]).toBeNull();
    expect(kinds["test-report"]).toMatch(/packs\/core-sdd\/evidence\/test-report\.metrics\.schema\.json$/);
    const form = result.evidenceKinds[0]?.metricsSchema?.json as { required: string[] };
    expect(form.required).toContain("tests");
  });
});
