/**
 * `ProjectBuilder` (ADR-0025 п. 6, design §6, task 4.2) on its own terms: what
 * it writes is a project the commands accept in the test process, and its git
 * operations keep the files on disk and the snapshots of `FakeGit` in step.
 * That its answers are those of the real tools is the contract's job
 * (`test/contract/{git,openspec}.contract.test.ts`, `project-builder.contract`).
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runGate } from "../../src/commands/gate.js";
import { runValidate } from "../../src/commands/validate.js";
import { useProjectBuilder } from "./helpers/project-builder.js";

const project = useProjectBuilder();

describe("ProjectBuilder", () => {
  it("a synced project with a Change, a record, a waiver and a check override is valid, without a process", async () => {
    const p = await project()
      .withChange("add-search", {
        design: "# Design\n",
        tasks: "# Tasks\n",
        specs: { search: [{ name: "Find", id: "REQ-SRC-001", scenarios: [{ name: "Found", id: "SCN-SRC-001" }] }] }
      })
      .withRecord("add-search", "VERIFYING", { classification: { profiles: ["feature"] } })
      .withWaiver({
        id: "WAV-2026-001",
        change: "add-search",
        gate: "adversarial-review",
        reason: "seeded",
        risk: "LOW",
        compensating_controls: ["review"],
        owner: "human:kat",
        approved_by: "human:kat",
        expires_at: "2099-12-31",
        waiver_state: "ACTIVE"
      })
      .withCheck("fake-tests", { output: "" }, { id: "tests-passed", args: ["{out}"] })
      .synced();
    p.commit("base");

    const result = await runValidate(p.ctx);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(p.openspec.calls).toContain("schema validate warrant-sdd");
  });

  it("gate reads the record, the diff of FakeGit and the waiver", async () => {
    const p = await project()
      .withChange("add-search", { specs: { search: [] } })
      .withRecord("add-search", "IMPLEMENTING", { classification: { profiles: ["chore"] } })
      .synced();
    p.commit("base");
    p.branch("worktree/add-search");
    p.write("src/search.ts", "export const search = 1;\n");
    p.commit("impl");

    const result = await runGate(p.ctx, "add-search", [], {}, { GITHUB_ACTIONS: "" });
    expect(result.data["transition"]).toBe("IMPLEMENTING->VERIFYING");
    expect(p.git.calls).toContain("mergeBase HEAD main");
  });

  it("checkout keeps untracked files, refuses uncommitted changes unless forced; merge joins both sides", () => {
    const p = project();
    p.write("a.txt", "a\n");
    p.commit("base");
    p.branch("topic");
    p.write("b.txt", "b\n");
    p.commit("topic");
    writeFileSync(path.join(p.root, "untracked.txt"), "u\n");

    p.checkout("main");
    expect(existsSync(path.join(p.root, "b.txt"))).toBe(false);
    expect(existsSync(path.join(p.root, "untracked.txt"))).toBe(true);

    p.write("a.txt", "dirty\n");
    expect(() => p.checkout("topic")).toThrow(/uncommitted/);
    p.checkout("topic", { force: true });
    expect(p.read("a.txt")).toBe("a\n");

    p.checkout("main");
    p.write("c.txt", "c\n");
    p.commit("main-2");
    const merge = p.merge("topic", { label: "Merge topic" });
    expect(p.read("b.txt")).toBe("b\n");
    expect(p.read("c.txt")).toBe("c\n");
    expect(p.git.commits.get(merge)?.parents).toHaveLength(2);
  });
});
