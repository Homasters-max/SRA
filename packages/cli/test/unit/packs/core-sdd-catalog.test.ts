/**
 * Каталог pack `packs/core-sdd` как данные (REQ-SDD-001, REQ-SDD-007).
 *
 * Читает файлы pack напрямую: `provides` должен покрывать ровно каталоги
 * объектов, gates ссылок profiles и overlays должны существовать
 * (SCN-SDD-002), `waivable`, `accepts_attestation` и controller rules
 * зафиксированы (SCN-SDD-011, SCN-SDD-012, SCN-SDD-023); форма lock репозитория
 * (SCN-SDD-001).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { bytesHash } from "../../../src/core/canon/hash.js";
import { packContentHash } from "../../../src/core/packs/hash.js";
import { validateFile } from "../../../src/core/schemas/semantic.js";
import { REPO_ROOT } from "../../helpers/cli.js";
import { readJsonFile } from "../../helpers/json.js";

const PACK_DIR = path.join(REPO_ROOT, "packs", "core-sdd");

const manifest = readJsonFile(PACK_DIR, "pack.json");
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
    expect(provides["gates"]).toHaveLength(13);
    expect(provides["gates"]).toContain("gates/spec-approved.json");
    expect(provides["checks"]).toEqual(["checks/openspec-validate.json", "checks/tests-passed.json"]);
    expect(provides["controller_rules"]).toEqual(["controller/rules.json"]);
    expect(provides["skills"]).toEqual(["specification/adversarial-review@^0.2"]);
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

  it("golden/ — единственный каталог pack вне provides, и он осознанно вне (REQ-SDD-009, I-59)", () => {
    // `golden/` не объект policy, а мини-проекты, которыми pack проверяет сам
    // себя: loader их не читает, `packContentHash` исключает (иначе лок фикстуры
    // менял бы хэш, который он же записывает). Тест «нет файлов вне provides»
    // смотрит только каталоги объектов, поэтому исключение фиксируется здесь.
    // `evidence/` держит формы `metrics`, на которые ссылается
    // `provides.evidence_kinds` (SCN-SDD-017): каждый файл там объявлен.
    const objectDirs = new Set(Object.values(OBJECT_DIRS));
    const extra = readdirSync(PACK_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !objectDirs.has(e.name) && e.name !== "openspec")
      .map((e) => e.name)
      .sort();
    expect(extra).toEqual(["evidence", "golden"]);
    const metricsSchemas = (provides["evidence_kinds"] as unknown as (string | { metrics_schema: string })[])
      .flatMap((e) => (typeof e === "string" ? [] : [e.metrics_schema]))
      .sort();
    expect(filesOf("evidence")).toEqual(metricsSchemas);
    for (const name of ["chore", "factory-change", "feature"]) {
      expect(existsSync(path.join(PACK_DIR, "golden", name, "expected", "resolve.json"))).toBe(true);
      expect(existsSync(path.join(PACK_DIR, "golden", name, "expected", "status.json"))).toBe(true);
      expect(existsSync(path.join(PACK_DIR, "golden", name, ".warrant", "warrant.lock.json"))).toBe(true);
    }
    const flat = Object.values(provides).flat();
    expect(flat.some((rel) => typeof rel === "string" && rel.startsWith("golden/"))).toBe(false);
  });

  it("каждый объект проходит свою схему и id равен имени файла (Decision 1)", () => {
    // factory-change — 1.1.0 (REQ-SDD-005: CI workflows и CLI в match.paths), остальные — 1.0.0.
    const versions: Readonly<Record<string, string>> = { "profiles/factory-change.json": "1.1.0" };
    for (const key of ["overlays", "profiles", "gates", "checks"]) {
      for (const rel of provides[key] as string[]) {
        const json = readJsonFile(PACK_DIR, rel);
        const result = validateFile(json, rel);
        expect(result.ok, `${rel}: ${JSON.stringify(result.ok ? [] : result.errors)}`).toBe(true);
        expect(json.id).toBe(path.basename(rel, ".json"));
        expect(json.version, rel).toBe(versions[rel] ?? "1.0.0");
        expect(json.$schema).toBe(`warrant://${key.replace(/s$/, "")}/1`);
      }
    }
  });

  it("waivable: true только у branch-isolated, analyze-clean, adversarial-review и spec-approved (SCN-SDD-011)", () => {
    const waivable = (provides["gates"] as string[])
      .map((rel) => readJsonFile(PACK_DIR, rel))
      .filter((g) => g.waivable === true)
      .map((g) => g.id)
      .sort();
    expect(waivable).toEqual(["adversarial-review", "analyze-clean", "branch-isolated", "spec-approved"]);
    for (const rel of provides["gates"] as string[]) {
      const gate = readJsonFile(PACK_DIR, rel);
      expect(typeof gate.waivable).toBe("boolean");
      expect(["L0", "L1", "L2"]).toContain(gate.level);
    }
  });

  it("merge-gates принимают только ci; spec-approved — L0 без requires_evidence, waivable (SCN-SDD-023)", () => {
    for (const rel of ["gates/tests-passed.json", "gates/factory-golden-passed.json"]) {
      expect(readJsonFile(PACK_DIR, rel).accepts_attestation, rel).toEqual(["ci"]);
    }
    const specApproved = readJsonFile(PACK_DIR, "gates/spec-approved.json");
    expect(specApproved).not.toHaveProperty("requires_evidence");
    expect(specApproved.waivable).toBe(true);
    expect(specApproved.level).toBe("L0");
  });

  it("каждый gate из profile или overlay объявлен в provides.gates (SCN-SDD-002)", () => {
    const declared = new Set(
      (provides["gates"] as string[]).map((rel) => path.basename(rel, ".json"))
    );
    const referenced = new Set<string>();
    for (const key of ["profiles", "overlays"]) {
      for (const rel of provides[key] as string[]) {
        const gates = (readJsonFile(PACK_DIR, rel).gates ?? {}) as Record<string, string[]>;
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
    const doc = readJsonFile(PACK_DIR, "controller/rules.json");
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
    const tests = readJsonFile(PACK_DIR, "checks/tests-passed.json");
    expect(tests.run).toBeUndefined();
    expect(tests.parser).toBe("junit");
    expect(tests.produces).toEqual(["test-report"]);
    const openspec = readJsonFile(PACK_DIR, "checks/openspec-validate.json");
    expect(openspec.run.command).toEqual(["openspec", "validate", "{change}", "--strict", "--json"]);
    expect(openspec.produces).toEqual(["spec-report"]);
    expect(openspec.parser).toBe("openspec-validate");
  });

  it("checks несут execution: openspec-validate — {change} и timeout 300, tests-passed — exclusive без run (SCN-SDD-018)", () => {
    const openspec = readJsonFile(PACK_DIR, "checks/openspec-validate.json");
    expect(openspec.run.command).toContain("{change}");
    expect(openspec.execution).toEqual({ timeout_s: 300 });
    const tests = readJsonFile(PACK_DIR, "checks/tests-passed.json");
    expect(tests.execution).toEqual({ exclusive: true });
    expect(tests.run).toBeUndefined();
    for (const rel of ["checks/openspec-validate.json", "checks/tests-passed.json"]) {
      const result = validateFile(readJsonFile(PACK_DIR, rel), rel);
      expect(result.ok, `${rel}: ${JSON.stringify(result.ok ? [] : result.errors)}`).toBe(true);
    }
  });

  it("версия 0.3.x, kernel >=0.1 <0.8, rules пуст, pack.json валиден (REQ-SDD-001, SCN-KRN-012)", () => {
    // REQ-SDD-001 называет 0.3.x, kernel <0.8 — delta phase-4c; patch растёт по дисциплине версий (R-14).
    expect(manifest.version).toMatch(/^0\.3\.\d+$/);
    expect(manifest.kernel).toBe(">=0.1 <0.8");
    expect(provides["rules"]).toEqual([]);
    const result = validateFile(manifest, "pack.json");
    expect(result.ok, JSON.stringify(result.ok ? [] : result.errors)).toBe(true);
  });

  it("evidence_kinds: test-report, spec-report и review — объекты с существующими metrics_schema, human-approval — строка (SCN-SDD-017, SCN-SDD-024)", () => {
    const kinds = provides["evidence_kinds"] as unknown as (string | { kind: string; metrics_schema: string })[];
    expect(kinds).toEqual([
      { kind: "test-report", metrics_schema: "evidence/test-report.metrics.schema.json" },
      { kind: "spec-report", metrics_schema: "evidence/spec-report.metrics.schema.json" },
      { kind: "review", metrics_schema: "evidence/review.metrics.schema.json" },
      "human-approval"
    ]);
    const shapes: Record<string, Record<string, string>> = {
      "test-report": { tests: "integer", failures: "integer", errors: "integer", skipped: "integer" },
      "spec-report": { issues: "integer" },
      review: { BLOCKER: "integer", MAJOR: "integer", MINOR: "integer", INFO: "integer" }
    };
    for (const entry of kinds) {
      if (typeof entry === "string") continue;
      expect(existsSync(path.join(PACK_DIR, entry.metrics_schema)), entry.metrics_schema).toBe(true);
      const schema = readJsonFile(PACK_DIR, entry.metrics_schema);
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.type).toBe("object");
      const types = Object.fromEntries(
        Object.entries(schema.properties as Record<string, { type: string }>).map(([k, v]) => [k, v.type])
      );
      expect(types).toEqual(shapes[entry.kind]);
    }
  });

  it("каждый kind, который производит check pack, объявлен в evidence_kinds (REQ-SDD-001)", () => {
    const declared = new Set(
      (provides["evidence_kinds"] as unknown as (string | { kind: string })[]).map((e) =>
        typeof e === "string" ? e : e.kind
      )
    );
    for (const rel of provides["checks"] as string[]) {
      for (const kind of readJsonFile(PACK_DIR, rel).produces as string[]) expect(declared.has(kind), `${rel}: ${kind}`).toBe(true);
    }
  });

  it("openspec/rules.json: rules.design требует строку I-N для отклонения от spec (REQ-SDD-007)", () => {
    const rules = readJsonFile(PACK_DIR, "openspec/rules.json");
    expect(rules.rules.design).toContain(
      "Record every deviation from the spec as an I-N row in the decisions table of design.md"
    );
  });

  it("skill adversarial-review лежит на месте с frontmatter 0.2.0 (REQ-SDD-008)", () => {
    const file = path.join(REPO_ROOT, "sra", "skills", "specification", "adversarial-review", "SKILL.md");
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, "utf8");
    expect(text.startsWith("---\n")).toBe(true);
    const frontmatter = text.slice(4, text.indexOf("\n---", 4));
    expect(frontmatter).toMatch(/^name: adversarial-review$/m);
    expect(frontmatter).toMatch(/^version: 0\.2\.0$/m);
    expect(frontmatter).toMatch(/^description: .+$/m);
  });

  it("lock репозитория: в packs[\"core-sdd\"] версия pack и один hash его содержимого, в skills — версия, путь и hash skill (SCN-SDD-001)", () => {
    // `warrant validate` на корне репозитория держит шаг CI; здесь — форма lock из THEN (BL-26).
    const lock = readJsonFile(REPO_ROOT, ".warrant/warrant.lock.json");
    expect(lock.packs["core-sdd"]).toEqual({ version: manifest.version, source: "bundled", hash: packContentHash(PACK_DIR) });
    const skill = "sra/skills/specification/adversarial-review/SKILL.md";
    expect(lock.skills["specification/adversarial-review"]).toEqual({
      version: "0.2.0",
      path: skill,
      hash: bytesHash(readFileSync(path.join(REPO_ROOT, ...skill.split("/"))))
    });
  });
});
