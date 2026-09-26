/**
 * Contract of `OpenSpecPort` (ADR-0025 п. 5, design §7, task 4.3): a project
 * built by `ProjectBuilder` gets the same answers from the real `openspec`
 * (`OpenSpecCli` over the files on disk) and from `FakeOpenSpec` (over the
 * model the builder filled with the same calls), method by method.
 *
 * Where OpenSpec's answer carries what the fake cannot know — `list` ordered by
 * modification time, the date and absolute paths in the output of the acts,
 * the wording of a failure — the scenario compares what the CLI relies on
 * (I-130): the set of names, `ok`, the effect on disk, that a warning exists.
 */
import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { OpenSpecCli } from "../../src/adapters/openspec-cli.js";
import type { OpenSpecPort } from "../../src/core/ports/openspec.js";
import { makeTempDir, removeDir } from "../helpers/cli.js";
import { OPENSPEC_VERSION } from "../helpers/openspec.js";
import type { ModelRequirement } from "../app/helpers/fakes/spec-model.js";
import { useProjectBuilder, type ProjectBuilder } from "../app/helpers/project-builder.js";

const project = useProjectBuilder();

const SIDES = [
  { side: "OpenSpecCli (real openspec)", port: (b: ProjectBuilder): OpenSpecPort => new OpenSpecCli(b.root) },
  { side: "FakeOpenSpec", port: (b: ProjectBuilder): OpenSpecPort => b.openspec }
];

const RANK: ModelRequirement = {
  name: "Rank",
  id: "REQ-SRC-002",
  scenarios: [{ name: "Ranked", id: "SCN-SRC-002" }, { name: "Unranked" }]
};
const FILTER: ModelRequirement = { name: "Filter", id: "REQ-SRC-003", body: "The system SHALL filter results.", scenarios: [{ name: "Filtered", id: "SCN-SRC-003" }] };
const LATE: ModelRequirement = { name: "Late", id: "REQ-SRC-004", idAfterBody: true, scenarios: [{ name: "Late one", id: "SCN-SRC-004" }] };
const FIND: ModelRequirement = { name: "Find", id: "REQ-SRC-001", scenarios: [{ name: "Found", id: "SCN-SRC-001" }] };

/** A synced project with changes and specs of every shape the port distinguishes. */
async function built(): Promise<ProjectBuilder> {
  const p = project()
    .withChange("add-search", { design: "# Design\n", specs: { search: [RANK, LATE], "area/ranking": [FILTER] } })
    .withChange("draft", { proposal: false, tasks: "# Tasks\n" })
    .withSpec("search", [FIND])
    .withSpec("area/nested", [{ name: "Nested", scenarios: [{ name: "Deep", id: "SCN-SRC-009" }] }])
    .withSpec("empty");
  return p.synced();
}

describe.each(SIDES)("OpenSpecPort contract: $side", ({ port: portOf }) => {
  it("version, list and show", async () => {
    const p = await built();
    const port = portOf(p);
    const [version, changes, specs, change, draft, search, nested, empty, area, missing] = await Promise.all([
      port.version(),
      port.listChanges(),
      port.listSpecs(),
      port.showChange("add-search"),
      port.showChange("draft"),
      port.showSpec("search"),
      port.showSpec("area/nested"),
      port.showSpec("empty"),
      port.showSpec("area"),
      port.showSpec("missing")
    ]);

    expect(version).toBe(OPENSPEC_VERSION);
    expect([...changes].sort()).toEqual(["add-search", "draft"]);
    expect(specs).toEqual(["area/nested", "empty", "search"]);
    // Capabilities in path order; each text once; an id after the body stays after it.
    expect(change).toEqual([
      "<!-- id: REQ-SRC-003 -->\nThe system SHALL filter results.",
      "<!-- id: SCN-SRC-003 -->\n- **WHEN** it is asked\n- **THEN** it answers",
      "<!-- id: REQ-SRC-002 -->\nThe system SHALL rank.",
      "<!-- id: SCN-SRC-002 -->\n- **WHEN** it is asked\n- **THEN** it answers",
      "- **WHEN** it is asked\n- **THEN** it answers",
      "The system SHALL late.\n<!-- id: REQ-SRC-004 -->",
      "<!-- id: SCN-SRC-004 -->\n- **WHEN** it is asked\n- **THEN** it answers"
    ]);
    expect(draft).toEqual([]);
    expect(search).toEqual([
      "<!-- id: REQ-SRC-001 -->\nThe system SHALL find.",
      "<!-- id: SCN-SRC-001 -->\n- **WHEN** it is asked\n- **THEN** it answers"
    ]);
    expect(nested).toEqual(["The system SHALL nested.", "<!-- id: SCN-SRC-009 -->\n- **WHEN** it is asked\n- **THEN** it answers"]);
    expect(empty).toEqual([]);
    expect(area).toEqual([]);
    expect(missing).toEqual([]);
  });

  it("status of the artifacts of warrant-sdd; an unknown change is a warning", async () => {
    const p = await built();
    p.withChange("proposed");
    const port = portOf(p);
    const [full, proposed, draft, unknown] = await Promise.all([
      port.status("add-search"),
      port.status("proposed"),
      port.status("draft"),
      port.status("unknown")
    ]);
    expect(full).toEqual({ artifacts: { proposal: "done", specs: "done", design: "done", tasks: "ready" } });
    expect(proposed).toEqual({ artifacts: { proposal: "done", specs: "ready", design: "ready", tasks: "blocked" } });
    expect(draft).toEqual({ artifacts: { proposal: "ready", specs: "blocked", design: "blocked", tasks: "done" } });
    expect(unknown.artifacts).toEqual({});
    expect(unknown.warning).toMatch(/^openspec status --change unknown failed/);
  });

  it("new change and schema validate: the generated schema is known, a taken name or an unknown schema fails", async () => {
    const p = await built();
    const port = portOf(p);
    expect((await port.schemaValidate("warrant-sdd")).ok).toBe(true);
    expect((await port.schemaValidate("no-such-schema")).ok).toBe(false);

    expect((await port.newChange("fresh", "warrant-sdd")).ok).toBe(true);
    expect(existsSync(path.join(p.root, "openspec", "changes", "fresh", ".openspec.yaml"))).toBe(true);
    const [again, unknownSchema, changes, status] = await Promise.all([
      port.newChange("fresh", "warrant-sdd"),
      port.newChange("other", "no-such-schema"),
      port.listChanges(),
      port.status("fresh")
    ]);
    expect(again.ok).toBe(false);
    expect(unknownSchema.ok).toBe(false);
    expect([...changes].sort()).toEqual(["add-search", "draft", "fresh"]);
    expect(status).toEqual({ artifacts: { proposal: "ready", specs: "blocked", design: "blocked", tasks: "blocked" } });
  });

  it("archive moves the change into archive/<date>-<change> and out of the list", async () => {
    const p = await built();
    const port = portOf(p);
    expect((await port.archive("add-search")).ok).toBe(true);
    expect(existsSync(path.join(p.root, "openspec", "changes", "add-search"))).toBe(false);
    const archived = readdirSync(path.join(p.root, "openspec", "changes", "archive")).filter((name) => name !== ".gitkeep");
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatch(/^\d{4}-\d{2}-\d{2}-add-search$/);
    expect(await port.listChanges()).toEqual(["draft"]);
    expect((await port.archive("no-such-change")).ok).toBe(false);
  });

  it("archive in another root acts on that checkout only and changes the main specs of the Change there", async () => {
    const p = await built();
    const port = portOf(p);
    const copy = path.join(makeTempDir("warrant-openspec-root-"), "project");
    try {
      cpSync(p.root, copy, { recursive: true });
      const before = specFiles(copy);
      expect((await port.archive("add-search", copy)).ok).toBe(true);
      expect(existsSync(path.join(copy, "openspec", "changes", "add-search"))).toBe(false);
      expect(existsSync(path.join(p.root, "openspec", "changes", "add-search"))).toBe(true);
      const after = specFiles(copy);
      const changed = [...new Set([...before.keys(), ...after.keys()])].filter((f) => before.get(f) !== after.get(f)).sort();
      expect(changed).toEqual(["area/ranking/spec.md", "search/spec.md"]);
      expect((await port.archive("no-such-change", copy)).ok).toBe(false);
    } finally {
      removeDir(path.dirname(copy));
    }
  });
});

/** The main specs of `root`: path under `openspec/specs/` → text. */
function specFiles(root: string): Map<string, string> {
  const dir = path.join(root, "openspec", "specs");
  const out = new Map<string, string>();
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    const file = path.join(dir, entry);
    if (entry.endsWith("spec.md") && existsSync(file)) out.set(entry.split(path.sep).join("/"), readFileSync(file, "utf8"));
  }
  return out;
}
