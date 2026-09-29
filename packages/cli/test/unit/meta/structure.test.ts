/**
 * Structure of the repository (ADR-0033 п. 13): the top level holds only the white-listed tracked entries (a new
 * top-level directory is a decision — an edit of this list); ignored entries (`.gitignore`, `info/exclude`) are not
 * seen, as `git ls-files` would not see them. Names: no spaces in any path; no NUL byte in files of `packages/`,
 * `scripts/`, `docs/`, `openspec/` (git would take the file for binary and hide its diff, A-22); `docs/` holds only
 * `.md` and `.json`, kebab-case latin names — normative `NN[a-z]?-<topic>.md`, ADR `WARRANT-ADR-NNNN-<slug>.md`, dated
 * `YYYY-MM-DD-<topic>` in `docs/archive/` and `docs/process/audits/`, `README.md` anywhere. `lattice/` is not ours
 * (`AGENTS.md`) and is not walked.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CLI_ROOT } from "../../helpers/cli.js";

const REPO_ROOT = path.resolve(CLI_ROOT, "..", "..");

/** Tracked top-level entries. */
const ROOT_WHITE_LIST = [
  ".claude",
  ".gitattributes",
  ".github",
  ".gitignore",
  ".warrant",
  "AGENTS.md",
  "CHANGELOG.md",
  "README.md",
  "docs",
  "lattice",
  "openspec",
  "package-lock.json",
  "package.json",
  "packages",
  "packs",
  "scripts",
  "sra",
];
/** Walked for spaces; `lattice/` belongs to another component. */
const WALKED = [".claude", ".github", ".warrant", "docs", "openspec", "packages", "packs", "scripts", "sra"];
/** Walked for NUL bytes: a NUL in a text file makes git treat it as binary (A-22); a control character is escaped. */
const TEXT_WALKED = ["docs", "openspec", "packages", "scripts"];
const KEBAB = /^[a-z0-9][a-z0-9.-]*$/;
const DATED = /^\d{4}-\d{2}-\d{2}(-[a-z0-9-]+)?(\.[a-z]+)?$/;

/** The common git dir of this checkout (a linked worktree has a `.git` file pointing into it). */
function commonGitDir(): string | null {
  const dotGit = path.join(REPO_ROOT, ".git");
  if (!existsSync(dotGit)) return null;
  if (statSync(dotGit).isDirectory()) return dotGit;
  const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
  if (!m) return null;
  const gitDir = path.resolve(REPO_ROOT, m[1]!.trim());
  const common = path.join(gitDir, "commondir");
  return existsSync(common) ? path.resolve(gitDir, readFileSync(common, "utf8").trim()) : gitDir;
}

/** Top-level names ignored by simple patterns (`name`, `name/`, `/name`) of `.gitignore` and `info/exclude`. */
function ignoredTopLevel(): Set<string> {
  const files = [path.join(REPO_ROOT, ".gitignore")];
  const common = commonGitDir();
  if (common) files.push(path.join(common, "info", "exclude"));
  const names = new Set([".git"]);
  for (const f of files.filter((x) => existsSync(x))) {
    for (const raw of readFileSync(f, "utf8").split(/\r?\n/)) {
      const line = raw.trim().replace(/^\//, "").replace(/\/$/, "");
      if (line && !line.startsWith("#") && !line.startsWith("!") && !/[*?[/]/.test(line)) names.add(line);
    }
  }
  return names;
}

const ignored = ignoredTopLevel();

/** Every path under `dir` (relative to the repo, `/`), skipping ignored names at any depth. */
function walk(dir: string): string[] {
  const out: string[] = [];
  const abs = path.join(REPO_ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (ignored.has(e.name)) continue;
    const rel = `${dir}/${e.name}`;
    out.push(rel);
    if (e.isDirectory()) out.push(...walk(rel));
  }
  return out;
}

describe("repository structure — ADR-0033 п. 13", () => {
  it("the top level holds only white-listed entries", () => {
    const top = readdirSync(REPO_ROOT).filter((n) => !ignored.has(n));
    expect(top.filter((n) => !ROOT_WHITE_LIST.includes(n)).sort()).toEqual([]);
  });

  it("no spaces in paths", () => {
    expect(WALKED.flatMap(walk).filter((p) => /\s/.test(p))).toEqual([]);
  });

  it("no NUL bytes in files of packages/, scripts/, docs/, openspec/ — A-22", () => {
    const files = TEXT_WALKED.flatMap(walk).filter((p) => statSync(path.join(REPO_ROOT, p)).isFile());
    expect(files.filter((p) => readFileSync(path.join(REPO_ROOT, p)).includes(0))).toEqual([]);
  });

  const docs = walk("docs");

  it("docs/ holds only .md and .json — no binaries", () => {
    const files = docs.filter((p) => statSync(path.join(REPO_ROOT, p)).isFile());
    expect(files.filter((p) => !/\.(md|json)$/.test(p))).toEqual([]);
  });

  it("docs/ names: kebab-case latin, README.md, ADR names in docs/adr/", () => {
    const bad = docs.filter((p) => {
      const name = p.split("/").pop()!;
      if (name === "README.md") return false;
      if (p.startsWith("docs/adr/")) return !/^WARRANT-ADR-\d{4}-[a-z0-9-]+\.md$/.test(name);
      return !KEBAB.test(name);
    });
    expect(bad).toEqual([]);
  });

  it("normative documents at the docs/ root are NN[a-z]?-<topic>.md (and backlog.md)", () => {
    const root = docs.filter((p) => p.split("/").length === 2 && p.endsWith(".md"));
    expect(root.filter((p) => !/^docs\/(\d{2}[a-z]?-[a-z0-9-]+|backlog)\.md$/.test(p))).toEqual([]);
  });

  it("docs/archive/ and docs/process/audits/ entries are dated YYYY-MM-DD-<topic>", () => {
    const dated = docs.filter((p) => /^docs\/(archive|process\/audits)\/[^/]+$/.test(p));
    expect(dated.filter((p) => !DATED.test(p.split("/").pop()!))).toEqual([]);
  });
});
