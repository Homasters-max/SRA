/**
 * Hygiene (ADR-0033 п. 13): `scripts/dev/hygiene-lib.js` finds what is superfluous — merged branches and their
 * worktrees, ignored leftovers, expiring waivers, stale drafts and audit snapshots (older than the tag, or code moved
 * on since the snapshot's commit), broken relative links, auto-memory —
 * and says who removes it (auto / pr / confirm). IO injected; a branch is merged only when its tip is the second
 * parent of a merge on main.
 */
import { describe, expect, it } from "vitest";

import { collectState } from "../../../../../scripts/dev/brief-lib.js";
import { AUDIT_STALE_FILES, findings, formatFindings, relativeLinks } from "../../../../../scripts/dev/hygiene-lib.js";

const ROOT = "D:/project/SRA";
type Io = Parameters<typeof findings>[0];

interface Repo {
  worktrees?: string;
  merged?: string;
  origin?: string | null;
  tips?: Record<string, string>;
  merges?: string;
  status?: Record<string, string>;
  tags?: string;
  tagDate?: string;
  diff?: Record<string, string>;
  tree?: string;
  files?: Record<string, string>;
  dirs?: Record<string, { name: string; dir: boolean }[]>;
}

const porcelain = (...entries: string[][]) => `${entries.map((e) => e.join("\n")).join("\n\n")}\n`;
const file = (name: string) => ({ name, dir: false });
const dir = (name: string) => ({ name, dir: true });

function fakeIo(repo: Repo = {}): Io {
  const files: Record<string, string> = { [`${ROOT}/package.json`]: '{"version":"0.4.2"}', ...repo.files };
  const dirs = repo.dirs ?? {};
  return {
    startDir: ROOT,
    home: "C:/Users/dev",
    today: "2026-09-25",
    git(args: string[], cwd: string) {
      const key = args.join(" ");
      if (key === "rev-parse --show-toplevel") return `${ROOT}\n`;
      if (key === "branch --show-current") return "main\n";
      if (key === "status --porcelain") return repo.status?.[cwd] ?? "";
      if (key === "worktree list --porcelain") return repo.worktrees ?? porcelain([`worktree ${ROOT}`, "HEAD 1", "branch refs/heads/main"]);
      if (key === "tag -l v*") return repo.tags ?? "";
      if (key === "show-ref --verify --quiet refs/heads/main") return "";
      if (key.startsWith("branch --merged main")) return repo.merged ?? "main\n";
      if (key === "show-ref --verify --quiet refs/remotes/origin/main") return repo.origin == null ? null : "";
      if (key.startsWith("branch -r --merged origin/main")) return repo.origin ?? null;
      if (key.startsWith("log main --merges")) return repo.merges ?? "";
      if (key.startsWith("rev-parse --verify --quiet ")) return repo.tips?.[args[3]!] ?? null;
      if (key.startsWith("log -1 --format=%cs")) return repo.tagDate ?? null;
      if (key.startsWith("diff --name-only ")) return repo.diff?.[args[2]!] ?? null;
      if (key.startsWith("ls-tree -r --name-only main")) return repo.tree ?? "";
      return null;
    },
    readFile: (p: string) => files[p] ?? null,
    readDir: (p: string) => dirs[p] ?? null,
    exists: (p: string) => p in files || p in dirs,
  } as Io;
}

const run = (repo: Repo) => {
  const io = fakeIo(repo);
  return findings(io, collectState(io));
};
const kinds = (list: ReturnType<typeof findings>) => list.map((f) => `${f.kind}:${f.action}:${f.item}`);

describe("hygiene — ADR-0033 п. 13", () => {
  it("a merged branch is one whose tip is a merge's second parent; a fresh branch at main is not", () => {
    const list = run({
      merged: "main\nprocess/done\nprocess/fresh\n",
      merges: "m1 aaa\nm0 bbb\n",
      tips: { "process/done": "aaa\n", "process/fresh": "m1\n" },
    });
    expect(kinds(list)).toEqual(["merged-branch:auto:process/done"]);
  });

  it("worktrees: merged and clean — auto, merged with changes — confirm, prunable — auto, working — nothing", () => {
    const list = run({
      worktrees: porcelain(
        [`worktree ${ROOT}`, "HEAD 1", "branch refs/heads/main"],
        ["worktree D:/project/SRA-a", "HEAD aaa", "branch refs/heads/process/a"],
        ["worktree D:/project/SRA-b", "HEAD bbb", "branch refs/heads/process/b"],
        ["worktree D:/project/SRA-c", "HEAD ccc", "branch refs/heads/process/c"],
        ["worktree D:/project/SRA-gone", "HEAD ddd", "detached", "prunable gitdir file points to non-existent location"],
      ),
      merges: "m1 aaa\nm2 bbb\n",
      tips: { "process/a": "aaa\n", "process/b": "bbb\n", "process/c": "ccc\n" },
      status: { "D:/project/SRA-b": " M x.md\n" },
    });
    expect(kinds(list)).toEqual([
      "merged-worktree:auto:D:/project/SRA-a",
      "merged-worktree-dirty:confirm:D:/project/SRA-b",
      "prunable-worktree:auto:D:/project/SRA-gone",
    ]);
  });

  it("merged branches on origin by the last fetch — not main, HEAD, unmerged or in a worktree", () => {
    const list = run({
      origin: "origin\norigin/HEAD\norigin/main\norigin/docs/a\norigin/spec/b\n",
      merges: "m1 aaa\n",
      tips: { "refs/remotes/origin/docs/a": "aaa\n", "refs/remotes/origin/spec/b": "zzz\n" },
    });
    expect(kinds(list)).toEqual(["merged-origin:auto:origin/docs/a"]);
  });

  it("ignored leftovers, expiring waivers, stale drafts, a stale audit snapshot", () => {
    const list = run({
      tags: "v0.4.2\n",
      tagDate: "2026-09-24\n",
      dirs: {
        [`${ROOT}/.warrant/evidence`]: [dir("a"), dir("b")],
        [`${ROOT}/.warrant/evidence/a/raw`]: [],
        [`${ROOT}/.warrant/waivers`]: [file("WAV-1.json"), file("WAV-2.json"), file("WAV-3.json")],
        [`${ROOT}/docs/drafts`]: [file("README.md"), dir("2026-09-01-old"), dir("2026-09-20-new")],
        [`${ROOT}/docs/process/audits`]: [file("2026-09-20.json"), file("2026-09-20.md")],
      },
      files: {
        [`${ROOT}/.warrant/waivers/WAV-1.json`]: '{"id":"WAV-1","gate":"g","waiver_state":"ACTIVE","expires_at":"2026-10-10"}',
        [`${ROOT}/.warrant/waivers/WAV-2.json`]: '{"id":"WAV-2","gate":"g","waiver_state":"ACTIVE","expires_at":"2026-12-31"}',
        [`${ROOT}/.warrant/waivers/WAV-3.json`]: '{"id":"WAV-3","gate":"g","waiver_state":"REVOKED","expires_at":"2026-09-26"}',
      },
    });
    expect(kinds(list)).toEqual([
      "ignored-leftover:auto:.warrant/evidence/a/raw",
      "waiver-expiring:confirm:WAV-1",
      "stale-draft:confirm:docs/drafts/2026-09-01-old",
      "audit-stale:pr:docs/process/audits/2026-09-20",
    ]);
  });

  it("an audit snapshot is stale after more than AUDIT_STALE_FILES changed files of its dir, a new module or an unknown commit", () => {
    const AUDITS = `${ROOT}/docs/process/audits`;
    const snapshot = (commit: string) => JSON.stringify({ commit, dir: "packages/cli/src", level: 2, modules: [{ id: "commands" }, { id: "core/gates" }, { id: "version.ts" }] });
    const text = (paths: string[]) => paths.map((p) => `${p}\n`).join("");
    const src = (n: number) => text(Array.from({ length: n }, (_, i) => `packages/cli/src/commands/c${i}.ts`));
    const stale = (commit: string, tree: string) =>
      run({
        dirs: { [AUDITS]: [file("2026-09-25.json")] },
        files: { [`${AUDITS}/2026-09-25.json`]: snapshot(commit) },
        diff: { few: src(AUDIT_STALE_FILES), many: src(AUDIT_STALE_FILES + 1) },
        tree,
      }).map((f) => `${f.kind}:${f.item} → ${f.detail}`);
    const known = text(["packages/cli/src/commands/a.ts", "packages/cli/src/core/gates/l0/x.ts", "packages/cli/src/version.ts", "packages/cli/src/core/gates/README.md"]);
    expect(stale("few", known)).toEqual([]);
    expect(stale("many", known)).toEqual([`audit-stale:docs/process/audits/2026-09-25 → ${AUDIT_STALE_FILES + 1} файлов packages/cli/src изменено после many (порог ${AUDIT_STALE_FILES}): навык architecture-audit`]);
    expect(stale("few", known + text(["packages/cli/src/core/guard/run.ts", "packages/cli/src/core/guard/port.ts"]))).toEqual([
      "audit-stale:docs/process/audits/2026-09-25 → новые модули: core/guard: навык architecture-audit",
    ]);
    expect(stale("gone", known)).toEqual(["audit-stale:docs/process/audits/2026-09-25 → коммит снимка gone не найден: навык architecture-audit"]);
  });

  it("broken relative links in docs and skills; archives, code and external links are not checked", () => {
    const list = run({
      dirs: {
        [`${ROOT}/docs`]: [file("01-a.md"), dir("adr"), dir("archive")],
        [`${ROOT}/docs/adr`]: [file("WARRANT-ADR-0001-x.md")],
        [`${ROOT}/docs/archive`]: [file("old.md")],
      },
      files: {
        [`${ROOT}/docs/01-a.md`]: "[ok](adr/WARRANT-ADR-0001-x.md#p-1) [bad](gone.md) [web](https://x.y) [a](#top)\n`[code](nope.md)`\n```\n[fenced](nope.md)\n```\n",
        [`${ROOT}/docs/adr/WARRANT-ADR-0001-x.md`]: "[up](../01-a.md) [bad](../../missing/SKILL.md)\n",
        [`${ROOT}/docs/archive/old.md`]: "[bad](gone.md)\n",
      },
    });
    expect(list.map((f) => `${f.kind}:${f.action}:${f.item} → ${f.detail}`)).toEqual([
      "broken-link:pr:docs/01-a.md → gone.md",
      "broken-link:pr:docs/adr/WARRANT-ADR-0001-x.md → ../../missing/SKILL.md",
    ]);
  });

  it("relativeLinks decodes targets and drops anchors", () => {
    expect(relativeLinks("[x](a%20b.md#s) [y](<c.md>) [z](mailto:q@r)")).toEqual(["a b.md"]);
  });

  it("formatFindings groups by action; nothing — «чисто»", () => {
    expect(formatFindings([])).toBe("Гигиена: чисто.\n");
    const text = formatFindings([
      { kind: "broken-link", action: "pr", item: "docs/a.md", detail: "b.md" },
      { kind: "merged-branch", action: "auto", item: "docs/x", detail: "git branch -d" },
    ]);
    expect(text.split("\n").slice(0, 3)).toEqual(["Гигиена: 2 (ADR-0033 п. 13)", "Сам, без вопросов (1):", "  - [merged-branch] docs/x — git branch -d"]);
  });
});
