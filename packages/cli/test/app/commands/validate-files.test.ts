/**
 * `warrant validate --files` (REQ-KRN-032, ADR-0019; SCN-KRN-127…129) in the
 * test process: the checks of one file over the given paths, on the fakes.
 * Every case also holds the "no child process" part of the requirement: the
 * fakes' journals show no `openspec` call, no check run and no git call but
 * the one `contents` of check (9).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runValidate } from "../../../src/commands/validate.js";
import type { CommandResult } from "../../../src/io/output.js";
import type { ModelRequirement } from "../helpers/fakes/spec-model.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { errorCodes } from "../helpers/validate.js";

const project = useProjectBuilder();

/** `validate --files` on the project of `p`; the fakes' journals start empty. */
function validateFiles(p: ProjectBuilder, files: string): Promise<CommandResult> {
  p.openspec.calls.length = 0;
  p.checks.calls.length = 0;
  p.git.calls.length = 0;
  return invoke(() => runValidate(p.ctx, { files }));
}

/** Nothing but `contents` of check (9) reached a port. */
function expectNoProcesses(p: ProjectBuilder, git: string[] = []): void {
  expect(p.openspec.calls).toEqual([]);
  expect(p.checks.calls).toEqual([]);
  expect(p.git.calls).toEqual(git);
}

const search = (id = "REQ-SRC-001"): ModelRequirement => ({
  name: "Search",
  id,
  body: "The system SHALL find records by name.",
  scenarios: [{ name: "Found", id: "SCN-SRC-002", steps: "- **WHEN** a known name is searched\n- **THEN** the record is returned" }]
});

describe("warrant validate --files", () => {
  it("reports NOT_CANONICAL with a hint naming warrant fmt, exit 3 (SCN-KRN-127)", async () => {
    const p = await project().synced();
    p.write(".warrant/local/areas.json", '{"SRC":{"capability":"search"},"$schema":"warrant://areas/1","KRN":{"capability":"kernel"}}\n');
    const run = await validateFiles(p, ".warrant/local/areas.json");
    expect(run.exitCode).toBe(3);
    expect(run.errors).toEqual([
      expect.objectContaining({ code: "NOT_CANONICAL", path: ".warrant/local/areas.json", hint: expect.stringContaining("warrant fmt") })
    ]);
    expect(run.data).toEqual({ checked: [".warrant/local/areas.json"], skipped: [] });
    expectNoProcesses(p);
  });

  describe.each(["", "sub/project"])("project prefix '%s'", (prefix) => {
    it("reports ID_IMMUTABLE for a changed stable id; lock and generated files are not checked (SCN-KRN-128)", async () => {
      const p = await project({ prefix }).withSpec("search", [search()]).synced();
      p.commit("fixture");
      p.withSpec("search", [search("REQ-SRC-009")]);
      p.remove(".warrant/warrant.lock.json");
      p.write("openspec/config.yaml", "drifted: true\n");

      const run = await validateFiles(p, "openspec/specs/search/spec.md");
      expect(run.exitCode).toBe(3);
      expect(errorCodes(run)).toEqual(["ID_IMMUTABLE"]);
      expect(run.errors[0]?.message).toContain("REQ-SRC-001");
      expect(run.errors[0]?.path).toBe("openspec/specs/search/spec.md");
      expect(run.data).toEqual({ checked: ["openspec/specs/search/spec.md"], skipped: [] });
      expectNoProcesses(p, ["contents HEAD ./openspec/specs/search/spec.md"]);
    });
  });

  it("skips a path of no check, a missing one and one outside the project (SCN-KRN-129)", async () => {
    const p = await project().synced();
    p.write("docs/notes.md", "# Notes\n");
    mkdirSync(path.join(p.root, "docs", "sub"), { recursive: true });
    // A finding in a file not asked about is not reported.
    p.write(".warrant/local/areas.json", '{"SRC":{"capability":"search"},"$schema":"warrant://areas/1"}\n');
    const run = await validateFiles(p, "docs/notes.md,../other/x.json,openspec/specs/gone/spec.md,docs/sub");
    expect(run.exitCode).toBe(0);
    expect(run.ok).toBe(true);
    expect(run.data).toEqual({
      checked: [],
      skipped: [
        { path: "../other/x.json", reason: "outside" },
        { path: "docs/notes.md", reason: "no-check" },
        { path: "docs/sub", reason: "no-check" },
        { path: "openspec/specs/gone/spec.md", reason: "missing" }
      ]
    });
    expectNoProcesses(p);
  });

  it("an absolute path inside the project is its project path; a `..cache` directory is inside", async () => {
    const p = await project().synced();
    p.write("..cache/x.json", "{}\n");
    const run = await validateFiles(p, `${path.join(p.root, ".warrant", "local", "areas.json")},..cache/x.json`);
    expect(run.ok).toBe(true);
    expect(run.data).toEqual({ checked: [".warrant/local/areas.json"], skipped: [{ path: "..cache/x.json", reason: "no-check" }] });
  });

  it("reports ID_DANGLING of the tasks.md asked about against the ids of the whole project", async () => {
    const p = await project()
      .withSpec("search", [search()])
      .withChange("add-search", { tasks: "- [ ] 1.1 REQ-SRC-001, SCN-SRC-002, SCN-SRC-777\n" })
      .synced();
    const run = await validateFiles(p, "openspec/changes/add-search/tasks.md");
    expect(errorCodes(run)).toEqual(["ID_DANGLING"]);
    expect(run.errors[0]?.message).toContain("SCN-SRC-777");
    expectNoProcesses(p);
  });

  it("reports ID_FORMAT, AREA_UNKNOWN and ID_DUPLICATE of the Markdown asked about, without openspec", async () => {
    const p = await project().withSpec("search", [search()]).synced();
    p.write(
      "openspec/changes/add-x/proposal.md",
      "# X\n\n<!-- id: REQ-SRC-1 -->\n<!-- id: REQ-ZZZ-001 -->\n<!-- id: REQ-SRC-005 -->\n<!-- id: REQ-SRC-005 -->\n"
    );
    const run = await validateFiles(p, "openspec/changes/add-x/proposal.md");
    expect(errorCodes(run).sort()).toEqual(["AREA_UNKNOWN", "ID_DUPLICATE", "ID_FORMAT"]);
    expectNoProcesses(p);
  });

  it("--files without a path is USAGE with a hint", async () => {
    const p = await project().synced();
    const run = await validateFiles(p, " , ");
    expect(run.exitCode).toBe(3);
    expect(run.errors).toEqual([expect.objectContaining({ code: "USAGE", hint: expect.stringContaining("--files") })]);
  });
});
