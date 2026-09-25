/**
 * `WarrantConfig` against `config/1` (design core-seams §2, A-15): every
 * top-level property of the schema is either a field of `WarrantConfig` or
 * explicitly not read, and the example of 08 §3 builds the expected value.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { loadConfig, testFiles } from "../../../src/core/config.js";
import { readSchemaFile } from "../../../src/core/schemas/loader.js";
import { makeTempDir, removeDir } from "../../helpers/cli.js";

/** Property of `config/1` → field of `WarrantConfig`. */
const READ: Record<string, string> = {
  kernel: "kernel",
  openspec: "openspec",
  packs: "packs",
  defaults: "defaults",
  paths: "paths",
  roles: "roles"
};

/** Properties of `config/1` nobody reads yet: the first reader adds the field (design §2). */
const NOT_READ = ["$schema", "identities", "trusted_signers"];

/** Example of docs/08-packs.md §3. */
const EXAMPLE = {
  $schema: "warrant://config/1",
  kernel: "0.1",
  openspec: "1.13.x",
  packs: {
    "core-sdd": { version: "^0.1" },
    "bdd-tdd": { version: "^0.1", params: { mutation_threshold: 0.9 } },
    data: { version: "^0.3", params: { reconciliation: "row-count+checksum" } }
  },
  defaults: { check_timeout_s: 1800 },
  paths: { adr: "docs/adr", glossary: "docs/glossary.md", tests: "tests" },
  roles: { "data-owner": ["<login>"] }
};

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

function project(config: unknown, files: Record<string, string> = {}): string {
  const root = makeTempDir("warrant-config-");
  tempDirs.push(root);
  for (const [rel, text] of Object.entries({ ".warrant/warrant.json": JSON.stringify(config), ...files })) {
    const absolute = path.join(root, ...rel.split("/"));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  }
  return root;
}

describe("WarrantConfig ↔ config/1", () => {
  it("every top-level property of config/1 is read into a field or listed as not read", () => {
    const properties = readSchemaFile("config")["properties"] as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual([...Object.keys(READ), ...NOT_READ].sort());
  });

  it("the fields of a loaded config are exactly the ones read", () => {
    const config = loadConfig(project(EXAMPLE));
    expect(Object.keys(config).sort()).toEqual(Object.values(READ).sort());
  });

  // loadConfig validates the file against config/1 before it builds the value: the example is valid.
  it("builds the example of 08 §3 (SCN-KRN-008)", () => {
    expect(loadConfig(project(EXAMPLE))).toEqual({
      kernel: "0.1",
      openspec: "1.13.x",
      packs: [
        { id: "bdd-tdd", range: "^0.1" },
        { id: "core-sdd", range: "^0.1" },
        { id: "data", range: "^0.3" }
      ],
      defaults: { checkTimeoutS: 1800 },
      paths: { adr: "docs/adr", glossary: "docs/glossary.md", tests: "tests" },
      roles: new Map([["data-owner", ["<login>"]]])
    });
  });

  it("drops `$comment` and leaves absent sections empty", () => {
    const config = loadConfig(
      project({
        $schema: "warrant://config/1",
        kernel: "0.1",
        openspec: "1.13.x",
        packs: { $comment: "none yet" },
        roles: { $comment: "who is who", maintainer: ["kat"] }
      })
    );
    expect(config.packs).toEqual([]);
    expect(config.roles).toEqual(new Map([["maintainer", ["kat"]]]));
    expect(config.defaults).toEqual({ checkTimeoutS: undefined });
    expect(config.paths).toEqual({});
  });
});

describe("testFiles", () => {
  const base = { $schema: "warrant://config/1", kernel: "0.1", openspec: "1.13.x", packs: {} };

  it("walks a directory, takes a file, and is empty when paths.tests is unset or absent", () => {
    const files = { "tests/a.test.ts": "", "tests/sub/b.test.ts": "", "spec.test.ts": "" };
    const dir = project({ ...base, paths: { tests: "tests" } }, files);
    expect(testFiles(dir, loadConfig(dir)).map((f) => path.relative(dir, f).split(path.sep).join("/")).sort()).toEqual([
      "tests/a.test.ts",
      "tests/sub/b.test.ts"
    ]);
    const file = project({ ...base, paths: { tests: "spec.test.ts" } }, files);
    expect(testFiles(file, loadConfig(file))).toEqual([path.join(file, "spec.test.ts")]);
    const unset = project(base, files);
    expect(testFiles(unset, loadConfig(unset))).toEqual([]);
    const absent = project({ ...base, paths: { tests: "missing" } }, files);
    expect(testFiles(absent, loadConfig(absent))).toEqual([]);
  });
});
