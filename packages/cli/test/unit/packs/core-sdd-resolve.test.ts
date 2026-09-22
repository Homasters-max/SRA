/**
 * Эффективная policy настоящего pack `packs/core-sdd` (REQ-SDD-002…006).
 *
 * Тест работает не на фикстурах, а на поставляемом pack: он фиксирует данные
 * 0.1 как контракт — SCN-SDD-003, SCN-SDD-009 и gates трёх profiles.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadPacks } from "../../../src/core/packs/loader.js";
import { resolveForProject, type Classification } from "../../../src/core/resolve/index.js";
import type { EffectivePolicy } from "../../../src/core/resolve/types.js";
import { REPO_ROOT, makeTempDir, removeDir } from "../../helpers/cli.js";

const PACKS_DIR = path.join(REPO_ROOT, "packs");
let root: string;

beforeAll(() => {
  process.env["WARRANT_PACKS_DIR"] = PACKS_DIR;
  root = makeTempDir("warrant-core-sdd-");
  const config = path.join(root, ".warrant", "warrant.json");
  mkdirSync(path.dirname(config), { recursive: true });
  writeFileSync(
    config,
    JSON.stringify(
      {
        $schema: "warrant://config/1",
        kernel: "0.1",
        openspec: "1.13.x",
        packs: { "core-sdd": { version: "^0.1" } }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
});

afterAll(() => {
  delete process.env["WARRANT_PACKS_DIR"];
  removeDir(root);
});

/** Эффективная policy для одной classification; ошибок слоёв быть не должно. */
function policyFor(classification?: Classification): EffectivePolicy {
  const loaded = loadPacks(root);
  expect(loaded.errors).toEqual([]);
  const { result, errors } = resolveForProject(loaded, classification);
  expect(errors).toEqual([]);
  if (!result.ok) throw new Error(`POLICY_CONFLICT: ${result.conflict.message}`);
  return result.policy;
}

/** Минимальные значения всех измерений, кроме заданных. */
function minimalRisk(over: Record<string, string> = {}): Classification["risk"] {
  const base: Record<string, string> = {
    data_loss: "NONE",
    reversibility: "EASY",
    blast_radius: "LOCAL",
    security_impact: "NONE",
    compatibility: "COMPATIBLE",
    ...over
  };
  return Object.fromEntries(
    Object.entries(base).map(([k, value]) => [k, { value, from: "test" }])
  ) as Classification["risk"];
}

describe("pack core-sdd: эффективная policy", () => {
  it("пустая classification даёт core-default и risk-medium (SCN-SDD-003)", () => {
    const policy = policyFor();
    expect(policy.gates["PROPOSED->SPECIFIED"]).toEqual(["ids-valid", "spec-valid"]);
    expect(policy.risk_level).toBe("MEDIUM");
    expect(policy.sources.some((s) => s.includes("overlay/core-default"))).toBe(true);
    // Без classification risk-слой пуст (SCN-KRN-068), поэтому risk-medium
    // приходит из classification с пустым risk ниже, а не отсюда.
    expect(policy.sources.some((s) => s.includes("overlay/risk-medium"))).toBe(false);
  });

  it("classification без измерений: MEDIUM, sources содержит core-default и risk-medium (SCN-SDD-003)", () => {
    const policy = policyFor({ profiles: [] });
    expect(policy.gates["PROPOSED->SPECIFIED"]).toEqual(["ids-valid", "spec-valid"]);
    expect(policy.risk_level).toBe("MEDIUM");
    expect(policy.sources).toContain("core-sdd@0.1.0:overlay/core-default@1.0.0");
    expect(policy.sources).toContain("core-sdd@0.1.0:overlay/risk-medium@1.0.0");
  });

  it("reversibility IRREVERSIBLE поднимает уровень до HIGH (SCN-SDD-009)", () => {
    const policy = policyFor({
      profiles: [],
      risk: minimalRisk({ reversibility: "IRREVERSIBLE" })
    });
    expect(policy.risk_level).toBe("HIGH");
    expect(policy.sources).toContain("core-sdd@0.1.0:overlay/risk-high@1.0.0");
    expect(policy.sources).not.toContain("core-sdd@0.1.0:overlay/risk-medium@1.0.0");
    expect(policy.gates["VERIFYING->MERGED"]).toContain("human-approval");
    expect(policy.approvals).toContainEqual({ role: "maintainer", at: "VERIFYING->MERGED" });
  });

  it("profile feature: gates по переходам как в 04 §5 (REQ-SDD-003)", () => {
    const policy = policyFor({ profiles: ["feature"], risk: minimalRisk() });
    expect(policy.risk_level).toBe("LOW");
    expect(policy.sources).toContain("core-sdd@0.1.0:overlay/risk-low@1.0.0");
    expect(policy.gates).toEqual({
      "PROPOSED->SPECIFIED": ["ids-valid", "required-artifacts-present", "spec-valid"],
      "SPECIFIED->APPROVED": [
        "adversarial-review",
        "blocking-unknowns-resolved",
        "human-approval",
        "ids-valid",
        "required-artifacts-present",
        "spec-valid"
      ],
      "APPROVED->IMPLEMENTING": ["branch-isolated"],
      "VERIFYING->MERGED": ["analyze-clean", "evidence-complete", "ids-valid", "scope-valid", "tests-passed"],
      "MERGED->ARCHIVED": ["analyze-clean", "ids-valid", "required-artifacts-present", "spec-valid"]
    });
    expect(policy.artifacts.required).toEqual(["design", "proposal", "specs", "tasks"]);
    expect(policy.evidence.required).toEqual(["human-approval", "review", "test-report"]);
    expect(policy.approvals).toEqual([{ role: "maintainer", at: "SPECIFIED->APPROVED" }]);
  });

  it("profile feature на MEDIUM получает adversarial-review из overlay", () => {
    const policy = policyFor({ profiles: ["feature"] });
    expect(policy.gates["SPECIFIED->APPROVED"]).toContain("adversarial-review");
    const from = policy.explain.filter((e) => e.item === "gate:adversarial-review").map((e) => e.from);
    expect(from).toContain("profile/feature");
    expect(from).toContain("overlay/risk-medium");
  });

  it("profile chore: без adversarial-review на LOW (REQ-SDD-004)", () => {
    const policy = policyFor({ profiles: ["chore"], risk: minimalRisk() });
    expect(policy.risk_level).toBe("LOW");
    expect(policy.gates["SPECIFIED->APPROVED"]).not.toContain("adversarial-review");
    expect(policy.gates["SPECIFIED->APPROVED"]).toEqual([
      "human-approval",
      "ids-valid",
      "required-artifacts-present",
      "spec-valid"
    ]);
    expect(policy.artifacts.required).toEqual(["proposal", "tasks"]);
    expect(policy.artifacts.recommended).toEqual(["design"]);
  });

  it("profile factory-change: golden gate, PRODUCTION_WRITE и gates feature через extends (REQ-SDD-005)", () => {
    const policy = policyFor({
      profiles: ["factory-change"],
      risk: minimalRisk({ blast_radius: "SYSTEM" })
    });
    expect(policy.risk_level).toBe("HIGH");
    expect(policy.gates["VERIFYING->MERGED"]).toContain("factory-golden-passed");
    expect(policy.capabilities.forbidden).toEqual(["PRODUCTION_WRITE"]);
    // `tests-passed` не объявлен в factory-change — он приходит из profile feature.
    expect(policy.gates["VERIFYING->MERGED"]).toContain("tests-passed");
    expect(policy.explain.filter((e) => e.item === "gate:tests-passed").map((e) => e.from)).toContain(
      "profile/feature"
    );
    expect(policy.explain.filter((e) => e.item === "gate:human-approval").map((e) => e.from)).toContain(
      "overlay/risk-high"
    );
  });
});
