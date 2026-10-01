/**
 * `warrant init` and `warrant init change` in the test process (REQ-KRN-023):
 * the project skeleton left valid and synced (SCN-KRN-042, 052), a second
 * `init` without and with `--force` (SCN-KRN-053), a missing `openspec`, the
 * Change and its `PROPOSED` record (SCN-KRN-054) and a name held by the
 * archive (SCN-KRN-055), the restart finding of `--frontend claude`
 * (SCN-KRN-154). Moved from e2e (ADR-0025, task 5.4); the parse of argv
 * (`init`, `--force`, `change <name>`), the exit codes of the binary and the real `openspec` stay in `e2e/init.test.ts` and `e2e/exit-criterion.test.ts`.
 *
 * `openspec init --tools none` of the e2e projects is the base of
 * `ProjectBuilder` without `.warrant/` plus a `config.yaml` without the
 * generated marker (as `app/commands/sync.test.ts`). "openspec was not called"
 * is an empty journal of `FakeOpenSpec`; "openspec is absent" is its
 * `installedVersion = null`.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runInit, runInitChange, runInitCommand, type InitOptions } from "../../../src/commands/init.js";
import { runSync } from "../../../src/commands/sync.js";
import { CLAUDE_REVIEWER_REL, RESTART_HINT } from "../../../src/core/sync/claude.js";
import type { CommandResult } from "../../../src/io/output.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { validate } from "../helpers/validate.js";

const builder = useProjectBuilder();

/** The data of a result, read as the envelope is. */
type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

/** Stand-in for the `config.yaml` of `openspec init`: a file `warrant sync` did not generate. */
const INIT_CONFIG = "schema: spec-driven\n";

/** An empty temp project with OpenSpec initialised (or nothing at all), no `.warrant/`. */
function project(init = true): ProjectBuilder {
  const p = builder().remove(".warrant");
  return init ? p.write("openspec/config.yaml", INIT_CONFIG) : p.remove("openspec");
}

/** `warrant init`; `openspec` finds the schema `sync` generated on disk, so `FakeOpenSpec` learns it (as `ProjectBuilder.synced()`). */
async function init(p: ProjectBuilder, opts: InitOptions = {}): Promise<Result> {
  const result = await invoke(() => runInit(p.ctx, opts));
  const schema = (result.data["sync"] as Data | undefined)?.["schema"];
  if (result.ok && typeof schema === "string" && schema !== "") p.openspec.schemas.add(schema);
  return result;
}

function initChange(p: ProjectBuilder, name: string): Promise<Result> {
  return invoke(() => runInitChange(p.ctx, name));
}

describe("warrant init", () => {
  it("creates the project skeleton and leaves it valid (SCN-KRN-042, SCN-KRN-052)", async () => {
    const p = project();
    const run = await init(p);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);

    const created = run.data["created"] as string[];
    expect(created.length).toBeGreaterThan(0);
    for (const rel of [
      ".warrant/warrant.json",
      ".warrant/local/areas.json",
      ".warrant/local/openspec/rules.json",
      ".warrant/changes/.gitkeep",
      ".warrant/waivers/.gitkeep",
      ".warrant/evidence/.gitkeep",
      ".warrant/runs/.gitkeep",
      ".warrant/warrant.lock.json",
      "openspec/config.yaml"
    ]) {
      expect(created).toContain(rel);
      expect(existsSync(path.join(p.root, ...rel.split("/")))).toBe(true);
    }
    // The schema copies come from `sync`, not from `init` itself.
    expect(existsSync(path.join(p.root, ".warrant", "schemas", "config.1.schema.json"))).toBe(true);
    // Raw check output is never committed (SCN-VER-004).
    expect(created).toContain(".gitignore");
    expect(p.read(".gitignore").split("\n")).toContain(".warrant/evidence/**/raw/");

    const config = JSON.parse(p.read(".warrant/warrant.json")) as { openspec: string; packs: Record<string, { version: string }> };
    expect(config.openspec).toMatch(/^\d+\.\d+\.x$/);
    expect(config.packs["core-sdd"]?.version).toMatch(/^\^/);

    const valid = await validate(p);
    expect(valid.errors).toEqual([]);
    expect(valid.ok).toBe(true);
    expect(valid.exitCode).toBe(0);

    // A second sync changes nothing: `init` left a fully synced project.
    expect((await invoke(() => runSync(p.ctx, { check: true }))).exitCode).toBe(0);
    // `.gitignore` is `init`'s file and `sync` merged the Run line into it: listed once.
    expect(created.filter((rel) => rel === ".gitignore")).toHaveLength(1);
    expect(p.read(".gitignore")).toBe(".warrant/evidence/**/raw/\n.warrant/runs/current\n");
    // Without --frontend no frontend is recorded and no file of Claude Code is written (SCN-KRN-134).
    expect(config).not.toHaveProperty("frontends");
    expect(existsSync(path.join(p.root, ".claude"))).toBe(false);
  });

  it("--frontend claude records frontends: [\"claude\"] and sync writes the managed subset (REQ-KRN-033)", async () => {
    const p = project();
    const run = await init(p, { frontend: "claude" });
    expect(run.errors).toEqual([]);
    const config = JSON.parse(p.read(".warrant/warrant.json")) as { frontends?: string[] };
    expect(config.frontends).toEqual(["claude"]);
    expect(run.data["created"]).toContain(".claude/settings.json");
    expect((await validate(p)).ok).toBe(true);
  });

  it("--frontend claude: FRONTEND_RESTART_REQUIRED for each written file Claude Code reads at start; none without changes (SCN-KRN-154)", async () => {
    // A rule with paths ["**"] makes sync write AGENTS.md; CLAUDE.md is never written (design no-claude-md D1).
    const p = project().write(".warrant/local/rules/language.json", {
      $schema: "warrant://rule/1",
      id: "language",
      paths: ["**"],
      text: "Docs are Russian."
    });
    const run = await init(p, { frontend: "claude" });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    const restart = (rel: string) => ({ code: "FRONTEND_RESTART_REQUIRED", path: rel, hint: RESTART_HINT });
    const findings = run.data["sync"]["findings"] as unknown[];
    expect(findings).toHaveLength(3);
    for (const rel of [".claude/settings.json", CLAUDE_REVIEWER_REL, "AGENTS.md"]) expect(findings).toContainEqual(restart(rel));
    expect(findings).not.toContainEqual(expect.objectContaining({ path: "CLAUDE.md" }));

    const sync = (check = false) => invoke(() => runSync(p.ctx, { check }));
    expect((await sync()).data["findings"]).toEqual([]);

    // One line of the subagent removed: only its file is rewritten.
    p.write(CLAUDE_REVIEWER_REL, p.read(CLAUDE_REVIEWER_REL).split("\n").slice(1).join("\n"));
    const check = await sync(true);
    expect(check.exitCode).toBe(3);
    expect(check.data["findings"]).toEqual([]);
    const again = await sync();
    expect(again.exitCode).toBe(0);
    expect(again.data["findings"]).toEqual([restart(CLAUDE_REVIEWER_REL)]);
  });

  it("an unknown --frontend is USAGE with a hint naming the known ones, nothing written", async () => {
    const p = project();
    const run = await init(p, { frontend: "codex" });
    expect(run.exitCode).toBe(3);
    expect(run.errors).toEqual([
      { code: "USAGE", message: 'unknown frontend "codex"', hint: "pass one of: --frontend claude" }
    ]);
    expect(existsSync(path.join(p.root, ".warrant"))).toBe(false);
    expect(p.openspec.calls).toEqual([]);
  });

  it("refuses a second init without --force, without calling openspec (SCN-KRN-053)", async () => {
    const p = project(false);
    const before = '{\n  "$schema": "warrant://config/1"\n}\n';
    p.write(".warrant/warrant.json", before);

    const run = await init(p);
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("ALREADY_INITIALIZED");
    expect(p.read(".warrant/warrant.json")).toBe(before);
    expect(p.openspec.calls).toEqual([]);
  });

  it("rewrites the files it owns with --force (SCN-KRN-053)", async () => {
    const p = project();
    expect((await init(p)).exitCode).toBe(0);
    p.write(".warrant/warrant.json", '{\n  "$schema": "warrant://config/1"\n}\n');

    const forced = await init(p, { force: true });
    expect(forced.errors).toEqual([]);
    expect(forced.exitCode).toBe(0);
    expect(forced.data["created"]).toContain(".warrant/warrant.json");
    const config = JSON.parse(p.read(".warrant/warrant.json")) as { packs?: Record<string, unknown> };
    expect(config.packs?.["core-sdd"]).toBeDefined();
    expect((await validate(p)).ok).toBe(true);
  });

  it("fails with OPENSPEC_FAILED and writes nothing when openspec is absent", async () => {
    const p = project(false);
    p.openspec.installedVersion = null;
    const run = await init(p);
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("OPENSPEC_FAILED");
    expect(existsSync(path.join(p.root, ".warrant"))).toBe(false);
  });

  it("rejects an unknown sub-command", async () => {
    const p = project(false);
    const run = await invoke(() => runInitCommand(p.ctx, ["foo"]));
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("USAGE");
  });
});

describe("warrant init change", () => {
  it("creates the OpenSpec change and a PROPOSED record (SCN-KRN-054)", async () => {
    const p = project();
    expect((await init(p)).exitCode).toBe(0);

    const run = await initChange(p, "add-search");
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.change).toBe("add-search");
    expect(run.data["record"]).toBe(".warrant/changes/add-search.json");
    expect(p.openspec.calls).toContain("new change add-search --schema warrant-sdd");

    expect(existsSync(path.join(p.root, "openspec", "changes", "add-search", ".openspec.yaml"))).toBe(true);
    const record = JSON.parse(readFileSync(path.join(p.root, ".warrant", "changes", "add-search.json"), "utf8")) as {
      change_state: string;
      classification?: unknown;
      transitions: { to: string; by: string }[];
    };
    expect(record.change_state).toBe("PROPOSED");
    expect(record.classification).toBeUndefined();
    expect(record.transitions).toHaveLength(1);
    expect(record.transitions[0]?.by).toBe("cli:local");
    expect(record.transitions[0]?.to).toBe("PROPOSED");

    // Its own name is now taken.
    const again = await initChange(p, "add-search");
    expect(again.exitCode).toBe(3);
    expect(again.errors[0]?.code).toBe("CHANGE_NAME_TAKEN");
  });

  it("refuses a name held by the archive before calling openspec (SCN-KRN-055)", async () => {
    const p = project(false)
      .write(".warrant/warrant.json", JSON.stringify({ $schema: "warrant://config/1", kernel: "0.1", openspec: "1.13.x", packs: {} }, null, 2) + "\n")
      .write("openspec/config.yaml", "schema: warrant-sdd\n");
    mkdirSync(path.join(p.root, "openspec", "changes", "archive", "2026-09-01-add-search"), { recursive: true });

    const run = await initChange(p, "add-search");
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("CHANGE_NAME_TAKEN");
    expect(p.openspec.calls).toEqual([]);
    expect(existsSync(path.join(p.root, "openspec", "changes", "add-search"))).toBe(false);
  });

  it("rejects a name that is not kebab-case", async () => {
    const p = project(false).write(".warrant/warrant.json", "{}\n");
    const run = await initChange(p, "Add_Search");
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("USAGE");
  });
});
