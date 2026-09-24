/**
 * Form of the WARRANT development context (ADR-0032 п. 10): every project skill `.claude/skills/<name>/SKILL.md` but
 * OpenSpec's follows the standard of п. 6 (frontmatter, sections Вход → Шаги → Стоп → Отчёт, ≤ 80 lines); there is no
 * `.claude/commands/` and no OpenSpec archive / sync-specs skill (п. 8); `CLAUDE.md` ≤ 100 lines and
 * `packages/cli/CLAUDE.md` ≤ 60 (п. 7); every `docs/handoff/<stream>.md` has the sections of п. 3 in order, ≤ 60 lines,
 * ≤ 5 items to remember; `docs/backlog.md` is one table `ID | Что | Куда | Источник` with unique IDs (п. 5);
 * `docs/NEXT-SESSION.md` is gone (п. 2). ADR-0033 п. 12: a handoff's `После:` names streams with a handoff file in
 * this checkout (a predecessor's last PR removes the line with its file), no cycles; `docs/drafts/` holds dated
 * folders of `NN-<topic>.md` drafts by its README. Rules about decisions (what a stream is, what is computable) stay prose.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { orderStreams, parseAfter } from "../../../../../scripts/dev/brief-lib.js";
import { CLI_ROOT } from "../../helpers/cli.js";

const REPO_ROOT = path.resolve(CLI_ROOT, "..", "..");
const SKILLS = path.join(REPO_ROOT, ".claude", "skills");
const HANDOFF = path.join(REPO_ROOT, "docs", "handoff");
const DRAFTS = path.join(REPO_ROOT, "docs", "drafts");
const DRAFT_SECTIONS = ["Проблема", "Идея", "Вопросы для grilling", "Вне объёма"];

const SKILL_KEYS = ["name", "description", "argument-hint", "disable-model-invocation"];
const SKILL_SECTIONS = ["Вход", "Шаги", "Стоп", "Отчёт"];
const HANDOFF_SECTIONS = ["Цель", "Готовый запрос", "Открытые вопросы", "Не забыть"];
const BACKLOG_HEADER = ["ID", "Что", "Куда", "Источник"];

const read = (...parts: string[]) => readFileSync(path.join(REPO_ROOT, ...parts), "utf8");
const linesOf = (text: string) => text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

/** Lines outside fenced code blocks, with their index. */
function prose(lines: string[]): { line: string; at: number }[] {
  const out: { line: string; at: number }[] = [];
  let fenced = false;
  lines.forEach((line, at) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced) out.push({ line, at });
  });
  return out;
}

/** `## ` headings outside code blocks. */
const sections = (lines: string[]) => prose(lines).filter((l) => l.line.startsWith("## ")).map((l) => l.line.slice(3).trim());

/** Body lines of section `name` (outside code blocks), up to the next `## `. */
function sectionBody(lines: string[], name: string): string[] {
  const outside = prose(lines);
  const start = outside.findIndex((l) => l.line === `## ${name}`);
  if (start < 0) return [];
  const rest = outside.slice(start + 1);
  const end = rest.findIndex((l) => l.line.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).map((l) => l.line);
}

/**
 * Keys of the leading `---` frontmatter, parsed as YAML like Claude Code does (an unquoted ` #` starts a comment and
 * cuts the value); undefined without one or when it is not a YAML mapping.
 */
function frontmatter(lines: string[]): { keys: Record<string, string>; end: number } | undefined {
  if (lines[0] !== "---") return undefined;
  const end = lines.indexOf("---", 1);
  if (end < 0) return undefined;
  let parsed: unknown;
  try {
    parsed = parseYaml(lines.slice(1, end).join("\n"));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const keys = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
  return { keys, end };
}

const projectSkills = readdirSync(SKILLS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("openspec-"))
  .map((d) => d.name)
  .sort();

describe(".claude/skills — standard of ADR-0032 п. 6", () => {
  it("the project skills of п. 8 are present", () => {
    for (const name of ["code-search", "architecture-audit", "decision", "group-done", "group-stats", "handoff", "software-architect", "grilling"]) {
      expect(projectSkills, name).toContain(name);
    }
  });

  it.each(projectSkills)("%s: frontmatter, title, sections Вход → Шаги → Стоп → Отчёт, numbered steps, ≤ 80 lines", (name) => {
    const file = path.join(SKILLS, name, "SKILL.md");
    expect(existsSync(file), `${name}/SKILL.md`).toBe(true);
    const lines = linesOf(readFileSync(file, "utf8"));
    const problems: string[] = [];
    const fm = frontmatter(lines);
    if (fm === undefined) problems.push("no --- frontmatter");
    else {
      for (const key of Object.keys(fm.keys)) if (!SKILL_KEYS.includes(key)) problems.push(`frontmatter key ${key}`);
      if (fm.keys.name !== name) problems.push(`name ${fm.keys.name ?? "(none)"} ≠ directory ${name}`);
      if (!fm.keys.description?.includes("Использовать, когда")) problems.push("description without «Использовать, когда…»");
      const firstBody = lines.slice(fm.end + 1).find((l) => l.trim() !== "");
      if (!firstBody?.startsWith("# ")) problems.push("no # title right after the frontmatter");
    }
    expect(sections(lines)).toEqual(SKILL_SECTIONS);
    if (!sectionBody(lines, "Шаги").some((l) => /^\d+\. /.test(l))) problems.push("Шаги without a numbered step");
    if (lines.length > 80) problems.push(`${lines.length} lines > 80`);
    expect(problems).toEqual([]);
  });

  it("no .claude/commands/ (skills are invoked as /<name>)", () => {
    expect(existsSync(path.join(REPO_ROOT, ".claude", "commands"))).toBe(false);
  });

  it("the skills of ADR-0033 are present; the git-land step files exist", () => {
    for (const name of ["git-start", "git-land", "change-spec-pr", "change-impl-pr", "change-archive-pr", "change-coordinate", "repo-hygiene", "review-impl", "cli-contract"]) {
      expect(projectSkills, name).toContain(name);
    }
    for (const file of ["recovery.md", "ci.md"]) expect(existsSync(path.join(SKILLS, "git-land", file)), file).toBe(true);
  });

  it("agent reviewer reads only: no Write, Edit or NotebookEdit among its tools (ADR-0033 п. 6)", () => {
    const lines = linesOf(read(".claude", "agents", "reviewer.md"));
    const fm = frontmatter(lines);
    expect(fm?.keys.name).toBe("reviewer");
    const tools = (fm?.keys.tools ?? "").split(",").map((t) => t.trim());
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.filter((t) => ["Write", "Edit", "NotebookEdit", "MultiEdit"].includes(t))).toEqual([]);
  });

  it("change-archive-pr archives with warrant archive, never openspec archive (ADR-0033 п. 4, A8)", () => {
    const text = read(".claude", "skills", "change-archive-pr", "SKILL.md");
    expect(text).toContain("$W archive <change>");
    expect(text).toContain("warrant archive");
    expect(text).not.toMatch(/openspec\s+archive/);
  });

  it("no OpenSpec archive / sync-specs skills: a Change closes with warrant archive (ADR-0011 п. 4)", () => {
    for (const name of ["openspec-archive-change", "openspec-sync-specs"]) expect(existsSync(path.join(SKILLS, name)), name).toBe(false);
  });
});

describe("CLAUDE.md — ADR-0032 п. 7", () => {
  it("root CLAUDE.md ≤ 100 lines, packages/cli/CLAUDE.md ≤ 60", () => {
    expect(linesOf(read("CLAUDE.md")).length).toBeLessThanOrEqual(100);
    expect(linesOf(read("packages", "cli", "CLAUDE.md")).length).toBeLessThanOrEqual(60);
  });
});

describe("docs/handoff — ADR-0032 п. 2, 3", () => {
  const streams = existsSync(HANDOFF) ? readdirSync(HANDOFF).filter((f) => f.endsWith(".md")).sort() : [];

  it("docs/NEXT-SESSION.md is gone", () => {
    expect(existsSync(path.join(REPO_ROOT, "docs", "NEXT-SESSION.md"))).toBe(false);
  });

  it.each(streams)("%s: # <stream>, sections in order, ≤ 60 lines, «Не забыть» ≤ 5 items", (file) => {
    const lines = linesOf(readFileSync(path.join(HANDOFF, file), "utf8"));
    expect(lines[0]).toBe(`# ${file.replace(/\.md$/, "")}`);
    expect(sections(lines)).toEqual(HANDOFF_SECTIONS);
    expect(lines.length).toBeLessThanOrEqual(60);
    expect(sectionBody(lines, "Не забыть").filter((l) => /^- /.test(l)).length).toBeLessThanOrEqual(5);
  });

  it("«После:» names streams with a handoff file here, without cycles (ADR-0033 п. 12)", () => {
    const after = new Map(streams.map((f) => [f.replace(/\.md$/, ""), parseAfter(readFileSync(path.join(HANDOFF, f), "utf8"))]));
    const order = orderStreams(after);
    expect(order.filter((s) => s.missing.length > 0).map((s) => `${s.name} → ${s.missing.join(", ")}`)).toEqual([]);
    expect(order.filter((s) => s.cycle).map((s) => s.name)).toEqual([]);
  });
});

describe("docs/drafts — ADR-0033 п. 12", () => {
  const entries = existsSync(DRAFTS) ? readdirSync(DRAFTS, { withFileTypes: true }) : [];
  const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  it("README.md (the rule) and dated folders only", () => {
    expect(entries.filter((e) => !e.isDirectory()).map((e) => e.name)).toEqual(["README.md"]);
    expect(folders.filter((d) => !/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(d))).toEqual([]);
  });

  it.each(folders)("%s: README.md index and NN-<topic>.md files with sections in order", (folder) => {
    const names = readdirSync(path.join(DRAFTS, folder));
    expect(names).toContain("README.md");
    expect(names.filter((n) => n !== "README.md" && !/^\d{2}-[a-z0-9-]+\.md$/.test(n))).toEqual([]);
    for (const n of names.filter((x) => x !== "README.md")) {
      expect(sections(linesOf(readFileSync(path.join(DRAFTS, folder, n), "utf8"))), n).toEqual(DRAFT_SECTIONS);
    }
  });
});

describe("docs/backlog.md — ADR-0032 п. 5", () => {
  const lines = linesOf(read("docs", "backlog.md"));
  const cells = (row: string) =>
    row
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());
  const tableLines = prose(lines).filter((l) => l.line.trimStart().startsWith("|"));

  it("one table ID | Что | Куда | Источник, every row of four cells", () => {
    const blocks = tableLines.filter((l, i) => i === 0 || tableLines[i - 1]!.at !== l.at - 1);
    expect(blocks.length).toBe(1);
    expect(cells(tableLines[0]!.line)).toEqual(BACKLOG_HEADER);
    expect(cells(tableLines[1]!.line).every((c) => /^:?-+:?$/.test(c))).toBe(true);
    const bad = tableLines.slice(2).filter((l) => cells(l.line).length !== 4 || cells(l.line).some((c) => c === ""));
    expect(bad.map((l) => l.line.slice(0, 40))).toEqual([]);
  });

  it("IDs: PREFIX-N, unique", () => {
    const ids = tableLines.slice(2).map((l) => cells(l.line)[0]!);
    expect(ids.filter((id) => !/^[A-Z]+-\d+$/.test(id))).toEqual([]);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});
