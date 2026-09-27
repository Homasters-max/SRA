/**
 * `warrant id` in the test process (REQ-KRN-024, SCN-KRN-056..060, SCN-KRN-007):
 * allocation of spec-level ids counting the archive, ULIDs, waiver ids and
 * renumbering inside a Change. Moved from e2e (ADR-0025, task 5.4); the parse
 * of argv (`<kind> <area>`, `renumber <old> <new> --change`) and the exit codes
 * of the binary stay in `e2e/id.test.ts`.
 *
 * The project is the one of the e2e runs: config plus the AREA registry, no
 * packs and no lock. Specs are raw Markdown: `id` reads them itself, not
 * through `openspec`.
 */
import { describe, expect, it } from "vitest";

import { runId } from "../../../src/commands/id.js";
import type { CommandResult } from "../../../src/io/output.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";

const builder = useProjectBuilder();

/** The data of a result, read as the envelope is. */
type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

function id(p: ProjectBuilder, args: string[], opts: { change?: string } = {}): Promise<Result> {
  return invoke(() => runId(p.ctx, args, opts));
}

/** A minimal project: config plus the AREA registry. `id` needs no packs and no lock. */
function project(): ProjectBuilder {
  return builder()
    .remove(".warrant")
    .remove("openspec")
    .write(".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: {},
      paths: { tests: "tests" }
    })
    .write(".warrant/local/areas.json", { $schema: "warrant://areas/1", KRN: { capability: "kernel" } });
}

describe("warrant id", () => {
  it("allocates the next number counting archive (SCN-KRN-056)", async () => {
    const p = project()
      .write("openspec/specs/kernel/spec.md", "### Requirement: A\n<!-- id: REQ-KRN-007 -->\n\nSHALL a.\n")
      .write("openspec/changes/archive/2026-01-01-old/specs/kernel/spec.md", "### Requirement: B\n<!-- id: REQ-KRN-012 -->\n\nSHALL b.\n");
    const run = await id(p, ["REQ", "KRN"]);
    expect(run.exitCode).toBe(0);
    expect(run.ok).toBe(true);
    expect(run.data["id"]).toBe("REQ-KRN-013");
    expect(run.errors).toEqual([]);
  });

  it("reports AREA_UNKNOWN with exit code 3 and a hint naming the declared AREAs and areas.json (SCN-KRN-057)", async () => {
    const run = await id(project(), ["REQ", "ZZZ"]);
    expect(run.exitCode).toBe(3);
    expect(run.ok).toBe(false);
    expect(run.errors[0]?.code).toBe("AREA_UNKNOWN");
    expect(run.errors[0]?.hint).toContain("KRN");
    expect(run.errors[0]?.hint).toContain(".warrant/local/areas.json");
  });

  it("counts the unknowns[] of records for the next UNK (SCN-KRN-144)", async () => {
    const p = project()
      .write(".warrant/local/areas.json", { $schema: "warrant://areas/1", SRC: { capability: "search" } })
      .write("openspec/changes/add-search/proposal.md", "### Unknown: A\n<!-- id: UNK-SRC-002 -->\n\n?\n")
      .write(".warrant/changes/add-search.json", {
        $schema: "warrant://change-record/1",
        change: "add-search",
        change_state: "PROPOSED",
        transitions: [],
        unknowns: [{ id: "UNK-SRC-004", text: "?", blocking: false }]
      });
    const run = await id(p, ["UNK", "SRC"]);
    expect(run.errors).toEqual([]);
    expect(run.data["id"]).toBe("UNK-SRC-005");
  });

  it("gives two distinct Crockford ULIDs for EVID (SCN-KRN-058)", async () => {
    const p = project();
    const first = await id(p, ["EVID"]);
    const second = await id(p, ["EVID"]);
    expect(first.data["id"]).toMatch(/^EVID-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(second.data["id"]).toMatch(/^EVID-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(first.data["id"]).not.toBe(second.data["id"]);
    expect((await id(p, ["RUN"])).data["id"]).toMatch(/^RUN-[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("gives WAV-<year>-NNN", async () => {
    const run = await id(project(), ["WAV"]);
    expect(run.exitCode).toBe(0);
    expect(run.data["id"]).toMatch(/^WAV-\d{4}-001$/);
  });

  it("renumbers inside the change only (SCN-KRN-059)", async () => {
    const p = project()
      .write(".warrant/changes/add-search.json", { $schema: "warrant://change-record/1", change: "add-search", change_state: "SPECIFIED" })
      .write("openspec/changes/add-search/tasks.md", "- REQ-KRN-007 and REQ-KRN-0071\n")
      .write("tests/search.test.ts", "// REQ-KRN-007\n")
      .write("docs/other.md", "REQ-KRN-007\n");

    const run = await id(p, ["renumber", "REQ-KRN-007", "REQ-KRN-013"], { change: "add-search" });
    expect(run.exitCode).toBe(0);
    expect(run.change).toBe("add-search");
    expect(run.data["old"]).toBe("REQ-KRN-007");
    expect(run.data["new"]).toBe("REQ-KRN-013");
    expect(run.data["rewritten"]).toEqual(["openspec/changes/add-search/tasks.md", "tests/search.test.ts"]);
    expect(p.read("openspec/changes/add-search/tasks.md")).toBe("- REQ-KRN-013 and REQ-KRN-0071\n");
    expect(p.read("docs/other.md")).toBe("REQ-KRN-007\n");
  });

  it("refuses to renumber a MERGED change (SCN-KRN-060)", async () => {
    const p = project()
      .write(".warrant/changes/add-search.json", { $schema: "warrant://change-record/1", change: "add-search", change_state: "MERGED" })
      .write("openspec/changes/add-search/tasks.md", "REQ-KRN-007\n");
    const run = await id(p, ["renumber", "REQ-KRN-007", "REQ-KRN-013"], { change: "add-search" });
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("ID_IMMUTABLE");
    expect(p.read("openspec/changes/add-search/tasks.md")).toBe("REQ-KRN-007\n");
  });

  it("reports CONFIG_MISSING without .warrant/ (SCN-KRN-007)", async () => {
    const p = builder().remove(".warrant").remove("openspec");
    const run = await id(p, ["REQ", "KRN"]);
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("CONFIG_MISSING");
  });

  it("reports USAGE for an unknown kind", async () => {
    const run = await id(project(), ["FOO"]);
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("USAGE");
  });
});
