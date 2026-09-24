/**
 * Session state (ADR-0032 п. 4, 9, 11): `scripts/dev/brief-lib.js` computes the state of a development session from
 * git and files through an injected `io` and prints at most 2 KB — worktrees with their handoff files, versions,
 * active Changes and open tasks, merged branches (local and on origin), auto-memory warnings; streams in the order of
 * their `После:` lines (ADR-0033 п. 12).
 */
import { describe, expect, it } from "vitest";

import {
  brief,
  collectState,
  compareVersions,
  countOpenTasks,
  formatBrief,
  latestTag,
  MAX_BYTES,
  memoryDir,
  memorySlug,
  memoryWarnings,
  orderStreams,
  parseAfter,
  parseWorktrees,
  TITLE,
} from "../../../../../scripts/dev/brief-lib.js";

type Io = Parameters<typeof collectState>[0];

const ROOT = "D:/project/SRA";
const HOME = "C:/Users/dev";
const MEMORY = `${HOME}/.claude/projects/D--project-SRA/memory`;
const bytes = (s: string) => new TextEncoder().encode(s).length;

interface Repo {
  worktrees?: string;
  branch?: string;
  status?: string;
  tags?: string;
  hasMain?: boolean;
  merged?: string;
  mergedOrigin?: string | null;
  files?: Record<string, string>;
  dirs?: Record<string, { name: string; dir: boolean }[]>;
}

const porcelain = (...entries: string[][]) => `${entries.map((e) => e.join("\n")).join("\n\n")}\n`;

function fakeIo(repo: Repo = {}): Io & { calls: string[][] } {
  const calls: string[][] = [];
  const files = { [`${ROOT}/package.json`]: '{"version":"0.4.2"}', ...repo.files };
  const dirs = repo.dirs ?? {};
  return {
    calls,
    startDir: String.raw`D:\project\SRA`,
    home: HOME,
    git(args: string[]) {
      calls.push(args);
      const key = args.join(" ");
      if (key === "rev-parse --show-toplevel") return `${ROOT}\n`;
      if (key === "branch --show-current") return `${repo.branch ?? "main"}\n`;
      if (key === "rev-parse --short HEAD") return "abc1234\n";
      if (key === "status --porcelain") return repo.status ?? "";
      if (key === "worktree list --porcelain")
        return repo.worktrees ?? porcelain([`worktree ${ROOT}`, "HEAD 1111", "branch refs/heads/main"]);
      if (key === "tag -l v*") return repo.tags ?? "";
      if (key === "show-ref --verify --quiet refs/heads/main") return repo.hasMain === false ? null : "";
      if (key.startsWith("branch --merged main")) return repo.merged ?? "main\n";
      if (key === "show-ref --verify --quiet refs/remotes/origin/main") return repo.mergedOrigin == null ? null : "";
      if (key.startsWith("branch -r --merged origin/main")) return repo.mergedOrigin ?? null;
      return null;
    },
    readFile: (p: string) => files[p] ?? null,
    readDir: (p: string) => dirs[p] ?? null,
  } as Io & { calls: string[][] };
}

const dir = (name: string) => ({ name, dir: true });
const file = (name: string) => ({ name, dir: false });

describe("parseWorktrees", () => {
  it("reads branch, detached and bare entries in git's order", () => {
    const out = parseWorktrees(
      porcelain(
        ["worktree /srv/repo.git", "bare"],
        ["worktree D:/project/SRA", "HEAD 1111", "branch refs/heads/main"],
        ["worktree D:/project/SRA-x", "HEAD 2222", "detached"],
        ["worktree D:/project/SRA-y", "HEAD 3333", "branch refs/heads/feature/a/b", "locked", "prunable gitdir file points to non-existent location"],
      ),
    );
    expect(out).toEqual([
      { path: "/srv/repo.git", branch: null, detached: false, bare: true, prunable: false },
      { path: "D:/project/SRA", branch: "main", detached: false, bare: false, prunable: false },
      { path: "D:/project/SRA-x", branch: null, detached: true, bare: false, prunable: false },
      { path: "D:/project/SRA-y", branch: "feature/a/b", detached: false, bare: false, prunable: true },
    ]);
  });

  it("handles CRLF and empty input", () => {
    expect(parseWorktrees("worktree C:/a\r\nHEAD 1\r\nbranch refs/heads/x\r\n")).toEqual([
      { path: "C:/a", branch: "x", detached: false, bare: false, prunable: false },
    ]);
    expect(parseWorktrees("")).toEqual([]);
  });
});

describe("auto-memory directory", () => {
  it("slug replaces every non-alphanumeric character with '-' (Windows and POSIX paths)", () => {
    expect(memorySlug(String.raw`D:\project\SRA`)).toBe("D--project-SRA");
    expect(memorySlug("D:/project/SRA")).toBe("D--project-SRA");
    expect(memorySlug("/home/dev/my_repo.v2")).toBe("-home-dev-my-repo-v2");
  });

  it("lives under ~/.claude/projects/<slug>/memory", () => {
    expect(memoryDir(HOME, "D:/project/SRA")).toBe(MEMORY);
    expect(memoryDir("/home/dev", "/home/dev/repo")).toBe("/home/dev/.claude/projects/-home-dev-repo/memory");
  });
});

describe("memoryWarnings", () => {
  const index = (n: number) => Array.from({ length: n }, (_, i) => `- [e${i}](e${i}.md) — x`).join("\n") + "\n";

  it("warns when MEMORY.md is longer than 10 lines", () => {
    expect(memoryWarnings([{ name: "MEMORY.md", text: index(10) }]).warnings).toEqual([]);
    expect(memoryWarnings([{ name: "MEMORY.md", text: index(11) }]).warnings).toEqual(["MEMORY.md — 11 строк (> 10)"]);
  });

  it("finds type: project at the top level and under metadata:, not in MEMORY.md or prose", () => {
    const res = memoryWarnings([
      { name: "MEMORY.md", text: "type: project\n" },
      { name: "top.md", text: "---\nname: a\ntype: project\n---\nbody\n" },
      { name: "nested.md", text: "---\nname: b\nmetadata:\n  type: project\n---\n" },
      { name: "user.md", text: "---\nmetadata:\n  type: user\n---\nthe type: project line in prose\n" },
      { name: "notes.txt", text: "type: project\n" },
    ]);
    expect(res.project).toEqual(["nested.md", "top.md"]);
  });
});

describe("countOpenTasks", () => {
  it("counts only `- [ ]` lines, indented or not", () => {
    expect(countOpenTasks("## 1\n- [ ] 1.1 a\n- [x] 1.2 b\n  - [ ] 1.3 c\n* [ ] not a dash\n- [] no space\n")).toBe(2);
    expect(countOpenTasks("")).toBe(0);
  });
});

describe("latestTag", () => {
  it("picks the highest version, not the last in lexical order", () => {
    expect(latestTag("v0.10.0\nv0.9.1\nv0.4.2\n")).toBe("v0.10.0");
    expect(latestTag("v1.0.0-rc.1\nv1.0.0\nv0.9.0\n")).toBe("v1.0.0");
    expect(latestTag("")).toBeNull();
    expect(compareVersions("v1.0.0-rc.1", "v1.0.0")).toBeLessThan(0);
  });
});

describe("streams — ADR-0033 п. 12", () => {
  it("parseAfter reads the `После:` line above the first section only", () => {
    expect(parseAfter("# phase-4\n\nПосле: git-automation, x\n\n## Цель\n")).toEqual(["git-automation", "x"]);
    expect(parseAfter("# a\n\n## Цель\n\nПосле: b\n")).toEqual([]);
    expect(parseAfter(null)).toEqual([]);
  });

  it("orderStreams: predecessors first, ties by name; missing predecessors and cycles are marked", () => {
    const order = orderStreams(
      new Map([
        ["phase-4", ["git-automation"]],
        ["git-automation", []],
        ["docs-x", ["gone"]],
        ["a", ["b"]],
        ["b", ["a"]],
      ]),
    );
    expect(order).toEqual([
      { name: "docs-x", waits: [], missing: ["gone"], cycle: false },
      { name: "git-automation", waits: [], missing: [], cycle: false },
      { name: "phase-4", waits: ["git-automation"], missing: [], cycle: false },
      { name: "a", waits: ["b"], missing: [], cycle: true },
      { name: "b", waits: ["a"], missing: [], cycle: true },
    ]);
  });

  it("brief prints streams in order; a stream's own worktree copy wins over main's", () => {
    const io = fakeIo({
      worktrees: porcelain(
        [`worktree ${ROOT}`, "HEAD 1111", "branch refs/heads/main"],
        ["worktree D:/project/SRA-ga", "HEAD 2222", "branch refs/heads/process/git-automation"],
      ),
      dirs: {
        [`${ROOT}/docs/handoff`]: [file("phase-4.md"), file("git-automation.md")],
        "D:/project/SRA-ga/docs/handoff": [file("phase-4.md"), file("git-automation.md")],
      },
      files: {
        [`${ROOT}/docs/handoff/phase-4.md`]: "# phase-4\n\n## Цель\n",
        "D:/project/SRA-ga/docs/handoff/phase-4.md": "# phase-4\n\nПосле: git-automation\n\n## Цель\n",
      },
    });
    expect(brief(io)).toContain("Потоки по порядку: git-automation, phase-4 (ждёт git-automation)");
  });

  it("counts merged branches on origin by the last fetch, not main, HEAD or a branch in a worktree", () => {
    const io = fakeIo({
      worktrees: porcelain([`worktree ${ROOT}`, "HEAD 1111", "branch refs/heads/main"], ["worktree D:/project/SRA-x", "HEAD 2", "branch refs/heads/process/x"]),
      mergedOrigin: "origin\norigin/HEAD\norigin/main\norigin/docs/a\norigin/spec/b\norigin/process/x\n",
    });
    expect(collectState(io)?.mergedOrigin).toBe(2);
    expect(brief(io)).toContain("Слитые ветки на origin (по последнему fetch): 2");
    expect(brief(fakeIo({ mergedOrigin: "origin/main\n" }))).not.toContain("на origin");
    expect(collectState(fakeIo())?.mergedOrigin).toBeNull();
  });
});

describe("hygiene count — ADR-0033 п. 13", () => {
  it("one line when brief.js found hygiene items, none otherwise", () => {
    const state = collectState(fakeIo())!;
    expect(formatBrief({ ...state, hygiene: 3 })).toContain("Гигиена: 3 (node scripts/dev/hygiene.js, навык repo-hygiene)");
    expect(formatBrief({ ...state, hygiene: 0 })).not.toContain("Гигиена");
  });
});

describe("collectState / brief", () => {
  it("reports session, worktrees with handoff files, versions, Changes, merged branches", () => {
    const io = fakeIo({
      branch: "process/dev-context",
      status: " M a.ts\n?? b.ts\n",
      worktrees: porcelain(
        [`worktree ${ROOT}`, "HEAD 1", "branch refs/heads/main"],
        ["worktree D:/project/SRA-dc", "HEAD 2", "branch refs/heads/process/dev-context"],
        ["worktree D:/project/SRA-old", "HEAD 3", "detached"],
      ),
      tags: "v0.4.1\nv0.4.2\nv0.4.10\n",
      merged: "main\nfeature/old\nprocess/dev-context\n",
      files: {
        [`${ROOT}/packs/core-sdd/pack.json`]: '{"id":"core-sdd","version":"0.3.0"}',
        [`${ROOT}/openspec/changes/add-x/tasks.md`]: "- [ ] 1\n- [x] 2\n- [ ] 3\n",
      },
      dirs: {
        [`${ROOT}/docs/handoff`]: [file("phase-4.md"), file("README.txt")],
        "D:/project/SRA-dc/docs/handoff": [file("git-flow.md")],
        [`${ROOT}/packs`]: [dir("core-sdd"), file("README.md")],
        [`${ROOT}/openspec/changes`]: [dir("archive"), dir("add-x"), dir("fix-y"), file("README.md")],
      },
    });
    const state = collectState(io);
    expect(state).toMatchObject({
      root: ROOT,
      branch: "process/dev-context",
      dirty: 2,
      tag: "v0.4.10",
      cli: "0.4.2",
      packs: ["core-sdd@0.3.0"],
      changes: [
        { name: "add-x", open: 2 },
        { name: "fix-y", open: null },
      ],
      // process/dev-context is checked out in a worktree — in use, not a leftover
      merged: ["feature/old"],
      memory: null,
    });
    expect(state?.worktrees.map((w: { handoff: string[] }) => w.handoff)).toEqual([["phase-4.md"], ["git-flow.md"], []]);

    const text = formatBrief(state!);
    expect(text.split("\n")[0]).toBe(TITLE);
    expect(text).toContain("D:/project/SRA-old [detached] handoff: —");
    expect(text).toContain("add-x: открытых задач 2");
    expect(text).toContain("fix-y: нет tasks.md");
    expect(text).not.toContain("archive");
    expect(text).toContain("Ветки, слитые в main и не удалённые (1): feature/old");
    expect(text).not.toContain("auto-memory");
  });

  it("detached session and bare main worktree", () => {
    const io = fakeIo({
      branch: "",
      worktrees: porcelain(["worktree /srv/repo.git", "bare"], [`worktree ${ROOT}`, "HEAD 1", "detached"]),
    });
    const state = collectState(io)!;
    expect(state.branch).toBe("detached abc1234");
    expect(formatBrief(state)).toContain("/srv/repo.git [bare]\n");
  });

  it("skips the merged-branches line when there is no main branch", () => {
    const io = fakeIo({ hasMain: false });
    expect(collectState(io)?.merged).toBeNull();
    expect(brief(io)).not.toContain("слитые в main");
    expect(io.calls.some((c) => c[0] === "branch" && c[1] === "--merged")).toBe(false);
  });

  it("prints nothing outside a git work tree", () => {
    const io = fakeIo();
    io.git = () => null;
    expect(brief(io)).toBe("");
  });

  it("warns about auto-memory of the main worktree; silent without the directory", () => {
    const lines11 = Array.from({ length: 11 }, (_, i) => `- e${i}`).join("\n");
    const io = fakeIo({
      dirs: { [MEMORY]: [file("MEMORY.md"), file("proj.md"), file("me.md")] },
      files: {
        [`${MEMORY}/MEMORY.md`]: lines11,
        [`${MEMORY}/proj.md`]: "---\nname: p\nmetadata:\n  type: project\n---\n",
        [`${MEMORY}/me.md`]: "---\ntype: user\n---\n",
      },
    });
    const text = brief(io);
    expect(text).toContain("MEMORY.md — 11 строк (> 10)");
    expect(text).toContain("type: project — proj.md");
    expect(text).not.toContain("me.md");
    expect(brief(fakeIo())).not.toContain("auto-memory");
  });
});

describe("2 KB limit", () => {
  it("shortens lists with `… ещё N` and stays within MAX_BYTES", () => {
    const n = 60;
    const worktrees = porcelain(
      ...Array.from({ length: n }, (_, i) => [`worktree D:/project/SRA-длинное-имя-worktree-${i}`, `HEAD ${i}`, `branch refs/heads/feature/ветка-${i}`]),
    );
    const changes = Array.from({ length: n }, (_, i) => dir(`change-с-длинным-именем-${i}`));
    const handoff = Array.from({ length: 9 }, (_, i) => file(`поток-${i}.md`));
    const io = fakeIo({
      worktrees,
      merged: Array.from({ length: n }, (_, i) => `merged/ветка-${i}`).join("\n"),
      dirs: {
        [`${ROOT}/openspec/changes`]: changes,
        "D:/project/SRA-длинное-имя-worktree-0/docs/handoff": handoff,
      },
    });
    const text = brief(io);
    expect(bytes(text)).toBeLessThanOrEqual(MAX_BYTES);
    expect(text.split("\n")[0]).toBe(TITLE);
    expect(text).toMatch(/Worktree \(60\):/);
    expect(text).toMatch(/Активные Changes \(60\):/);
    expect(text).toMatch(/ {2}… ещё \d+\n/);
    expect(text).toMatch(/Ветки, слитые в main и не удалённые \(60\): .*… ещё \d+/);
    expect(text).toContain("поток-4.md, … ещё 4");
  });

  it("fits any limit, cutting at a line boundary when even empty lists do not fit", () => {
    const state = collectState(fakeIo())!;
    for (const max of [300, 120, 40]) {
      const text = formatBrief(state, max);
      expect(bytes(text)).toBeLessThanOrEqual(max);
    }
    expect(formatBrief(state, 120).endsWith("\n")).toBe(true);
  });
});
