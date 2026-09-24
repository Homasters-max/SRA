// e2e: golden
/**
 * Golden-фикстуры pack `core-sdd` (REQ-SDD-009, SCN-SDD-004, 005, 007, 015, 020).
 *
 * Тест гоняет ровно ту же процедуру, что `npm run golden:update`: общий код
 * лежит в `scripts/golden-lib.js`, поэтому скрипт и тест не могут разойтись.
 * Тест только сравнивает — переписывает `expected/*` исключительно скрипт.
 */
// @ts-expect-error — общий helper со скриптом: plain Node ESM без типов (design Decision 8).
import { GOLDEN_NAMES, GOLDEN_ROOT, PACKS_DIR, makeTempRoot, prepareGolden, readExpected, removeDir, runGolden } from "../../../../scripts/golden-lib.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { canonicalText } from "../../src/core/canon/format-json.js";
import { CORE_SDD_VERSION, runCli } from "../helpers/cli.js";

interface GoldenRun {
  root: string;
  changed: string[];
  resolve: Record<string, unknown>;
  status: Record<string, unknown>;
  verify: Record<string, unknown>;
  verifyExit: number;
  verifyErrors: unknown[];
}

const tempRoot: string = makeTempRoot();

afterAll(() => {
  removeDir(tempRoot);
});

/** Побайтное сравнение: канонический текст обеих сторон, как его пишет `warrant fmt`. */
function expectCanonicalEqual(actual: unknown, expected: unknown): void {
  expect(canonicalText(actual as never).text).toBe(canonicalText(expected as never).text);
}

/** `explain[]` как множество пар `item` → источники. */
function sourcesOf(run: GoldenRun, item: string): string[] {
  const explain = run.resolve["explain"] as { item: string; from: string }[];
  return explain.filter((e) => e.item === item).map((e) => e.from);
}

describe("golden-фикстуры core-sdd", () => {
  const runs = new Map<string, GoldenRun>();

  for (const name of GOLDEN_NAMES as string[]) {
    it(`${name}: resolve, status и verify совпадают с expected/* (SCN-SDD-015)`, async () => {
      const run = (await runGolden(name, tempRoot)) as GoldenRun;
      runs.set(name, run);
      // Снимки сравниваются первыми: правка pack, меняющая effective policy,
      // должна показывать diff по policy, а не по локу (SCN-SDD-016).
      expectCanonicalEqual(run.resolve, readExpected(name, "resolve"));
      expectCanonicalEqual(run.status, readExpected(name, "status"));
      expect(run.verifyErrors).toEqual([]);
      expect(run.verifyExit).toBe(0);
      expectCanonicalEqual(run.verify, readExpected(name, "verify"));
      // Фикстура хранит уже синхронизированные лок и сгенерированные файлы.
      expect(run.changed).toEqual([]);
      // verify пишет evidence только в копию: рабочее дерево фикстуры не меняется.
      expect(existsSync(path.join(GOLDEN_ROOT, name, ".warrant", "evidence"))).toBe(false);
    });
  }

  it("feature: adversarial-review приходит и из profile/feature, и из overlay/risk-medium (SCN-SDD-004)", async () => {
    const run = runs.get("feature") ?? ((await runGolden("feature", tempRoot)) as GoldenRun);
    expect(run.resolve["risk_level"]).toBe("MEDIUM");
    expect(sourcesOf(run, "gate:adversarial-review").sort()).toEqual(["overlay/risk-medium", "profile/feature"]);
    const gates = run.resolve["gates"] as Record<string, string[]>;
    expect(gates["SPECIFIED->APPROVED"]).toContain("adversarial-review");
  });

  it("feature: verify PROPOSED->SPECIFIED — три gate PASS и CONTINUE (SCN-SDD-020)", async () => {
    const run = runs.get("feature") ?? ((await runGolden("feature", tempRoot)) as GoldenRun);
    expect(run.verify["gates"]).toEqual({ "ids-valid": "PASS", "required-artifacts-present": "PASS", "spec-valid": "PASS" });
    expect(run.verify["controller_action"]).toBe("CONTINUE");
    expect(run.verify["rule"]).toBeNull();
    expect(run.verifyExit).toBe(0);
  });

  it("chore: LOW, без adversarial-review, risk-low в sources (SCN-SDD-005)", async () => {
    const run = runs.get("chore") ?? ((await runGolden("chore", tempRoot)) as GoldenRun);
    expect(run.resolve["risk_level"]).toBe("LOW");
    const gates = run.resolve["gates"] as Record<string, string[]>;
    expect(gates["SPECIFIED->APPROVED"]).not.toContain("adversarial-review");
    expect(run.resolve["sources"]).toContain(`core-sdd@${CORE_SDD_VERSION}:overlay/risk-low@1.0.0`);
  });

  it("factory-change: HIGH, factory-golden-passed, PRODUCTION_WRITE, наследование feature (SCN-SDD-007)", async () => {
    const run = runs.get("factory-change") ?? ((await runGolden("factory-change", tempRoot)) as GoldenRun);
    expect(run.resolve["risk_level"]).toBe("HIGH");
    const gates = run.resolve["gates"] as Record<string, string[]>;
    expect(gates["VERIFYING->MERGED"]).toContain("factory-golden-passed");
    expect(run.resolve["capabilities"]).toEqual({ forbidden: ["PRODUCTION_WRITE"] });
    // `tests-passed` приходит из profile/feature через `extends`…
    expect(sourcesOf(run, "gate:tests-passed")).toEqual(["profile/feature"]);
    // …а `human-approval` на VERIFYING->MERGED — из overlay/risk-high.
    expect(sourcesOf(run, "gate:human-approval")).toContain("overlay/risk-high");
    expect(gates["VERIFYING->MERGED"]).toContain("human-approval");
  });

  // Проверка (4) `validate` вызывает `openspec schema validate`, поэтому здесь
  // нужен настоящий OpenSpec, а не fake из процедуры выше.
  for (const name of GOLDEN_NAMES as string[]) {
    it(`${name}: warrant validate внутри копии даёт ok: true (REQ-SDD-009)`, async () => {
      const { root } = prepareGolden(name, tempRoot, `${name}-validate`) as { root: string };
      const run = await runCli(["validate"], root, { WARRANT_PACKS_DIR: PACKS_DIR });
      expect(run.json?.errors).toEqual([]);
      expect(run.json?.ok).toBe(true);
      expect(run.status).toBe(0);
    });
  }
});
