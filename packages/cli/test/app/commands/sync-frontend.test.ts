/**
 * Files of a frontend and `AGENTS.md` in `warrant sync` and `warrant validate`
 * (REQ-KRN-033, design phase-4a §8): the managed subset of
 * `.claude/settings.json`, the `@AGENTS.md` line of `CLAUDE.md`, the Run line of
 * `.gitignore` and the generated `AGENTS.md` (SCN-KRN-130…134).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runSync, type SyncOptions } from "../../../src/commands/sync.js";
import { AGENTS_MD_MARKER } from "../../../src/core/sync/agents.js";
import { CLAUDE_DENY, GUARD_COMMAND } from "../../../src/core/sync/claude.js";
import type { CommandResult } from "../../../src/io/output.js";
import { CORE_SDD_RANGE } from "../../helpers/cli.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { validate, validateErrors } from "../helpers/validate.js";

const builder = useProjectBuilder();

const SETTINGS = ".claude/settings.json";

/** A project with the given `frontends`; `undefined` leaves the key out. */
function project(frontends?: string[]): ProjectBuilder {
  return builder()
    .write(".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { "core-sdd": { version: CORE_SDD_RANGE } },
      roles: { maintainer: ["kat"] },
      ...(frontends === undefined ? {} : { frontends })
    })
    .write("openspec/config.yaml", "schema: spec-driven\n");
}

function rule(p: ProjectBuilder, id: string, paths: string[], text: string): ProjectBuilder {
  return p.write(`.warrant/local/rules/${id}.json`, { $schema: "warrant://rule/1", id, paths, text });
}

async function sync(p: ProjectBuilder, opts: SyncOptions = {}): Promise<CommandResult> {
  const result = await invoke(() => runSync(p.ctx, opts));
  const schema = result.data["schema"];
  if (result.ok && opts.check !== true && typeof schema === "string" && schema !== "") p.openspec.schemas.add(schema);
  return result;
}

function exists(p: ProjectBuilder, rel: string): boolean {
  return existsSync(path.join(p.root, ...rel.split("/")));
}

function settings(p: ProjectBuilder): Record<string, any> {
  return JSON.parse(p.read(SETTINGS)) as Record<string, any>;
}

const FOREIGN_HOOK = { matcher: "Bash", hooks: [{ type: "command", command: "echo foreign" }] };

describe("warrant sync: managed subset of .claude/settings.json", () => {
  it("adds its deny and guard hooks, keeps a foreign hook and env; a second sync changes no byte (SCN-KRN-130)", async () => {
    const p = project(["claude"]).write(SETTINGS, { env: { FOO: "1" }, hooks: { PreToolUse: [FOREIGN_HOOK] } });
    const first = await sync(p);
    expect(first.errors).toEqual([]);
    expect(first.data["changed"]).toContain(SETTINGS);

    const json = settings(p);
    expect(json["env"]).toEqual({ FOO: "1" });
    expect(json["permissions"]["deny"]).toEqual([...CLAUDE_DENY]);
    expect(json["hooks"]["PreToolUse"]).toEqual([
      FOREIGN_HOOK,
      { matcher: "Edit|Write|NotebookEdit|Bash", hooks: [{ type: "command", command: GUARD_COMMAND }] }
    ]);
    expect(json["hooks"]["PostToolUse"]).toEqual([
      { matcher: "Edit|Write|NotebookEdit", hooks: [{ type: "command", command: GUARD_COMMAND }] }
    ]);
    // Canonical JSON: two spaces, sorted keys, one trailing newline.
    expect(p.read(SETTINGS)).toBe(`${JSON.stringify(json, null, 2)}\n`);
    expect(Object.keys(json)).toEqual(["env", "hooks", "permissions"]);

    const before = p.read(SETTINGS);
    const second = await sync(p);
    expect(second.data["changed"]).toEqual([]);
    expect(p.read(SETTINGS)).toBe(before);
    expect((await sync(p, { check: true })).exitCode).toBe(0);
    expect(await validate(p)).toMatchObject({ ok: true });
  });

  it("replaces its own group with another matcher and keeps foreign hooks of a shared group", async () => {
    const p = project(["claude"]).write(SETTINGS, {
      hooks: {
        PreToolUse: [
          { matcher: "Edit", hooks: [{ type: "command", command: GUARD_COMMAND }] },
          { matcher: "Bash", hooks: [{ type: "command", command: GUARD_COMMAND }, { type: "command", command: "echo x" }] }
        ]
      },
      permissions: { deny: ["Read(./.env)"], allow: ["Bash(npm test)"] }
    });
    await sync(p);
    const json = settings(p);
    expect(json["hooks"]["PreToolUse"]).toEqual([
      { matcher: "Edit|Write|NotebookEdit|Bash", hooks: [{ type: "command", command: GUARD_COMMAND }] },
      { matcher: "Bash", hooks: [{ type: "command", command: "echo x" }] }
    ]);
    expect(json["permissions"]).toEqual({ allow: ["Bash(npm test)"], deny: ["Read(./.env)", ...CLAUDE_DENY] });
  });

  it("refuses to merge a settings.json that is not a JSON object: CONFIG_INVALID with hint, nothing written", async () => {
    const p = project(["claude"]).write(SETTINGS, "[1, 2]\n");
    const run = await sync(p);
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]).toMatchObject({ code: "CONFIG_INVALID", path: SETTINGS });
    expect(run.errors[0]?.hint).toContain("warrant sync");
    expect(p.read(SETTINGS)).toBe("[1, 2]\n");
    expect(p.read(".warrant/warrant.lock.json")).not.toContain('"generated"');
  });
});

describe("warrant validate: managed subset", () => {
  it("a removed deny gives one GENERATED_DRIFT with the pointer and hint; foreign edits give none (SCN-KRN-131)", async () => {
    const p = project(["claude"]).write(SETTINGS, { env: { FOO: "1" } });
    await p.synced();
    expect(await validate(p)).toMatchObject({ ok: true });

    const json = settings(p);
    json["permissions"]["deny"] = (json["permissions"]["deny"] as string[]).filter((r) => r !== "Edit(/.warrant/runs/**)");
    json["env"] = { FOO: "2", BAR: "3" };
    json["model"] = "opus";
    p.write(SETTINGS, json);

    const errors = await validateErrors(p);
    expect(errors).toEqual([
      {
        code: "GENERATED_DRIFT",
        message: "entry `warrant sync` keeps in this file is missing or differs",
        path: `${SETTINGS}#/permissions/deny`,
        hint: "run `warrant sync`"
      }
    ]);
  });

  it("a guard hook with another matcher is drift of that hook event", async () => {
    const p = project(["claude"]);
    await p.synced();
    const json = settings(p);
    json["hooks"]["PostToolUse"][0]["matcher"] = "Edit|Write";
    p.write(SETTINGS, json);
    expect((await validateErrors(p)).map((e) => e.path)).toEqual([`${SETTINGS}#/hooks/PostToolUse`]);
  });

  it("a missing .gitignore line is GENERATED_DRIFT of .gitignore", async () => {
    const p = project();
    await p.synced();
    p.write(".gitignore", "node_modules/\n");
    expect(await validateErrors(p)).toEqual([
      expect.objectContaining({ code: "GENERATED_DRIFT", path: ".gitignore", hint: "run `warrant sync`" })
    ]);
  });
});

describe("warrant sync: AGENTS.md and CLAUDE.md", () => {
  it("AGENTS.md holds only the rules with paths [\"**\"], CLAUDE.md imports it (SCN-KRN-132)", async () => {
    const p = rule(rule(project(["claude"]), "language-split", ["**"], "Docs are Russian."), "src-style", ["src/**"], "Keep modules small.");
    rule(p, "ids-by-cli", ["**"], "IDs are allocated by the CLI.\n");
    const run = await sync(p);
    expect(run.errors).toEqual([]);

    expect(p.read("AGENTS.md")).toBe(
      `${AGENTS_MD_MARKER}\n\nIDs are allocated by the CLI.\n\nDocs are Russian.\n`
    );
    expect(p.read("AGENTS.md")).not.toContain("Keep modules small.");
    expect(p.read("CLAUDE.md")).toBe("@AGENTS.md\n");
    expect(p.read(".warrant/warrant.lock.json")).toContain('"AGENTS.md"');
    expect(await validate(p)).toMatchObject({ ok: true });

    // validate compares AGENTS.md byte by byte.
    p.write("AGENTS.md", `${p.read("AGENTS.md")}manual line\n`);
    expect((await validateErrors(p)).map((e) => [e.code, e.path])).toContainEqual(["GENERATED_DRIFT", "AGENTS.md"]);
  });

  it("appends @AGENTS.md to an existing CLAUDE.md once", async () => {
    const p = rule(project(["claude"]), "language-split", ["**"], "Docs are Russian.").write("CLAUDE.md", "# Project\n\nNotes");
    await sync(p);
    expect(p.read("CLAUDE.md")).toBe("# Project\n\nNotes\n@AGENTS.md\n");
    expect((await sync(p)).data["changed"]).toEqual([]);
  });

  it("without rules with paths [\"**\"] no AGENTS.md and no CLAUDE.md are created", async () => {
    const p = rule(project(["claude"]), "src-style", ["src/**"], "Keep modules small.");
    await sync(p);
    expect(exists(p, "AGENTS.md")).toBe(false);
    expect(exists(p, "CLAUDE.md")).toBe(false);
    expect(exists(p, SETTINGS)).toBe(true);
  });

  it("AGENTS.md above 16 KiB: GENERATED_TOO_LARGE with hint, no file written, exit 3 (SCN-KRN-133)", async () => {
    const p = rule(project(["claude"]), "huge", ["**"], "x".repeat(16 * 1024));
    const run = await sync(p);
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]).toMatchObject({ code: "GENERATED_TOO_LARGE", path: "AGENTS.md" });
    expect(run.errors[0]?.hint).toBeTruthy();
    for (const rel of ["AGENTS.md", "CLAUDE.md", SETTINGS, ".gitignore", "openspec/schemas", ".warrant/schemas"]) {
      expect(exists(p, rel), rel).toBe(false);
    }
    expect((await validateErrors(p)).map((e) => e.code)).toContain("GENERATED_TOO_LARGE");
  });
});

describe("warrant sync: project without frontend", () => {
  it("touches no file of Claude Code, keeps .warrant/runs/current in .gitignore (SCN-KRN-134)", async () => {
    const p = project().write(".gitignore", "node_modules/");
    const run = await sync(p);
    expect(run.errors).toEqual([]);
    for (const rel of [SETTINGS, "CLAUDE.md", "AGENTS.md"]) expect(exists(p, rel), rel).toBe(false);
    expect(p.read(".gitignore")).toBe("node_modules/\n.warrant/runs/current\n");
    expect(run.data["changed"]).toContain(".gitignore");
    expect(run.data["generated"]).not.toContain(".gitignore");

    const second = await sync(p);
    expect(second.data["changed"]).toEqual([]);
  });

  it("sync --check reports the missing line as GENERATED_DRIFT, code 1", async () => {
    const p = project();
    await p.synced();
    p.write(".gitignore", "");
    const check = await sync(p, { check: true });
    expect(check.exitCode).toBe(1);
    expect(check.errors).toEqual([expect.objectContaining({ code: "GENERATED_DRIFT", path: ".gitignore" })]);
  });
});
