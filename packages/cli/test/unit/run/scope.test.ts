/**
 * `core/run`: `write_scope` by operation (F1), the narrowing by `scope` and
 * `rules[]` of the Context Pack over the final scope (ADR-0022 п. 6,
 * SCN-ENF-007), `items[]` and `context_hash` (F17).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import type { WarrantConfig } from "../../../src/core/config.js";
import { WarrantError } from "../../../src/core/errors.js";
import type { LoadedRule } from "../../../src/core/packs/types.js";
import { changeItems, contextPack, rulesInScope } from "../../../src/core/run/context-pack.js";
import { globBase, scopeMatcher, writeScopeOf } from "../../../src/core/run/scope.js";
import { makeTempDir, removeDir } from "../../helpers/cli.js";

const dirs: string[] = [];
afterAll(() => dirs.forEach(removeDir));

function config(paths: WarrantConfig["paths"] = {}): WarrantConfig {
  return { kernel: "0.5", openspec: "1.13.x", packs: [], defaults: { checkTimeoutS: undefined }, paths, roles: new Map(), frontends: [] };
}

function rule(id: string, paths: string[]): LoadedRule {
  return { id, pack: "local", path: `.warrant/local/rules/${id}.json`, paths, text: `Rule ${id}.`, enforcedBy: undefined };
}

/** A project with `files` (POSIX paths → content). */
function project(files: Record<string, string>): string {
  const root = makeTempDir("warrant-unit-run-");
  dirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const absolute = path.join(root, ...rel.split("/"));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, text, "utf8");
  }
  return root;
}

describe("writeScopeOf (F1)", () => {
  it("specify: the directory of the Change", () => {
    expect(writeScopeOf("specify", "add-search", config())).toEqual(["openspec/changes/add-search/**"]);
  });

  it("review: empty, a review only reads — paths or not (REQ-ENF-002)", () => {
    expect(writeScopeOf("review", "add-search", config({ src: "src", tests: "tests" }))).toEqual([]);
    expect(writeScopeOf("review", "add-search", config())).toEqual([]);
  });

  it("implement: paths.src, paths.tests and tasks.md of the Change; `./` and trailing slashes dropped", () => {
    expect(writeScopeOf("implement", "add-search", config({ src: "./src/", tests: "tests" }))).toEqual([
      "src/**",
      "tests/**",
      "openspec/changes/add-search/tasks.md"
    ]);
    expect(writeScopeOf("implement", "add-search", config({ src: "src" }))).toEqual(["src/**", "openspec/changes/add-search/tasks.md"]);
  });

  it("implement without paths.src and paths.tests: CONFIG_INVALID with a hint", () => {
    let thrown: unknown;
    try {
      writeScopeOf("implement", "add-search", config({ adr: "docs/adr" }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WarrantError);
    expect((thrown as WarrantError).code).toBe("CONFIG_INVALID");
    expect((thrown as WarrantError).hint).toMatch(/paths/);
  });
});

describe("scopeMatcher: --scope only narrows (F1)", () => {
  const writeScope = ["src/**", "tests/**", "openspec/changes/add-search/tasks.md"];

  it("empty scope: write_scope alone", () => {
    const inside = scopeMatcher(writeScope, []);
    expect(inside("src/search/a.py")).toBe(true);
    expect(inside("openspec/changes/add-search/tasks.md")).toBe(true);
    expect(inside("docs/readme.md")).toBe(false);
  });

  it("a path must match both write_scope and scope; scope does not widen", () => {
    const inside = scopeMatcher(writeScope, ["src/search/**", "docs/**"]);
    expect(inside("src/search/a.py")).toBe(true);
    expect(inside("src/other/a.py")).toBe(false);
    expect(inside("docs/readme.md")).toBe(false);
    expect(inside("openspec/changes/add-search/tasks.md")).toBe(false);
  });

  it("dot files match (dot: true)", () => {
    expect(scopeMatcher(["src/**"], [])("src/.env.example")).toBe(true);
  });
});

describe("globBase", () => {
  it("segments up to the first glob character", () => {
    expect(globBase("src/**")).toBe("src");
    expect(globBase("openspec/changes/x/tasks.md")).toBe("openspec/changes/x/tasks.md");
    expect(globBase("src/*.py")).toBe("src");
    expect(globBase("**")).toBe("");
  });
});

describe("rules[] of the Context Pack (ADR-0022 п. 6)", () => {
  const rules = [rule("docs-style", ["docs/**"]), rule("search-api", ["src/search/**"]), rule("tests-naming", ["tests/**/*.py"])];

  it("a rule with a file inside the narrowed scope is in, one outside it is not (SCN-ENF-007)", () => {
    const root = project({ "src/search/api.py": "x", "src/other/b.py": "y", "docs/readme.md": "d", "tests/test_a.py": "t" });
    const writeScope = writeScopeOf("implement", "add-search", config({ src: "src", tests: "tests" }));
    expect(rulesInScope({ root, rules, writeScope, scope: ["src/search/**"] }).map((r) => r.id)).toEqual(["search-api"]);
    expect(rulesInScope({ root, rules, writeScope, scope: [] }).map((r) => r.id)).toEqual(["search-api", "tests-naming"]);
  });

  it("a rule whose paths match no existing file inside the scope is not in", () => {
    const root = project({ "src/other/b.py": "y" });
    expect(rulesInScope({ root, rules, writeScope: ["src/**"], scope: [] })).toEqual([]);
  });

  it("the entry of a rule: id, paths, text and enforced_by when set", () => {
    const root = project({ "src/search/api.py": "x" });
    const enforced: LoadedRule = { ...rule("search-api", ["src/search/**"]), enforcedBy: "validate" };
    expect(rulesInScope({ root, rules: [enforced], writeScope: ["src/**"], scope: [] })).toEqual([
      { id: "search-api", paths: ["src/search/**"], text: "Rule search-api.", enforced_by: "validate" }
    ]);
  });
});

describe("items[] and context_hash (F17)", () => {
  const change = "openspec/changes/add-search";

  it("proposal, delta specs, design, tasks — those that exist, in that order, with the hash of their bytes", () => {
    const root = project({
      [`${change}/tasks.md`]: "t",
      [`${change}/proposal.md`]: "p",
      [`${change}/specs/search/spec.md`]: "s",
      [`${change}/notes.txt`]: "n"
    });
    const items = changeItems(root, "add-search");
    expect(items.map((i) => i.path)).toEqual([`${change}/proposal.md`, `${change}/specs/search/spec.md`, `${change}/tasks.md`]);
    expect(items[0]?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("context_hash changes with an item and with a rule, and only with them", () => {
    const root = project({ [`${change}/proposal.md`]: "p", "src/search/api.py": "x" });
    const input = { root, change: "add-search", rules: [rule("search-api", ["src/search/**"])], writeScope: ["src/**"], scope: [] };
    const before = contextPack(input).context_hash;
    expect(contextPack(input).context_hash).toBe(before);
    writeFileSync(path.join(root, "src", "search", "api.py"), "changed", "utf8");
    expect(contextPack(input).context_hash).toBe(before);
    expect(contextPack({ ...input, rules: [] }).context_hash).not.toBe(before);
    writeFileSync(path.join(root, ...change.split("/"), "proposal.md"), "p2", "utf8");
    expect(contextPack(input).context_hash).not.toBe(before);
  });
});
