/**
 * Каталог pack `packs/core-sdd` как данные (REQ-SDD-001, REQ-SDD-007).
 *
 * Читает файлы pack напрямую: `provides` должен покрывать ровно каталоги
 * объектов, gates ссылок profiles и overlays должны существовать
 * (SCN-SDD-002), `waivable` и controller rules зафиксированы
 * (SCN-SDD-011, SCN-SDD-012).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { validateFile } from "../../../src/core/schemas/semantic.js";
import { REPO_ROOT } from "../../helpers/cli.js";

const PACK_DIR = path.join(REPO_ROOT, "packs", "core-sdd");

function readJson(rel: string): any {
  return JSON.parse(readFileSync(path.join(PACK_DIR, rel), "utf8"));
}

const manifest = readJson("pack.json");
const provides = manifest.provides as Record<string, string[] | string>;

/** Файлы `*.json` каталога объектов, как пути относительно pack. */
function filesOf(dir: string): string[] {
  const absolute = path.join(PACK_DIR, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => `${dir}/${n}`);
}

const OBJECT_DIRS: Readonly<Record<string, string>> = {
  overlays: "overlays",
  profiles: "profiles",
  gates: "gates",
  checks: "checks",
  controller_rules: "controller",
  risk_floors: "risk",
  risk_levels: "risk"
};

describe("pack core-sdd: каталог", () => {
  it("provides перечисляет overlays, profiles, gates, checks и controller rules (REQ-SDD-001)", () => {
    expect(provides["overlays"]).toEqual([
      "overlays/core-default.json",
      "overlays/risk-high.json",
      "overlays/risk-low.json",
      "overlays/risk-medium.json"
    ]);
    expect(provides["profiles"]).toEqual([
      "profiles/chore.json",
      "profiles/factory-change.json",
      "profiles/feature.json"
    ]);
    expect(provides["gates"]).toHaveLength(12);
    expect(provides["checks"]).toEqual(["checks/openspec-validate.json", "checks/tests-passed.json"]);
    expect(provides["controller_rules"]).toEqual(["controller/rules.json"]);
    expect(provides["skills"]).toEqual(["specification/adversarial-review@^0.1"]);
  });

  it("каждый список provides отсортирован и каждый путь существует", () => {
    for (const key of Object.keys(OBJECT_DIRS)) {
      const list = (provides[key] ?? []) as string[];
      expect([...list].sort()).toEqual(list);
      for (const rel of list) expect(existsSync(path.join(PACK_DIR, rel))).toBe(true);
    }
  });

  it("нет файлов в каталогах объектов вне provides", () => {
    const declared = new Set(
      Object.keys(OBJECT_DIRS).flatMap((key) => (provides[key] ?? []) as string[])
    );
    const onDisk = new Set(
      [...new Set(Object.values(OBJECT_DIRS))].flatMap((dir) => filesOf(dir))
    );
    expect([...onDisk].sort()).toEqual([...declared].sort());
  });

  it("каждый объект проходит свою схему и id равен имени файла (Decision 1)", () => {
    for (const key of ["overlays", "profiles", "gates", "checks"]) {
      for (const rel of provides[key] as string[]) {
        const json = readJson(rel);
        const result = validateFile(json, rel);
        expect(result.ok, `${rel}: ${JSON.stringify(result.ok ? [] : result.errors)}`).toBe(true);
        expect(json.id).toBe(path.basename(rel, ".json"));
        expect(json.version).toBe("1.0.0");
        expect(json.$schema).toBe(`warrant://${key.replace(/s$/, "")}/1`);
      }
    }
  });

  it("waivable: true только у branch-isolated, analyze-clean и adversarial-review (SCN-SDD-011)", () => {
    const waivable = (provides["gates"] as string[])
      .map((rel) => readJson(rel))
      .filter((g) => g.waivable === true)
      .map((g) => g.id)
      .sort();
    expect(waivable).toEqual(["adversarial-review", "analyze-clean", "branch-isolated"]);
    for (const rel of provides["gates"] as string[]) {
      const gate = readJson(rel);
      expect(typeof gate.waivable).toBe("boolean");
      expect(["L0", "L1", "L2"]).toContain(gate.level);
    }
  });

  it("каждый gate из profile или overlay объявлен в provides.gates (SCN-SDD-002)", () => {
    const declared = new Set(
      (provides["gates"] as string[]).map((rel) => path.basename(rel, ".json"))
    );
    const referenced = new Set<string>();
    for (const key of ["profiles", "overlays"]) {
      for (const rel of provides[key] as string[]) {
        const gates = (readJson(rel).gates ?? {}) as Record<string, string[]>;
        for (const list of Object.values(gates)) for (const id of list) referenced.add(id);
      }
    }
    expect(referenced.size).toBeGreaterThan(0);
    for (const id of referenced) expect(declared.has(id), `gate ${id} is not provided`).toBe(true);
    // Gates чужих packs не упоминаются.
    expect(referenced.has("mutation-score")).toBe(false);
    expect(referenced.has("rollback-rehearsed")).toBe(false);
  });

  it("controller/rules.json: ровно три правила, первое — POLICY_CONFLICT (SCN-SDD-012, I-48)", () => {
    const doc = readJson("controller/rules.json");
    const result = validateFile(doc, "controller/rules.json");
    expect(result.ok).toBe(true);
    expect(doc.$schema).toBe("warrant://controller-rules/1");
    expect(doc.rules).toHaveLength(3);
    expect(doc.rules[0].when).toEqual({ policy_conflict: true });
    expect(doc.rules[0].action).toBe("ESCALATE");
    expect(doc.rules[1].when).toEqual({ gate_verdict: "FAIL" });
    expect(doc.rules[1].action).toBe("WAIT");
    expect(doc.rules[2]).toEqual({
      id: "blocking-unknown",
      when: { blocking_unknowns: ">0" },
      action: "WAIT",
      next: "clarify"
    });
  });

  it("check tests-passed описывает только формат, openspec-validate — команду (REQ-SDD-007)", () => {
    const tests = readJson("checks/tests-passed.json");
    expect(tests.run).toBeUndefined();
    expect(tests.parser).toBe("junit");
    expect(tests.produces).toEqual(["test-report"]);
    const openspec = readJson("checks/openspec-validate.json");
    expect(openspec.run.command).toEqual(["openspec", "validate", "--strict", "--json"]);
    expect(openspec.produces).toEqual(["spec-report"]);
  });

  it("skill adversarial-review лежит на месте с frontmatter 0.1.0 (REQ-SDD-008)", () => {
    const file = path.join(REPO_ROOT, "sra", "skills", "specification", "adversarial-review", "SKILL.md");
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, "utf8");
    expect(text.startsWith("---\n")).toBe(true);
    const frontmatter = text.slice(4, text.indexOf("\n---", 4));
    expect(frontmatter).toMatch(/^name: adversarial-review$/m);
    expect(frontmatter).toMatch(/^version: 0\.1\.0$/m);
    expect(frontmatter).toMatch(/^description: .+$/m);
  });
});
