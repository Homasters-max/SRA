import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse, parseDocument } from "yaml";

import { canonicalText } from "../../src/core/canon/format-json.js";
import { bytesHash } from "../../src/core/canon/hash.js";
import { GENERATED_MARKER } from "../../src/core/openspec/yaml-emit.js";
import { openspecAvailable, openspecSync } from "../helpers/openspec.js";
import { CLI_ROOT, CORE_SDD_RANGE, REPO_ROOT, makeTempDir, removeDir, runCli } from "../helpers/cli.js";
import { installFakeOpenspec } from "../helpers/fake-openspec.js";

const FIXTURE_PACKS = path.join(CLI_ROOT, "test", "fixtures", "packs");
const tempDirs: string[] = [];
const hasOpenspec = openspecAvailable();

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

function write(root: string, rel: string, content: string | object): void {
  const absolute = path.join(root, rel);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, typeof content === "string" ? content : canonicalText(content).text, "utf8");
}

/** A temp project enabling the given packs, with OpenSpec initialised. */
function project(packs: Record<string, string> = { "core-sdd": CORE_SDD_RANGE }, init = true): string {
  const root = makeTempDir("warrant-sync-");
  tempDirs.push(root);
  write(root, ".warrant/warrant.json", {
    $schema: "warrant://config/1",
    kernel: "0.1",
    openspec: "1.13.x",
    packs: Object.fromEntries(Object.entries(packs).map(([id, version]) => [id, { version }]))
  });
  if (init) expect(openspecSync(["init", "--tools", "none"], root).ok).toBe(true);
  return root;
}

/** Byte hash of every file the run reported as generated. */
function hashes(root: string, paths: string[]): Record<string, string> {
  return Object.fromEntries(paths.map((rel) => [rel, bytesHash(readFileSync(path.join(root, rel)))]));
}

/** PATH key as Windows spells it, so the override replaces rather than duplicates it. */
const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";

describe("warrant sync", () => {
  it.skipIf(!hasOpenspec)(
    "generates config.yaml, schema.yaml and templates that openspec accepts (SCN-KRN-063)",
    async () => {
      const root = project();
      const run = await runCli(["sync"], root);
      expect(run.json?.errors).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.json?.data.schema).toBe("warrant-sdd");

      const config = path.join(root, "openspec", "config.yaml");
      const schema = path.join(root, "openspec", "schemas", "warrant-sdd", "schema.yaml");
      for (const file of [config, schema]) {
        expect(existsSync(file)).toBe(true);
        expect(readFileSync(file, "utf8").split("\n")[0]).toBe(GENERATED_MARKER);
      }
      for (const name of ["proposal.md", "spec.md", "design.md", "tasks.md"]) {
        expect(existsSync(path.join(root, "openspec", "schemas", "warrant-sdd", "templates", name))).toBe(true);
      }
      expect(existsSync(path.join(root, ".warrant", "warrant.lock.json"))).toBe(true);
      expect(existsSync(path.join(root, ".warrant", "schemas", "lock.1.schema.json"))).toBe(true);

      const validated = openspecSync(["schema", "validate", "warrant-sdd", "--json"], root);
      expect((validated.json as { valid?: boolean }).valid).toBe(true);
    },
    60_000
  );

  it.skipIf(!hasOpenspec)(
    "changes no byte on a second run (SCN-KRN-061)",
    async () => {
      const root = project();
      const first = await runCli(["sync"], root);
      expect(first.status).toBe(0);
      const generated = first.json?.data.generated as string[];
      const before = hashes(root, generated);

      const second = await runCli(["sync"], root);
      expect(second.status).toBe(0);
      expect(second.json?.data.changed).toEqual([]);
      expect(hashes(root, generated)).toEqual(before);

      const check = await runCli(["sync", "--check"], root);
      expect(check.status).toBe(0);
      expect(check.json?.ok).toBe(true);
    },
    60_000
  );

  it.skipIf(!hasOpenspec)(
    "--check reports GENERATED_DRIFT with exit code 1 after config.yaml is edited",
    async () => {
      const root = project();
      expect((await runCli(["sync"], root)).status).toBe(0);
      const config = path.join(root, "openspec", "config.yaml");
      const before = readFileSync(config, "utf8");
      writeFileSync(config, before.replace("schema: warrant-sdd", "schema: warrant-sdd # edited"), "utf8");

      const run = await runCli(["sync", "--check"], root);
      expect(run.status).toBe(1);
      expect(run.json?.ok).toBe(false);
      expect(run.json?.data.changed).toEqual(["openspec/config.yaml"]);
      const drift = run.json?.errors.find((e: { code: string }) => e.code === "GENERATED_DRIFT");
      expect(drift.path).toBe("openspec/config.yaml");
      // --check writes nothing.
      expect(readFileSync(config, "utf8")).toContain("# edited");
    },
    60_000
  );

  it.skipIf(!hasOpenspec)(
    "merges the project rules layer into config.yaml (SCN-KRN-062)",
    async () => {
      const root = project();
      write(root, ".warrant/local/openspec/rules.json", {
        $schema: "warrant://openspec-rules/1",
        context: "Project line.",
        rules: { specs: ["Project rule", "Describe observable behaviour only, never internal names or libraries"] }
      });

      expect((await runCli(["sync"], root)).status).toBe(0);
      const config = parse(readFileSync(path.join(root, "openspec", "config.yaml"), "utf8")) as {
        context: string;
        rules: Record<string, string[]>;
      };
      // The pack rule keeps its place; the project's new one is appended.
      expect(config.rules.specs?.[0]).toBe("Describe observable behaviour only, never internal names or libraries");
      expect(config.rules.specs?.at(-1)).toBe("Project rule");
      // The pack context leads, the project's own follows after one blank line.
      expect(config.context.startsWith("This project is governed by WARRANT")).toBe(true);
      expect(config.context.endsWith("\n\nProject line.")).toBe(true);
      // The pack no longer speaks for a concrete project (task 4.2).
      expect(config.context).not.toContain("Russian");
    },
    60_000
  );

  it.skipIf(!hasOpenspec)(
    "writes nothing when a pack is missing (SCN-KRN-064)",
    async () => {
      const root = project({ "bdd-tdd": "^0.1" });
      const run = await runCli(["sync"], root);
      expect(run.status).toBe(3);
      expect(run.json?.errors[0].code).toBe("PACK_NOT_FOUND");
      expect(existsSync(path.join(root, ".warrant", "warrant.lock.json"))).toBe(false);
      expect(existsSync(path.join(root, ".warrant", "schemas"))).toBe(false);
      // `openspec init` wrote its own config.yaml; sync must not have touched it.
      expect(readFileSync(path.join(root, "openspec", "config.yaml"), "utf8")).not.toContain(GENERATED_MARKER);
    },
    60_000
  );

  it.skipIf(!hasOpenspec)(
    "reports CONFIG_INVALID when no enabled pack provides an OpenSpec schema",
    async () => {
      const root = project({ base: "^1.0" });
      const run = await runCli(["sync"], root, { WARRANT_PACKS_DIR: FIXTURE_PACKS });
      expect(run.status).toBe(3);
      expect(run.json?.errors[0].code).toBe("CONFIG_INVALID");
      expect(run.json?.errors[0].message).toContain("openspec_schema");
      expect(existsSync(path.join(root, ".warrant", "warrant.lock.json"))).toBe(false);
    },
    60_000
  );

  it("refuses a version of openspec outside the configured range (task 7.5)", async () => {
    const root = project({ "core-sdd": CORE_SDD_RANGE }, false);
    const fake = makeTempDir("warrant-fake-openspec-");
    tempDirs.push(fake);
    installFakeOpenspec(fake, `process.stdout.write("9.9.9\\n");\n`);

    const run = await runCli(["sync"], root, {
      [PATH_KEY]: fake + path.delimiter + (process.env[PATH_KEY] ?? "")
    });
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("OPENSPEC_VERSION");
    expect(run.json?.errors[0].message).toContain("9.9.9");
    expect(existsSync(path.join(root, "openspec", "config.yaml"))).toBe(false);
    expect(existsSync(path.join(root, ".warrant", "warrant.lock.json"))).toBe(false);
  });

  it.skipIf(!hasOpenspec)(
    "leaves a synced project fully valid (SCN-KRN-042 without init)",
    async () => {
      const root = project();
      expect((await runCli(["sync"], root)).status).toBe(0);
      const run = await runCli(["validate"], root);
      expect(run.json?.errors).toEqual([]);
      expect(run.json?.ok).toBe(true);
      expect(run.json?.data.skipped).toEqual([]);
    },
    60_000
  );
});

describe("warrant sync: skills in the lock (REQ-SDD-008)", () => {
  /**
   * A project laid out like the WARRANT monorepo: the pack and the skills it
   * declares live inside it, which is the only layout in which a lock — whose
   * paths are project-relative — can address a skill at all.
   */
  function monorepo(): string {
    const root = makeTempDir("warrant-skills-");
    tempDirs.push(root);
    cpSync(path.join(REPO_ROOT, "packs", "core-sdd"), path.join(root, "packs", "core-sdd"), { recursive: true });
    cpSync(path.join(REPO_ROOT, "sra"), path.join(root, "sra"), { recursive: true });
    write(root, ".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { "core-sdd": { version: CORE_SDD_RANGE } }
    });
    expect(openspecSync(["init", "--tools", "none"], root).ok).toBe(true);
    return root;
  }

  const SKILL_REL = "sra/skills/specification/adversarial-review/SKILL.md";

  it.skipIf(!hasOpenspec)(
    "records version, path and hash of every declared skill (SCN-SDD-013)",
    async () => {
      const root = monorepo();
      const run = await runCli(["sync"], root, { WARRANT_PACKS_DIR: path.join(root, "packs") });
      expect(run.json?.errors).toEqual([]);

      const lock = JSON.parse(readFileSync(path.join(root, ".warrant", "warrant.lock.json"), "utf8"));
      expect(lock.skills["specification/adversarial-review"]).toEqual({
        version: "0.1.0",
        path: SKILL_REL,
        hash: bytesHash(readFileSync(path.join(root, SKILL_REL)))
      });

      // A second run still changes nothing (SCN-KRN-061 with skills present).
      const again = await runCli(["sync"], root, { WARRANT_PACKS_DIR: path.join(root, "packs") });
      expect(again.json?.data.changed).toEqual([]);
    },
    120_000
  );

  it.skipIf(!hasOpenspec)(
    "reports LOCK_MISMATCH with the skill path after one edited line (SCN-SDD-014)",
    async () => {
      const root = monorepo();
      expect((await runCli(["sync"], root, { WARRANT_PACKS_DIR: path.join(root, "packs") })).status).toBe(0);

      const skill = path.join(root, SKILL_REL);
      writeFileSync(skill, readFileSync(skill, "utf8") + "\nOne more line, without a sync.\n", "utf8");

      const run = await runCli(["validate"], root, { WARRANT_PACKS_DIR: path.join(root, "packs") });
      expect(run.status).toBe(3);
      const finding = run.json?.errors.find(
        (e: { code: string; path?: string }) => e.code === "LOCK_MISMATCH" && e.path === SKILL_REL
      );
      expect(finding).toBeDefined();
      expect(finding.message).toContain("specification/adversarial-review");
    },
    120_000
  );

  it.skipIf(!hasOpenspec)(
    "reports CONFIG_INVALID when the skill on disk is outside the declared range",
    async () => {
      const root = monorepo();
      const skill = path.join(root, SKILL_REL);
      writeFileSync(skill, readFileSync(skill, "utf8").replace(/^version: .*$/m, "version: 2.0.0"), "utf8");

      const run = await runCli(["sync"], root, { WARRANT_PACKS_DIR: path.join(root, "packs") });
      expect(run.status).toBe(3);
      const finding = run.json?.errors.find((e: { code: string }) => e.code === "CONFIG_INVALID");
      expect(finding.message).toContain("2.0.0");
      expect(finding.path).toBe(SKILL_REL);
    },
    120_000
  );
});

describe("warrant sync: a skill that ships with the CLI outside the project (I-52)", () => {
  const SKILL = "specification/adversarial-review";
  const IN_PACK = "packs/core-sdd/skills/specification/adversarial-review/SKILL.md";

  /**
   * A bundle outside the project — `packs/core-sdd` with the skill inside the
   * pack — and a project that holds no copy of the skill.
   */
  function layout(): { root: string; bundle: string } {
    const bundle = makeTempDir("warrant-bundle-");
    tempDirs.push(bundle);
    cpSync(path.join(REPO_ROOT, "packs", "core-sdd"), path.join(bundle, "packs", "core-sdd"), { recursive: true });
    cpSync(
      path.join(REPO_ROOT, "sra", "skills", "specification", "adversarial-review"),
      path.join(bundle, "packs", "core-sdd", "skills", "specification", "adversarial-review"),
      { recursive: true }
    );
    return { root: project(), bundle };
  }

  it.skipIf(!hasOpenspec)(
    "locks the skill with source bundled and a bundle-relative path, and validate checks its hash (SCN-KRN-087)",
    async () => {
      const { root, bundle } = layout();
      const env = { WARRANT_PACKS_DIR: path.join(bundle, "packs") };
      const sync = await runCli(["sync"], root, env);
      expect(sync.json?.errors).toEqual([]);

      const lock = JSON.parse(readFileSync(path.join(root, ".warrant", "warrant.lock.json"), "utf8"));
      expect(lock.skills[SKILL]).toEqual({
        version: "0.1.0",
        path: IN_PACK,
        hash: bytesHash(readFileSync(path.join(bundle, IN_PACK))),
        source: "bundled"
      });
      const valid = await runCli(["validate"], root, env);
      expect(valid.json?.errors).toEqual([]);
      expect(valid.status).toBe(0);

      const skill = path.join(bundle, IN_PACK);
      writeFileSync(skill, readFileSync(skill, "utf8") + "\nOne more line, without a sync.\n", "utf8");
      const drift = await runCli(["validate"], root, env);
      expect(drift.status).toBe(3);
      const finding = drift.json?.errors.find(
        (e: { code: string; message: string }) => e.code === "LOCK_MISMATCH" && e.message.includes(SKILL)
      );
      expect(finding?.path).toContain(IN_PACK);
    },
    120_000
  );
});

describe("warrant sync: YAML scalars that are not strings (B5)", () => {
  it.skipIf(!hasOpenspec)(
    "quotes keys and values a YAML reader would not keep as strings (SCN-KRN-100)",
    async () => {
      const root = makeTempDir("warrant-yaml-");
      tempDirs.push(root);
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
      write(root, "packs/core-sdd/openspec/schema.json", schema);
      const version = (JSON.parse(readFileSync(path.join(root, "packs", "core-sdd", "pack.json"), "utf8")) as {
        version: string;
      }).version;
      write(root, ".warrant/warrant.json", {
        $schema: "warrant://config/1",
        kernel: "0.1",
        openspec: "1.13.x",
        packs: { "core-sdd": { version } }
      });
      write(root, ".warrant/local/openspec/rules.json", {
        $schema: "warrant://openspec-rules/1",
        rules: { null: ["no"] },
        operations: { apply: { guidance: ["yes"] } }
      });
      expect(openspecSync(["init", "--tools", "none"], root).ok).toBe(true);

      const run = await runCli(["sync"], root, { WARRANT_PACKS_DIR: path.join(root, "packs") });
      expect(run.json?.errors).toEqual([]);

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
    },
    120_000
  );
});
