/**
 * `warrant sync` in the test process (REQ-KRN-025): generated files, their
 * idempotence and drift (SCN-KRN-061..064, 042), skills in the lock (SCN-SDD-013,
 * 014, SCN-KRN-087) and YAML scalars (SCN-KRN-100). Moved from e2e (ADR-0025,
 * task 5.3); the parse of argv (`--check`), the exit codes of the binary and
 * the acceptance of the generated schema by the real `openspec` stay in
 * `e2e/sync.test.ts` — the same acceptance is held by the contract of
 * `OpenSpecPort` (`schemaValidate` of the schema `ProjectBuilder.synced()` wrote).
 *
 * The OpenSpec version comes from `FakeOpenSpec`. `openspec init --tools none`
 * of the e2e projects is the base of `ProjectBuilder` plus a `config.yaml`
 * without the generated marker, which stands for the one `openspec init` writes.
 * Projects on other pack directories point the loader at them through
 * `WARRANT_PACKS_DIR`, as the e2e runs did through the environment of the binary.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse, parseDocument } from "yaml";

import { runSync, type SyncOptions } from "../../../src/commands/sync.js";
import { bytesHash } from "../../../src/core/canon/hash.js";
import { GENERATED_MARKER } from "../../../src/core/openspec/yaml-emit.js";
import type { CommandResult } from "../../../src/io/output.js";
import { CLI_ROOT, CORE_SDD_RANGE, REPO_ROOT } from "../../helpers/cli.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { validate } from "../helpers/validate.js";

const FIXTURE_PACKS = path.join(CLI_ROOT, "test", "fixtures", "packs");

const builder = useProjectBuilder();

const PACKS_ENV = "WARRANT_PACKS_DIR";
const packsEnvBefore = process.env[PACKS_ENV];
const tempDirs: string[] = [];
afterEach(() => {
  if (packsEnvBefore === undefined) delete process.env[PACKS_ENV];
  else process.env[PACKS_ENV] = packsEnvBefore;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The data of a result, read as the envelope is. */
type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

/** Stand-in for the `config.yaml` of `openspec init`: a file `warrant sync` did not generate. */
const INIT_CONFIG = "schema: spec-driven\n";

/** A temp project enabling the given packs, with OpenSpec initialised. */
function project(packs: Record<string, string> = { "core-sdd": CORE_SDD_RANGE }, init = true): ProjectBuilder {
  const p = builder()
    .remove(".warrant")
    .write(".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: Object.fromEntries(Object.entries(packs).map(([id, version]) => [id, { version }]))
    });
  return init ? p.write("openspec/config.yaml", INIT_CONFIG) : p.remove("openspec");
}

/** `warrant sync`; `openspec` finds a generated schema on disk, so `FakeOpenSpec` learns it (as `ProjectBuilder.synced()`). */
async function sync(p: ProjectBuilder, opts: SyncOptions = {}): Promise<Result> {
  const result = await invoke(() => runSync(p.ctx, opts));
  const schema = result.data["schema"];
  if (result.ok && opts.check !== true && typeof schema === "string" && schema !== "") p.openspec.schemas.add(schema);
  return result;
}

/** Byte hash of every file the run reported as generated. */
function hashes(root: string, paths: string[]): Record<string, string> {
  return Object.fromEntries(paths.map((rel) => [rel, bytesHash(readFileSync(path.join(root, rel)))]));
}

describe("warrant sync", () => {
  it("generates config.yaml, schema.yaml and templates (SCN-KRN-063)", async () => {
    const p = project();
    const run = await sync(p);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data["schema"]).toBe("warrant-sdd");

    const config = path.join(p.root, "openspec", "config.yaml");
    const schema = path.join(p.root, "openspec", "schemas", "warrant-sdd", "schema.yaml");
    for (const file of [config, schema]) {
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf8").split("\n")[0]).toBe(GENERATED_MARKER);
    }
    for (const name of ["proposal.md", "spec.md", "design.md", "tasks.md"]) {
      expect(existsSync(path.join(p.root, "openspec", "schemas", "warrant-sdd", "templates", name))).toBe(true);
    }
    expect(existsSync(path.join(p.root, ".warrant", "warrant.lock.json"))).toBe(true);
    expect(existsSync(path.join(p.root, ".warrant", "schemas", "lock.1.schema.json"))).toBe(true);
  });

  it("changes no byte on a second run (SCN-KRN-061)", async () => {
    const p = project();
    const first = await sync(p);
    expect(first.exitCode).toBe(0);
    const generated = first.data["generated"] as string[];
    const before = hashes(p.root, generated);

    const second = await sync(p);
    expect(second.exitCode).toBe(0);
    expect(second.data["changed"]).toEqual([]);
    expect(hashes(p.root, generated)).toEqual(before);

    const check = await sync(p, { check: true });
    expect(check.exitCode).toBe(0);
    expect(check.ok).toBe(true);
  });

  it("--check reports GENERATED_DRIFT with exit code 1 after config.yaml is edited", async () => {
    const p = project();
    expect((await sync(p)).exitCode).toBe(0);
    const config = path.join(p.root, "openspec", "config.yaml");
    const before = readFileSync(config, "utf8");
    writeFileSync(config, before.replace("schema: warrant-sdd", "schema: warrant-sdd # edited"), "utf8");

    const run = await sync(p, { check: true });
    expect(run.exitCode).toBe(1);
    expect(run.ok).toBe(false);
    expect(run.data["changed"]).toEqual(["openspec/config.yaml"]);
    const drift = run.errors.find((e) => e.code === "GENERATED_DRIFT");
    expect(drift?.path).toBe("openspec/config.yaml");
    // --check writes nothing.
    expect(readFileSync(config, "utf8")).toContain("# edited");
  });

  it("merges the project rules layer into config.yaml (SCN-KRN-062)", async () => {
    const p = project().write(".warrant/local/openspec/rules.json", {
      $schema: "warrant://openspec-rules/1",
      context: "Project line.",
      rules: { specs: ["Project rule", "Describe observable behaviour only, never internal names or libraries"] }
    });

    expect((await sync(p)).exitCode).toBe(0);
    const config = parse(readFileSync(path.join(p.root, "openspec", "config.yaml"), "utf8")) as {
      context: string;
      rules: Record<string, string[]>;
    };
    // The pack rule keeps its place; the project's new one is appended.
    expect(config.rules["specs"]?.[0]).toBe("Describe observable behaviour only, never internal names or libraries");
    expect(config.rules["specs"]?.at(-1)).toBe("Project rule");
    // The pack context leads, the project's own follows after one blank line.
    expect(config.context.startsWith("This project is governed by WARRANT")).toBe(true);
    expect(config.context.endsWith("\n\nProject line.")).toBe(true);
    // The pack no longer speaks for a concrete project (task 4.2).
    expect(config.context).not.toContain("Russian");
  });

  it("writes nothing when a pack is missing (SCN-KRN-064)", async () => {
    const p = project({ "bdd-tdd": "^0.1" });
    const run = await sync(p);
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("PACK_NOT_FOUND");
    expect(existsSync(path.join(p.root, ".warrant", "warrant.lock.json"))).toBe(false);
    expect(existsSync(path.join(p.root, ".warrant", "schemas"))).toBe(false);
    // `openspec init` wrote its own config.yaml; sync must not have touched it.
    expect(readFileSync(path.join(p.root, "openspec", "config.yaml"), "utf8")).not.toContain(GENERATED_MARKER);
  });

  it("reports CONFIG_INVALID when no enabled pack provides an OpenSpec schema", async () => {
    const p = project({ base: "^1.0" });
    process.env[PACKS_ENV] = FIXTURE_PACKS;
    const run = await sync(p);
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("CONFIG_INVALID");
    expect(run.errors[0]?.message).toContain("openspec_schema");
    expect(existsSync(path.join(p.root, ".warrant", "warrant.lock.json"))).toBe(false);
  });

  it("refuses a version of openspec outside the configured range (task 7.5)", async () => {
    const p = project({ "core-sdd": CORE_SDD_RANGE }, false);
    p.openspec.installedVersion = "9.9.9";

    const run = await sync(p);
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("OPENSPEC_VERSION");
    expect(run.errors[0]?.message).toContain("9.9.9");
    expect(existsSync(path.join(p.root, "openspec", "config.yaml"))).toBe(false);
    expect(existsSync(path.join(p.root, ".warrant", "warrant.lock.json"))).toBe(false);
  });

  it("leaves a synced project fully valid (SCN-KRN-042 without init)", async () => {
    const p = project();
    expect((await sync(p)).exitCode).toBe(0);
    const run = await validate(p);
    expect(run.errors).toEqual([]);
    expect(run.ok).toBe(true);
    expect(run.data["skipped"]).toEqual([]);
  });
});

describe("warrant sync: skills in the lock (REQ-SDD-008)", () => {
  /**
   * A project laid out like the WARRANT monorepo: the pack and the skills it
   * declares live inside it, which is the only layout in which a lock — whose
   * paths are project-relative — can address a skill at all.
   */
  function monorepo(): ProjectBuilder {
    const p = project();
    cpSync(path.join(REPO_ROOT, "packs", "core-sdd"), path.join(p.root, "packs", "core-sdd"), { recursive: true });
    cpSync(path.join(REPO_ROOT, "sra"), path.join(p.root, "sra"), { recursive: true });
    process.env[PACKS_ENV] = path.join(p.root, "packs");
    return p;
  }

  const SKILL_REL = "sra/skills/specification/adversarial-review/SKILL.md";

  it("records version, path and hash of every declared skill (SCN-SDD-013)", async () => {
    const p = monorepo();
    const run = await sync(p);
    expect(run.errors).toEqual([]);

    const lock = JSON.parse(readFileSync(path.join(p.root, ".warrant", "warrant.lock.json"), "utf8"));
    expect(lock.skills["specification/adversarial-review"]).toEqual({
      version: "0.2.0",
      path: SKILL_REL,
      hash: bytesHash(readFileSync(path.join(p.root, SKILL_REL)))
    });

    // A second run still changes nothing (SCN-KRN-061 with skills present).
    const again = await sync(p);
    expect(again.data["changed"]).toEqual([]);
  });

  it("reports LOCK_MISMATCH with the skill path after one edited line (SCN-SDD-014)", async () => {
    const p = monorepo();
    expect((await sync(p)).exitCode).toBe(0);

    const skill = path.join(p.root, SKILL_REL);
    writeFileSync(skill, readFileSync(skill, "utf8") + "\nOne more line, without a sync.\n", "utf8");

    const run = await validate(p);
    expect(run.exitCode).toBe(3);
    const finding = run.errors.find((e) => e.code === "LOCK_MISMATCH" && e.path === SKILL_REL);
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("specification/adversarial-review");
  });

  it("reports CONFIG_INVALID when the skill on disk is outside the declared range", async () => {
    const p = monorepo();
    const skill = path.join(p.root, SKILL_REL);
    writeFileSync(skill, readFileSync(skill, "utf8").replace(/^version: .*$/m, "version: 2.0.0"), "utf8");

    const run = await sync(p);
    expect(run.exitCode).toBe(3);
    const finding = run.errors.find((e) => e.code === "CONFIG_INVALID");
    expect(finding?.message).toContain("2.0.0");
    expect(finding?.path).toBe(SKILL_REL);
  });
});

describe("warrant sync: a skill that ships with the CLI outside the project (I-52)", () => {
  const SKILL = "specification/adversarial-review";
  const IN_PACK = "packs/core-sdd/skills/specification/adversarial-review/SKILL.md";

  /**
   * A bundle outside the project — `packs/core-sdd` with the skill inside the
   * pack — and a project that holds no copy of the skill.
   */
  function layout(): { p: ProjectBuilder; bundle: string } {
    const bundle = mkdtempSync(path.join(tmpdir(), "warrant-bundle-"));
    tempDirs.push(bundle);
    cpSync(path.join(REPO_ROOT, "packs", "core-sdd"), path.join(bundle, "packs", "core-sdd"), { recursive: true });
    cpSync(
      path.join(REPO_ROOT, "sra", "skills", "specification", "adversarial-review"),
      path.join(bundle, "packs", "core-sdd", "skills", "specification", "adversarial-review"),
      { recursive: true }
    );
    return { p: project(), bundle };
  }

  it("locks the skill with source bundled and a bundle-relative path, and validate checks its hash (SCN-KRN-087)", async () => {
    const { p, bundle } = layout();
    process.env[PACKS_ENV] = path.join(bundle, "packs");
    const run = await sync(p);
    expect(run.errors).toEqual([]);

    const lock = JSON.parse(readFileSync(path.join(p.root, ".warrant", "warrant.lock.json"), "utf8"));
    expect(lock.skills[SKILL]).toEqual({
      version: "0.2.0",
      path: IN_PACK,
      hash: bytesHash(readFileSync(path.join(bundle, IN_PACK))),
      source: "bundled"
    });
    const valid = await validate(p);
    expect(valid.errors).toEqual([]);
    expect(valid.exitCode).toBe(0);

    const skill = path.join(bundle, IN_PACK);
    writeFileSync(skill, readFileSync(skill, "utf8") + "\nOne more line, without a sync.\n", "utf8");
    const drift = await validate(p);
    expect(drift.exitCode).toBe(3);
    const finding = drift.errors.find((e) => e.code === "LOCK_MISMATCH" && e.message.includes(SKILL));
    expect(finding?.path).toContain(IN_PACK);
  });
});

describe("warrant sync: YAML scalars that are not strings (B5)", () => {
  it("quotes keys and values a YAML reader would not keep as strings (SCN-KRN-100)", async () => {
    const p = builder().remove(".warrant");
    const root = p.root;
    cpSync(path.join(REPO_ROOT, "packs", "core-sdd"), path.join(root, "packs", "core-sdd"), { recursive: true });
    cpSync(path.join(REPO_ROOT, "sra"), path.join(root, "sra"), { recursive: true });
    // An artifact whose id is the word `null`: it becomes a value in
    // schema.yaml and a `rules` key in config.yaml.
    const schemaFile = path.join(root, "packs", "core-sdd", "openspec", "schema.json");
    const schema = JSON.parse(readFileSync(schemaFile, "utf8")) as { artifacts: Record<string, unknown>[] };
    schema.artifacts.push({
      id: "null",
      generates: "null.md",
      description: "Artifact whose id reads as a YAML null",
      template: "proposal.md",
      requires: []
    });
    p.write("packs/core-sdd/openspec/schema.json", schema);
    const version = (JSON.parse(readFileSync(path.join(root, "packs", "core-sdd", "pack.json"), "utf8")) as {
      version: string;
    }).version;
    p.write(".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { "core-sdd": { version } }
    });
    p.write(".warrant/local/openspec/rules.json", {
      $schema: "warrant://openspec-rules/1",
      rules: { null: ["no"] },
      operations: { apply: { guidance: ["yes"] } }
    });
    p.write("openspec/config.yaml", INIT_CONFIG);
    process.env[PACKS_ENV] = path.join(root, "packs");

    const run = await sync(p);
    expect(run.errors).toEqual([]);

    const configText = readFileSync(path.join(root, "openspec", "config.yaml"), "utf8");
    const schemaText = readFileSync(path.join(root, "openspec", "schemas", "warrant-sdd", "schema.yaml"), "utf8");
    expect(configText).toContain('\n  "null":\n    - "no"\n');
    expect(configText).toContain('\n      - "yes"\n');
    expect(schemaText).toContain('- id: "null"\n');

    // Read back under both YAML versions: every key and value is a string.
    for (const version of ["1.1", "1.2"] as const) {
      const config = parseDocument(configText, { version }).toJS({ mapAsMap: true }) as Map<unknown, unknown>;
      const rules = config.get("rules") as Map<unknown, unknown>;
      expect([...rules.keys()]).toContain("null");
      expect(rules.get("null")).toEqual(["no"]);
      const operations = config.get("operations") as Map<unknown, Map<unknown, unknown>>;
      expect(operations.get("apply")?.get("guidance")).toContain("yes");
      const parsed = parseDocument(schemaText, { version }).toJS() as { artifacts: { id: unknown }[] };
      expect(parsed.artifacts.map((a) => a.id)).toContain("null");
    }
  });
});
