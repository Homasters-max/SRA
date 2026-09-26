/**
 * Skill `specification/adversarial-review` pack `core-sdd` как текст (REQ-SDD-008).
 *
 * Читает `sra/skills/specification/adversarial-review/SKILL.md` (поля
 * frontmatter — `core-sdd-catalog.test.ts`): версия входит в диапазон
 * `provides.skills` pack, текст называет семь категорий, четыре `severity`
 * с критерием `BLOCKER`, envelope `warrant://skill-result/1` и запрет правки
 * (SCN-SDD-025); пример envelope проходит схему.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { validateFile } from "../../../src/core/schemas/semantic.js";
import { versionSatisfies } from "../../../src/core/version-range.js";
import { REPO_ROOT } from "../../helpers/cli.js";

const SKILL_ID = "specification/adversarial-review";
const text = readFileSync(path.join(REPO_ROOT, "sra", "skills", SKILL_ID, "SKILL.md"), "utf8");
const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, "packs", "core-sdd", "pack.json"), "utf8"));

/** Значение ключа frontmatter `SKILL.md`. */
function frontmatter(key: string): string | undefined {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  return new RegExp(`^${key}: (.+)$`, "m").exec(head)?.[1]?.trim();
}

describe("skill specification/adversarial-review (REQ-SDD-008)", () => {
  it("its frontmatter version is inside the range of provides.skills of the pack", () => {
    const version = frontmatter("version") ?? "";
    const ref = (manifest.provides.skills as string[]).find((s) => s.startsWith(`${SKILL_ID}@`)) ?? "";
    expect(versionSatisfies(version, ref.slice(SKILL_ID.length + 1))).toBe(true);
  });

  it("names seven categories, four severities with the BLOCKER criterion, the envelope and the ban on edits (SCN-SDD-025)", () => {
    for (const category of [
      "ambiguity",
      "missing-boundary",
      "missing-actor",
      "missing-error-behavior",
      "hidden-assumption",
      "contradiction",
      "implementation-leakage"
    ]) {
      expect(text).toContain(`| \`${category}\` |`);
    }
    for (const severity of ["BLOCKER", "MAJOR", "MINOR", "INFO"]) expect(text).toContain(`| \`${severity}\` |`);
    expect(text).toMatch(/\| `BLOCKER` \| Без исправления реализация по spec неверна или непроверяема/);
    expect(text).toContain("warrant://skill-result/1");
    expect(text).toMatch(/MUST NOT\s+править, создавать и удалять файлы/);
    expect(text).toMatch(/MUST NOT содержать `gate_verdict` и `evidence_status`/);
  });

  it("its envelope example passes warrant://skill-result/1 and names the skill version", () => {
    const block = /```json\r?\n([\s\S]*?)\r?\n```/.exec(text)?.[1] ?? "";
    const envelope = JSON.parse(block);
    expect(envelope.skill).toBe(`${SKILL_ID}@${frontmatter("version")}`);
    expect(validateFile(envelope, "example.result.json")).toMatchObject({ ok: true });
  });
});
