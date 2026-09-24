/**
 * Form of a pull request (ADR-0033 п. 10): `scripts/dev/pr-form-lib.js` — the branch prefix (`spec/ worktree/ archive/`
 * for a Change, `process/ docs/ fix/` otherwise) and commit subjects `<change>: …` / `<prefix>: …`.
 */
import { describe, expect, it } from "vitest";

import { checkPr, parseBranch } from "../../../../../scripts/dev/pr-form-lib.js";

describe("pr-form — ADR-0033 п. 10", () => {
  it.each([
    ["spec/arch-boundaries", "arch-boundaries"],
    ["worktree/phase-3b", "phase-3b"],
    ["archive/test-levels", "test-levels"],
    ["process/git-hooks", "process"],
    ["docs/drafts-sync", "docs"],
    ["fix/secret-regex-archive-lookup", "fix"],
    ["process/adr-0033-git-process", "process"],
  ])("%s → subjects start with «%s: »", (branch, subject) => {
    expect(parseBranch(branch)).toMatchObject({ subject });
  });

  it.each(["feature/phase-1-kernel", "main", "git-hooks", "process/", "process/Git_Hooks", "wip/x", ""])("rejects branch %s", (branch) => {
    expect(parseBranch(branch).error).toMatch(/^branch /);
    expect(checkPr(branch, ["process: x"])).toHaveLength(1);
  });

  it("accepts the subjects of the branch, merges are already filtered out by the caller", () => {
    expect(checkPr("worktree/arch-boundaries", ["arch-boundaries: group 1 — x", "arch-boundaries: transition VERIFYING"])).toEqual([]);
    expect(checkPr("process/git-hooks", ["process: хук git-hook"])).toEqual([]);
    expect(checkPr("docs/x", [])).toEqual([]);
  });

  it("names every subject that breaks the form", () => {
    const problems = checkPr("fix/phase-3-review", ["fix: R-1", "ci: matrix", "versions: bump", "fix:", "fix: "]);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toContain("«ci: matrix»");
    expect(problems[0]).toContain("«fix: »");
  });

  it("a Change branch wants the Change name, not the prefix", () => {
    expect(checkPr("spec/phase-3b", ["spec: x"])).toHaveLength(1);
    expect(checkPr("spec/phase-3b", ["phase-3b-x: y"])).toHaveLength(1);
  });
});
