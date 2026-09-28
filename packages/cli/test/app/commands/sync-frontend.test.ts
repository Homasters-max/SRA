/**
 * Files of a frontend and `AGENTS.md` in `warrant sync` and `warrant validate`
 * (REQ-KRN-033, design phase-4a §8): the managed subset of
 * `.claude/settings.json`, the `@AGENTS.md` line of `CLAUDE.md`, the Run line of
 * `.gitignore`, the generated `AGENTS.md` (SCN-KRN-130…134) and the subagent
 * `.claude/agents/warrant-reviewer.md` of the review Run (SCN-KRN-139, 140;
 * design phase-4b §6) and its absence without the review skill (SCN-KRN-142).
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { runSync, type SyncOptions } from "../../../src/commands/sync.js";
import { AGENTS_MD_MARKER } from "../../../src/core/sync/agents.js";
import { CLAUDE_DENY, CLAUDE_REVIEWER_REL, GUARD_COMMAND } from "../../../src/core/sync/claude.js";
import type { CommandResult } from "../../../src/io/output.js";
import { CORE_SDD_RANGE, REPO_ROOT } from "../../helpers/cli.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { validateFile } from "../../../src/core/schemas/semantic.js";
import { validate, validateErrors } from "../helpers/validate.js";

const builder = useProjectBuilder();

const SETTINGS = ".claude/settings.json";
const PACKS_ENV = "WARRANT_PACKS_DIR";

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

describe("warrant sync: the subagent warrant-reviewer", () => {
  const SKILL = path.join(REPO_ROOT, "sra", "skills", "specification", "adversarial-review", "SKILL.md");

  /** Keys of the leading frontmatter, parsed as YAML like Claude Code does, and the body after it. */
  function agentParts(text: string): { frontmatter: Record<string, any>; body: string } {
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    expect(match, "leading --- frontmatter").not.toBeNull();
    return { frontmatter: parseYaml(match?.[1] ?? "") as Record<string, any>, body: match?.[2] ?? "" };
  }

  it("frontmatter with reading tools, Bash and Write and the guard hook on Bash|Write, the marker, the review skill, run submit --file; a second sync changes no byte (SCN-KRN-139)", async () => {
    const p = project(["claude"]);
    const run = await sync(p);
    expect(run.errors).toEqual([]);
    expect(run.data["changed"]).toContain(CLAUDE_REVIEWER_REL);

    const text = p.read(CLAUDE_REVIEWER_REL);
    const { frontmatter, body } = agentParts(text);
    expect(frontmatter["name"]).toBe("warrant-reviewer");
    expect(frontmatter["description"]).toEqual(expect.any(String));
    const tools = String(frontmatter["tools"]).split(",").map((t) => t.trim());
    expect(tools).toEqual(["Read", "Grep", "Glob", "Bash", "Write"]);
    expect(tools.filter((t) => ["Edit", "NotebookEdit"].includes(t))).toEqual([]);
    expect(frontmatter["hooks"]).toEqual({ PreToolUse: [{ matcher: "Bash|Write", hooks: [{ type: "command", command: GUARD_COMMAND }] }] });

    // The marker, the text of the skill without its frontmatter, then how the result is handed in.
    expect(body.split("\n").find((l) => l.trim() !== "")).toBe(AGENTS_MD_MARKER);
    const skill = readFileSync(SKILL, "utf8").replace(/\r\n/g, "\n");
    const skillBody = skill.slice(skill.indexOf("\n---\n", 4) + 5).trim();
    expect(body).toContain(skillBody);
    expect(body).not.toContain("version: 0.2.0");
    const submit = body.indexOf("## Сдача результата");
    expect(submit).toBeGreaterThan(body.indexOf(skillBody));
    const handIn = body.slice(submit);
    expect(handIn).toContain("warrant run submit --file");
    expect(handIn).toContain("--dry-run");
    expect(handIn).toContain("часть сдачи");
    expect(handIn).toContain("Scratchpad directory");
    expect(handIn).not.toContain("<<'JSON'");
    expect(handIn).toContain("specification/adversarial-review@0.2.0");
    // Every example envelope of the body passes warrant://skill-result/1 (R-22, I-197).
    const examples = [...body.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1] as string) as Record<string, unknown>);
    expect(examples.length).toBeGreaterThanOrEqual(2);
    for (const example of examples) expect(validateFile(example as never, "example").ok).toBe(true);

    // Hashed by the lock like every exact target; validate is clean; a second sync writes nothing.
    const lock = JSON.parse(p.read(".warrant/warrant.lock.json")) as { generated: Record<string, string> };
    expect(lock.generated[CLAUDE_REVIEWER_REL]).toMatch(/^sha256:/);
    expect(await validate(p)).toMatchObject({ ok: true });
    expect((await sync(p)).data["changed"]).toEqual([]);
    expect(p.read(CLAUDE_REVIEWER_REL)).toBe(text);
  });

  it("one changed line of the file: validate gives GENERATED_DRIFT with its path and the hint, code 3 (SCN-KRN-140)", async () => {
    const p = project(["claude"]);
    await p.synced();
    p.write(CLAUDE_REVIEWER_REL, p.read(CLAUDE_REVIEWER_REL).replace("tools: Read, Grep, Glob, Bash", "tools: Read, Grep, Glob, Bash, Write"));
    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    expect(run.errors).toContainEqual(
      expect.objectContaining({ code: "GENERATED_DRIFT", path: CLAUDE_REVIEWER_REL, hint: "run `warrant sync`" })
    );
    await sync(p);
    expect(await validate(p)).toMatchObject({ ok: true });
  });

  it("packs without the review skill: no subagent, REVIEWER_SKILL_MISSING in data.findings, exit 0; the generated file is removed (SCN-KRN-142)", async () => {
    const p = project(["claude"]);
    await p.synced();
    expect(exists(p, CLAUDE_REVIEWER_REL)).toBe(true);

    // core-sdd without `provides.skills`, from a bundle of its own.
    const bundle = mkdtempSync(path.join(tmpdir(), "warrant-bundle-"));
    const before = process.env[PACKS_ENV];
    try {
      const pack = path.join(bundle, "packs", "core-sdd");
      cpSync(path.join(REPO_ROOT, "packs", "core-sdd"), pack, { recursive: true });
      const manifest = JSON.parse(readFileSync(path.join(pack, "pack.json"), "utf8")) as { provides: Record<string, unknown> };
      delete manifest.provides["skills"];
      writeFileSync(path.join(pack, "pack.json"), JSON.stringify(manifest, null, 2));
      process.env[PACKS_ENV] = path.join(bundle, "packs");

      const missing = { code: "REVIEWER_SKILL_MISSING", path: CLAUDE_REVIEWER_REL, hint: expect.stringContaining("specification/adversarial-review") };
      // --check: the finding is reported; the exit code is the drift of the files — the file sync would delete among them.
      const check = await sync(p, { check: true });
      expect(check.data["findings"]).toEqual([missing]);
      expect(check.exitCode).toBe(1);
      expect(check.errors).toContainEqual(expect.objectContaining({ code: "GENERATED_DRIFT", path: CLAUDE_REVIEWER_REL }));
      expect(exists(p, CLAUDE_REVIEWER_REL)).toBe(true);

      const run = await sync(p);
      expect(run.errors).toEqual([]);
      expect(run.exitCode).toBe(0);
      expect(run.data["findings"]).toEqual([missing]);
      expect(run.data["changed"]).toContain(CLAUDE_REVIEWER_REL);
      expect(run.data["generated"]).not.toContain(CLAUDE_REVIEWER_REL);
      expect(exists(p, CLAUDE_REVIEWER_REL)).toBe(false);
      expect(settings(p)["permissions"]["deny"]).toEqual(expect.arrayContaining([...CLAUDE_DENY]));
      expect(await validate(p)).toMatchObject({ ok: true });

      // A file without the marker is not ours: kept by sync, not compared by validate.
      p.write(CLAUDE_REVIEWER_REL, "---\nname: my-reviewer\n---\n\nMy own reviewer.\n");
      const again = await sync(p);
      expect(again.data["changed"]).toEqual([]);
      expect(again.data["findings"]).toEqual([missing]);
      expect(p.read(CLAUDE_REVIEWER_REL)).toBe("---\nname: my-reviewer\n---\n\nMy own reviewer.\n");
      expect(await validate(p)).toMatchObject({ ok: true });
    } finally {
      if (before === undefined) delete process.env[PACKS_ENV];
      else process.env[PACKS_ENV] = before;
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("data.findings is empty when a pack provides the review skill (REQ-KRN-033)", async () => {
    const run = await sync(project(["claude"]));
    expect(run.data["findings"]).toEqual([]);
  });
});

describe("warrant sync: project without frontend", () => {
  it("touches no file of Claude Code, keeps .warrant/runs/current in .gitignore (SCN-KRN-134)", async () => {
    const p = project().write(".gitignore", "node_modules/");
    const run = await sync(p);
    expect(run.errors).toEqual([]);
    for (const rel of [SETTINGS, CLAUDE_REVIEWER_REL, "CLAUDE.md", "AGENTS.md"]) expect(exists(p, rel), rel).toBe(false);
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
