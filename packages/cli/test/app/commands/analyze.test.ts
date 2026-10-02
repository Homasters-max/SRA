/**
 * `warrant analyze` in the test process (REQ-VER-010): the report over the
 * files of the project and the diff of `FakeGit` — `UNSATISFIED` with the
 * exit code 1 (SCN-VER-062), a consistent Change with 0 (SCN-VER-066), `ORPHAN`
 * of the changed test only (SCN-VER-065), `ORPHAN` skipped without git
 * (SCN-VER-067), an archived Change in its archive directory (SCN-VER-072),
 * no `ORPHAN` for an SCN of another open Change (SCN-VER-152),
 * `CHANGE_NOT_FOUND` with a `hint`; the tree of the project is the same bytes
 * after every call — the command writes nothing.
 */
import { renameSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runAnalyze, type AnalyzeOptions } from "../../../src/commands/analyze.js";
import type { CommandResult } from "../../../src/io/output.js";
import { CORE_SDD_RANGE } from "../../helpers/cli.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import type { ModelRequirement } from "../helpers/fakes/spec-model.js";

const project = useProjectBuilder();

type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

const SEARCH: ModelRequirement[] = [
  { name: "Search by text", id: "REQ-SRC-004", scenarios: [{ name: "Match", id: "SCN-SRC-010" }] }
];

/** The project with `paths.tests: tests`, Change `add-search` adding REQ-SRC-004 with SCN-SRC-010, and `tasks`. */
function repo(tasks: string): ProjectBuilder {
  return project()
    .write(".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { "core-sdd": { version: CORE_SDD_RANGE } },
      paths: { tests: "tests" },
      roles: { maintainer: ["kat"] }
    })
    .withRecord("add-search", "IMPLEMENTING")
    .withChange("add-search", { tasks, specs: { search: SEARCH } });
}

/** `warrant analyze add-search`; the tree of the project must not change. */
async function analyze(p: ProjectBuilder, opts: AnalyzeOptions = {}, change = "add-search"): Promise<Result> {
  const before = p.tree();
  const result = await invoke(() => runAnalyze(p.ctx, change, opts));
  expect(p.tree()).toEqual(before);
  return result;
}

describe("warrant analyze", () => {
  it("REQ without a task: UNSATISFIED missing task, exit 1, nothing written (SCN-VER-062)", async () => {
    const p = repo("## 1. Search\n\n- [ ] 1.1 Index the catalogue\n");
    p.write("tests/test_search.py", "# SCN-SRC-010\n");
    p.commit("base");

    const run = await analyze(p);
    expect(run.exitCode).toBe(1);
    expect(run.ok).toBe(false);
    expect(run.errors).toEqual([]);
    expect(run.data).toEqual({
      change: "add-search",
      findings: [{ code: "UNSATISFIED", id: "REQ-SRC-004", missing: ["task"] }],
      counts: { UNSATISFIED: 1, CONFLICT: 0, ORPHAN: 0 },
      skipped: []
    });
  });

  it("a consistent Change: no finding, every count 0, exit 0 (SCN-VER-066)", async () => {
    const p = repo("## 1. Search\n\n- [ ] 1.1 Search by text (REQ-SRC-004)\n");
    p.commit("base");
    p.branch("worktree/add-search");
    p.write("tests/test_search.py", "# SCN-SRC-010\n");
    p.commit("tests");

    const run = await analyze(p);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data).toEqual({ change: "add-search", findings: [], counts: { UNSATISFIED: 0, CONFLICT: 0, ORPHAN: 0 }, skipped: [] });
  });

  it("ORPHAN only in the test changed by the diff (SCN-VER-065); --base picks the diff", async () => {
    const p = repo("- [ ] 1.1 REQ-SRC-004\n");
    p.write("tests/test_old.py", "# SCN-SRC-098\n");
    const base = p.commit("base");
    p.branch("worktree/add-search");
    p.write("tests/test_search.py", "# SCN-SRC-010 SCN-SRC-099\n");
    p.commit("tests");

    const run = await analyze(p);
    expect(run.exitCode).toBe(1);
    expect(run.data["findings"]).toEqual([{ code: "ORPHAN", id: "SCN-SRC-099", path: "tests/test_search.py" }]);

    // With HEAD as the base the diff is empty: no test is judged for ORPHAN.
    const head = await analyze(p, { base: "HEAD" });
    expect(head.exitCode).toBe(0);
    expect(head.data["findings"]).toEqual([]);
    expect((await analyze(p, { base: base })).data["findings"]).toEqual(run.data["findings"]);
  });

  it("an SCN declared by the delta of another open Change is no ORPHAN; one of an archived Change only is (SCN-VER-152)", async () => {
    const p = repo("- [ ] 1.1 REQ-SRC-004\n");
    p.write("tests/test_search.py", "# SCN-SRC-010\n");
    p.write("openspec/changes/add-store/specs/store/spec.md", "## ADDED Requirements\n\n### Requirement: Store\n<!-- id: REQ-STO-001 -->\n\nThe store SHALL keep items.\n\n#### Scenario: Keep\n<!-- id: SCN-STO-001 -->\n- **WHEN** an item is put\n- **THEN** it is kept\n");
    p.write("openspec/changes/archive/2026-09-01-old-store/specs/store/spec.md", "## ADDED Requirements\n\n### Requirement: Store\n<!-- id: REQ-STO-009 -->\n\nThe store SHALL keep items.\n\n#### Scenario: Keep\n<!-- id: SCN-STO-009 -->\n- **WHEN** an item is put\n- **THEN** it is kept\n");
    p.write("openspec/changes/notes.md", "# not a Change\n");
    p.commit("base");
    p.branch("archive/add-search");
    p.write("tests/test_store.py", "# SCN-STO-001 SCN-STO-009\n");
    p.commit("tests of add-store");

    const run = await analyze(p);
    expect(run.exitCode).toBe(1);
    expect(run.data["findings"]).toEqual([{ code: "ORPHAN", id: "SCN-STO-009", path: "tests/test_store.py" }]);
    expect(run.data["counts"]).toEqual({ UNSATISFIED: 0, CONFLICT: 0, ORPHAN: 1 });
    // A file directly under openspec/changes/ gives no id and no skip.
    expect(run.data["skipped"]).toEqual([]);
  });

  it("without git ORPHAN is skipped with the reason, UNSATISFIED and CONFLICT computed (SCN-VER-067)", async () => {
    const p = repo("- [ ] 1.1 REQ-SRC-004, REQ-SRC-777\n");
    p.write("tests/test_search.py", "# SCN-SRC-099\n");

    const run = await analyze(p);
    expect(run.exitCode).toBe(1);
    expect(run.data["findings"]).toEqual([
      { code: "CONFLICT", id: "REQ-SRC-777", path: "openspec/changes/add-search/tasks.md" },
      { code: "UNSATISFIED", id: "REQ-SRC-004", missing: ["test"] }
    ]);
    expect(run.data["skipped"]).toEqual([{ code: "ORPHAN", reason: expect.stringContaining("not a git repository") }]);
  });

  it("an archived Change is read from its archive directory with the latest date (SCN-VER-072)", async () => {
    const p = repo("- [x] 1.1 REQ-SRC-004, REQ-SRC-777\n");
    p.write("tests/test_search.py", "# SCN-SRC-010\n");
    // An older archive of the same name, then `openspec archive add-search`.
    p.write("openspec/changes/archive/2026-01-02-add-search/tasks.md", "- [x] 1.1 REQ-SRC-004\n");
    renameSync(path.join(p.root, "openspec/changes/add-search"), path.join(p.root, "openspec/changes/archive/2026-09-26-add-search"));

    const run = await analyze(p);
    expect(run.exitCode).toBe(1);
    expect(run.data["findings"]).toEqual([
      { code: "CONFLICT", id: "REQ-SRC-777", path: "openspec/changes/archive/2026-09-26-add-search/tasks.md" }
    ]);
  });

  it("an unknown Change is CHANGE_NOT_FOUND with a hint, exit 3", async () => {
    const p = repo("");
    const run = await analyze(p, {}, "no-such");
    expect(run.exitCode).toBe(3);
    expect(run.errors).toEqual([
      expect.objectContaining({ code: "CHANGE_NOT_FOUND", path: "openspec/changes/no-such", hint: expect.stringContaining("warrant status") })
    ]);
  });
});
