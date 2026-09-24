/**
 * `cs` wrapper over graft (ADR-0026 п. 2, ADR-0029 п. 1–2): `scripts/dev/cs-lib.js` admits per subcommand only its
 * flags and one positional (no directory argument, no graft global options), refuses the POSIX `a\|b`, rewrites paths
 * given from a subdirectory to repo-root-relative, scrubs `GRAFT_*` from the environment, runs the bin of the package
 * whose version it checked, builds the index under a lock, cleans and caps graft output, and reconciles graph callers
 * with a grep of the call sites in `cs impact`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CALLERS_MAX_LINES,
  callersOutput,
  capLines,
  cycleOf,
  depsCycles,
  depsFile,
  depsModules,
  depsTargetError,
  dupsData,
  formatDeps,
  formatDups,
  impactData,
  importGraph,
  importKinds,
  moduleOf,
  normalizeDir,
  parseImports,
  resolveSpec,
  tarjan,
  clean,
  ensureIndex,
  findGraftPackage,
  graftArgs,
  impactQuery,
  impactReport,
  parseArgv,
  scrubEnv,
  toRepoPath,
  withRepoPaths
} from "../../../../../scripts/dev/cs-lib.js";

const ok = (argv: string[]) => {
  const parsed = parseArgv(argv);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
};
const refused = (argv: string[]) => {
  const parsed = parseArgv(argv);
  if (!("error" in parsed)) throw new Error(`admitted: ${argv.join(" ")}`);
  return parsed.error;
};

describe("cs argv: a whitelist per subcommand", () => {
  it("admits the flags of each subcommand and builds the graft argv with the positional after --", () => {
    expect(graftArgs(ok(["ask", "where x", "--source", "-n", "3", "--in", "packages/cli"]))).toEqual([
      "ask", "--limit", "3", "--source", "--in", "packages/cli", "--", "where x"
    ]);
    expect(graftArgs(ok(["grep", "foo", "-i", "--fixed", "--in=scripts"]))).toEqual(["grep", "--ignore-case", "--fixed", "--in", "scripts", "--", "foo"]);
    expect(graftArgs(ok(["callers", "Type.run", "-d", "all", "--direction", "out"]))).toEqual(["callers", "--depth", "all", "--direction", "out", "--", "Type.run"]);
    expect(graftArgs(ok(["skeleton", "store.ts"]))).toEqual(["skeleton", "--", "store.ts"]);
    expect(graftArgs(ok(["map"]))).toEqual(["map"]);
    for (const sub of ["ask", "grep", "skeleton", "callers"]) expect(graftArgs(ok([sub, "x", "--json"]))).toEqual([sub, "--json", "--", "x"]);
    expect(graftArgs(ok(["map", "--json"]))).toEqual(["map", "--json"]);
    expect(ok(["impact", "x", "--json"]).opts).toEqual({ json: true });
    expect(ok(["impact", "CheckRunner.run", "--in", "packages"])).toEqual({ sub: "impact", arg: "CheckRunner.run", opts: { in: "packages" } });
    expect(ok(["version"])).toEqual({ sub: "version", arg: undefined, opts: {} });
  });

  it("refuses unknown subcommands, graft global options and flags of another subcommand", () => {
    expect(refused([])).toMatch(/unknown command \(none\)/);
    expect(refused(["--deep"])).toMatch(/unknown command "--deep"/);
    for (const sub of ["build", "init", "upgrade", "mcp", "brain", "blast"]) expect(refused([sub])).toMatch(/unknown command/);
    expect(refused(["ask", "q", "--api-key", "k"])).toMatch(/flag --api-key is not allowed/);
    expect(refused(["ask", "q", "--provider=x"])).toMatch(/flag --provider is not allowed/);
    expect(refused(["grep", "x", "-v"])).toMatch(/flag -v is not allowed/);
    expect(refused(["grep", "x", "--dir", "."])).toMatch(/flag --dir is not allowed/);
    expect(refused(["ask", "q", "--no-refresh"])).toMatch(/--no-refresh is not allowed/);
    expect(refused(["version", "--json"])).toMatch(/--json is not allowed/);
    expect(refused(["grep", "x", "--source"])).toMatch(/--source is not allowed/);
    expect(refused(["skeleton", "f.ts", "--in", "x"])).toMatch(/allowed: --json\)/);
    expect(refused(["map", "--max-dirs", "3"])).toMatch(/not allowed/);
  });

  it("checks flag values, repeats and values of switches", () => {
    expect(refused(["ask", "q", "-n", "0"])).toMatch(/-n expects a positive integer/);
    expect(refused(["callers", "x", "-d", "two"])).toMatch(/positive integer or all/);
    expect(refused(["callers", "x", "--direction", "up"])).toMatch(/in or out/);
    expect(refused(["grep", "x", "--in"])).toMatch(/needs a value/);
    expect(refused(["ask", "q", "--source", "--source"])).toMatch(/given twice/);
    expect(refused(["grep", "x", "--fixed=yes"])).toMatch(/takes no value/);
  });

  it("takes exactly one positional (no directory argument), none for map and version", () => {
    expect(refused(["ask", "foo", "somedir"])).toMatch(/exactly one <question> expected, got "foo" "somedir"/);
    expect(refused(["skeleton"])).toMatch(/exactly one <file> expected, got none/);
    expect(refused(["callers", "a", "b"])).toMatch(/exactly one/);
    expect(refused(["map", "."])).toMatch(/takes no arguments/);
    expect(refused(["version", "x"])).toMatch(/takes no arguments/);
    expect(refused(["grep", "  "])).toMatch(/empty/);
    expect(refused(["impact", "a b"])).toMatch(/name or Type\.name/);
  });

  it("-- ends the flags: a literal starting with - is a positional", () => {
    expect(ok(["grep", "--fixed", "--", "--deep"])).toEqual({ sub: "grep", arg: "--deep", opts: { fixed: true } });
    expect(graftArgs(ok(["grep", "--", "-v"]))).toEqual(["grep", "--", "-v"]);
    expect(refused(["grep", "--", "a", "--in", "x"])).toMatch(/exactly one/);
  });

  it("refuses a\\|b in a regex grep, admits it with --fixed", () => {
    expect(refused(["grep", "foo\\|bar"])).toBe("pattern is a JS regex: use a|b, not a\\|b; --fixed for literals");
    expect(ok(["grep", "foo\\|bar", "--fixed"]).arg).toBe("foo\\|bar");
    expect(ok(["grep", "foo|bar"]).arg).toBe("foo|bar");
  });
});

describe("cs paths: given from a subdirectory → repo-root-relative", () => {
  const root = path.resolve("/repo");
  const sub = path.join(root, "packages", "cli", "src");
  const has = (...present: string[]) => (abs: string) => present.map((p) => path.resolve(p)).includes(path.resolve(abs));

  it("rewrites a cwd-relative path that exists there, keeps others", () => {
    const where = { cwd: sub, root, exists: has(path.join(sub, "core", "evidence")) };
    expect(toRepoPath("core/evidence", where)).toBe("packages/cli/src/core/evidence");
    expect(toRepoPath("core\\evidence", where)).toBe("packages/cli/src/core/evidence");
    expect(toRepoPath("packages/cli/src/commands", where)).toBe("packages/cli/src/commands"); // not under cwd
    expect(toRepoPath("store.ts", where)).toBe("store.ts"); // a basename for skeleton
    expect(toRepoPath(".", { cwd: sub, root, exists: has(sub) })).toBe("packages/cli/src");
  });

  it("at the root keeps the path (forward slashes); an absolute path inside the repo becomes relative", () => {
    expect(toRepoPath("scripts\\dev", { cwd: root, root, exists: () => true })).toBe("scripts/dev");
    expect(toRepoPath(path.join(root, "scripts", "dev"), { cwd: sub, root, exists: () => false })).toBe("scripts/dev");
  });

  it("rewrites --in and the skeleton file, not the grep pattern", () => {
    const where = { cwd: sub, root, exists: has(path.join(sub, "core"), path.join(sub, "core", "x.ts")) };
    expect(withRepoPaths(ok(["grep", "core", "--in", "core"]), where)).toEqual({ sub: "grep", arg: "core", opts: { in: "packages/cli/src/core" } });
    expect(withRepoPaths(ok(["skeleton", "core/x.ts"]), where).arg).toBe("packages/cli/src/core/x.ts");
  });
});

describe("cs environment and graft package", () => {
  it("drops every GRAFT_* of the caller (any case) and sets the fixed ones", () => {
    const env = scrubEnv({ PATH: "/bin", GRAFT_API_KEY: "k", graft_provider: "x", Graft_Dir: "/d", DO_NOT_TRACK: "0", do_not_track: "0", GRAFTING: "keep", UNSET: undefined });
    expect(env).toEqual({ PATH: "/bin", GRAFTING: "keep", GRAFT_NO_GITIGNORE: "1", GRAFT_NO_IGNORE: "1", GRAFT_NO_STATUSLINE: "1", DO_NOT_TRACK: "1" });
  });

  it("finds the package on PATH and the bin it declares", () => {
    const a = path.resolve("/a");
    const b = path.resolve("/b/bin");
    const manifest = path.join(b, "../lib/node_modules", "@nanonets", "graft", "package.json");
    const found = findGraftPackage(["", a, b].join(";"), {
      delimiter: ";",
      exists: (p) => path.resolve(p) === path.resolve(manifest),
      readJson: () => ({ version: "0.19.0", bin: { graft: "dist/cli.js" } })
    });
    expect(found).toEqual({ dir: path.dirname(manifest), version: "0.19.0", bin: path.join(path.dirname(manifest), "dist/cli.js") });
    expect(findGraftPackage(a, { delimiter: ";", exists: () => false, readJson: () => ({}) })).toBeNull();
    expect(findGraftPackage(a, { delimiter: ";", exists: () => true, readJson: () => ({ version: "0.20.0" }) })?.bin).toBeNull();
  });
});

describe("cs output", () => {
  it("drops the tokens-saved lines and rewrites graft hints to what holds under cs", () => {
    const text = [
      "found 2",
      "[graft] tokens saved ≈ 939 (92%) — tell the user",
      "no matching nodes — try different words, or `graft build` if graft/ is empty",
      'find its uses with graft grep "run". Fall back to raw grep -rn only for unindexed files',
      "try `graft callers x`; graft ask, graft skeleton f, graft map",
      "no symbol \"x\" in the graph — check spelling or run `graft build`",
      "✗ no graph — run graft build first",
      "re-run `graft build --deep` to add concept nodes"
    ].join("\r\n");
    expect(clean(text).split("\n")).toEqual([
      "found 2",
      "no matching nodes — try different words, or index builds itself (cs)",
      'find its uses with cs grep "run". unindexed files (docs, JSON) — ordinary grep',
      "try `cs callers x`; cs ask, cs skeleton f, cs map",
      "no symbol \"x\" in the graph — check spelling or index builds itself (cs)",
      "✗ no graph — index builds itself (cs)",
      "re-run `graft build --deep` to add concept nodes"
    ]);
    expect(clean(undefined)).toBe("");
  });

  it("caps callers at 80 lines and says how many were dropped", () => {
    const long = `${Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n")}\n`;
    const out = callersOutput(long, "x").split("\n");
    expect(out).toHaveLength(CALLERS_MAX_LINES + 2);
    expect(out[CALLERS_MAX_LINES]).toBe("… +20 more lines — narrow with --in <path> or -d 1");
    expect(capLines("a\nb\n", 2, "h")).toBe("a\nb\n");
  });

  it("points callers without graph callers to cs impact", () => {
    expect(callersOutput("run · method\n  no indexed callers — …\n", "CheckRunner.run")).toMatch(/calls through port interfaces.*cs impact CheckRunner\.run\n$/);
    expect(callersOutput("x\n  calls ← y\n", "x")).toBe("x\n  calls ← y\n");
  });
});

describe("cs index build under a lock", () => {
  const dirs: string[] = [];
  const repo = () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "warrant-cs-"));
    dirs.push(dir);
    return dir;
  };
  const writeIndex = (root: string) => {
    mkdirSync(path.join(root, "graft", ".graph"), { recursive: true });
    writeFileSync(path.join(root, "graft", ".graph", "wiring.json"), "{}");
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("builds once under the lock and removes it; an existing index is not rebuilt", () => {
    const root = repo();
    let builds = 0;
    const build = () => {
      builds += 1;
      expect(existsSync(path.join(root, "graft", ".cs-build.lock"))).toBe(true);
      writeIndex(root);
      return { ok: true };
    };
    expect(ensureIndex(root, build)).toEqual({ state: "built" });
    expect(existsSync(path.join(root, "graft", ".cs-build.lock"))).toBe(false);
    expect(ensureIndex(root, build)).toEqual({ state: "present" });
    expect(builds).toBe(1);
  });

  it("waits while another holds the lock and proceeds when the index appears", () => {
    const root = repo();
    mkdirSync(path.join(root, "graft"));
    writeFileSync(path.join(root, "graft", ".cs-build.lock"), "other");
    let polls = 0;
    const result = ensureIndex(root, () => ({ ok: false, message: "must not build" }), {
      sleep: () => {
        polls += 1;
        if (polls === 3) writeIndex(root);
      }
    });
    expect(result).toEqual({ state: "waited" });
    expect(readFileSync(path.join(root, "graft", ".cs-build.lock"), "utf8")).toBe("other");
  });

  it("gives up after the timeout; removes a stale lock and builds", () => {
    const root = repo();
    mkdirSync(path.join(root, "graft"));
    const lock = path.join(root, "graft", ".cs-build.lock");
    writeFileSync(lock, "other");
    let clock = Date.now();
    expect(ensureIndex(root, () => ({ ok: true }), { now: () => clock, sleep: (ms) => (clock += ms), timeoutMs: 1000 })).toEqual({ state: "timeout" });
    const old = (Date.now() - 10 * 60_000) / 1000;
    utimesSync(lock, old, old);
    expect(ensureIndex(root, () => (writeIndex(root), { ok: true }))).toEqual({ state: "built" });
    expect(ensureIndex(repo(), () => ({ ok: false, message: "boom" }))).toEqual({ state: "failed", message: "boom" });
  });
});

describe("cs impact: graph callers reconciled with a grep of the call sites", () => {
  it("searches calls, imports and local bindings of a bare name; only .name( for Type.name", () => {
    const bare = impactQuery("readRecords");
    expect(bare.name).toBe("readRecords");
    const re = new RegExp(bare.pattern);
    for (const line of ["const r = readRecords(dir);", "readRecords<T>(x)", 'import { a, readRecords } from "./store.js";', "export { readRecords };", "  readRecords,", "const readRecords = 1;"]) {
      expect(re.test(line), line).toBe(true);
    }
    for (const line of ["readRecordsX(1)", 'export type K = "readRecords";', 'import x from "./readRecords.js";']) expect(re.test(line), line).toBe(false);
    const typed = impactQuery("CheckRunner.run");
    expect(typed).toMatchObject({ name: "run", typed: true });
    expect(new RegExp(typed.pattern).test("await ctx.checks.run({})")).toBe(true);
    expect(new RegExp(typed.pattern).test("run(spec)")).toBe(false);
  });

  const node = (id: string, kind: string, span: string) => {
    const [file, sym] = id.split("#") as [string, string | undefined];
    return { id, name: (sym ?? file).split(".").pop() as string, kind, path: file, span };
  };
  const nodes = [
    node("src/store.ts", "file", "L1-L90"),
    node("src/store.ts#readRecords", "function", "L75-L89"),
    node("src/gate.ts", "file", "L1-L300"),
    node("src/gate.ts#evaluate", "function", "L211-L257"),
    node("src/runner.ts#runCommand", "function", "L48-L110"),
    node("dev/metrics.js#readRecords", "function", "L62-L69"),
    node("dev/metrics.js#report", "function", "L150-L165"),
    node("test/gate.test.ts", "file", "L1-L40")
  ];
  const grepOf = (hits: [string, number, string][]) => ({
    groups: hits.map(([file, line, text]) => ({ path: file, hits: [{ line, text }] })),
    truncated: { files: 0, hits: 0 }
  });

  it("tags graph+grep, grep-only and graph-only sites, lists shared definitions, skips definitions and comments", () => {
    const report = impactReport({
      symbol: "readRecords",
      callers: {
        matches: [
          { symbol: nodes[1]!, hits: [] },
          { symbol: nodes[5]!, hits: [{ ...nodes[6]!, relation: "calls" }, { ...nodes[4]!, relation: "calls" }] }
        ]
      },
      grep: grepOf([
        ["src/store.ts", 75, "export function readRecords(dir: string): StoredRecord[] {"],
        ["src/gate.ts", 25, 'import { readRecords } from "./store.js";'],
        ["src/gate.ts", 230, "    const records = readRecords(evidenceDir(root));"],
        ["src/gate.ts", 231, "    // readRecords(dir) is sorted"],
        ["dev/metrics.js", 62, "function readRecords() {"],
        ["dev/metrics.js", 154, "const runs = readRecords().map((r) => r.record);"],
        ["test/gate.test.ts", 12, "expect(readRecords(dir)).toEqual([]);"]
      ]),
      nodes
    });
    expect(report.split("\n")).toEqual([
      "impact readRecords — 5 sites in 4 files (graph: 1, grep-only: 3, graph-only: 1)",
      '2 definitions share the name "readRecords" — which one each site refers to is not resolved:',
      "  src/store.ts:75  readRecords  function",
      "  dev/metrics.js:62  readRecords  function",
      "dev/metrics.js:154  report  [graph+grep]  const runs = readRecords().map((r) => r.record);",
      "src/gate.ts:25  (module)  [grep]  import { readRecords } from \"./store.js\";",
      "src/gate.ts:230  evaluate  [grep]  const records = readRecords(evidenceDir(root));",
      "src/runner.ts:48  runCommand  [graph]  (calls, span L48-L110) verify: graph-only edge (possible false edge by name)",
      "test/gate.test.ts:12  (module)  [grep]  expect(readRecords(dir)).toEqual([]);",
      ""
    ]);
  });

  it("marks sites in a scope that declares its own binding of the name", () => {
    const report = impactReport({
      symbol: "forward",
      callers: { matches: [{ symbol: node("src/t.ts#forward", "function", "L392-L459"), hits: [{ ...nodes[4]!, relation: "calls" }] }] },
      grep: grepOf([
        ["src/runner.ts", 51, "const forward = spec.forward ?? ((chunk) => write(chunk));"],
        ["src/runner.ts", 94, "else forward(chunk);"]
      ]),
      nodes
    });
    expect(report).toContain('verify: runCommand (src/runner.ts:51) declares its own "forward" — sites there tagged local? likely use it, not forward');
    expect(report).toContain("src/runner.ts:94  runCommand  [graph+grep local?]  else forward(chunk);");
    expect(report).toMatch(/^impact forward — 1 sites in 1 files \(graph: 1, grep-only: 0, graph-only: 0\)/);
  });

  it("tags calls through a port receiver, notes an empty graph and a graft truncation, caps the list", () => {
    const report = impactReport({
      symbol: "GitCli.head",
      callers: { matches: [{ symbol: node("src/git.ts#GitCli.head", "method", "L49-L51"), hits: [] }] },
      grep: { ...grepOf([["src/gate.ts", 230, "const h = await ctx.git.head();"], ["src/gate.ts", 240, "tree.head()"]]), truncated: { files: 0, hits: 7 } },
      nodes
    });
    expect(report).toContain("graph: no callers indexed");
    expect(report).toContain("grep truncated by graft: +7 hits not shown — narrow with --in <path>");
    expect(report).toContain("src/gate.ts:230  evaluate  [grep port]  const h = await ctx.git.head();");
    expect(report).toContain("src/gate.ts:240  evaluate  [grep]  tree.head()");

    const many = grepOf(Array.from({ length: 200 }, (_, i): [string, number, string] => ["src/gate.ts", 1000 + i, "run()"]));
    const capped = impactReport({ symbol: "run", callers: null, callersError: '✗ no symbol "run"', grep: many, nodes }).split("\n");
    expect(capped).toHaveLength(122);
    expect(capped[1]).toBe('graph: ✗ no symbol "run"');
    expect(capped[120]).toMatch(/^… \+\d+ more lines — narrow with --in <path>$/);
  });
});

describe("cs impact --json: the cs-impact/1 shape", () => {
  it("carries counts, definitions, graph state and sites with tags", () => {
    const data = impactData({
      symbol: "GitCli.head",
      callers: { matches: [{ symbol: { id: "g.ts#GitCli.head", name: "head", kind: "method", path: "g.ts", span: "L5-L7" }, hits: [] }] },
      grep: { groups: [{ path: "u.ts", hits: [{ line: 3, text: "  await ctx.git.head();" }] }] },
      nodes: [{ id: "g.ts#GitCli.head", name: "head", kind: "method", path: "g.ts", span: "L5-L7" }]
    });
    expect(data).toEqual({
      format: "cs-impact/1",
      symbol: "GitCli.head",
      name: "head",
      counts: { sites: 1, files: 1, graph: 0, grepOnly: 1, graphOnly: 0 },
      definitions: [{ path: "g.ts", line: 5, symbol: "GitCli.head", kind: "method" }],
      graph: { callers: 0 },
      shadows: [],
      grepTruncated: { files: 0, hits: 0 },
      sites: [{ path: "u.ts", line: 3, enclosing: "(module)", tags: ["grep", "port"], text: "await ctx.git.head();" }]
    });
  });
});

describe("cs deps / dups argv", () => {
  it("deps: zero or one path, --cycles without a path, --in only then, --runtime only with --cycles", () => {
    expect(ok(["deps", "src/a.ts"])).toEqual({ sub: "deps", arg: "src/a.ts", opts: {} });
    expect(ok(["deps", "src", "--level", "2", "--external", "--cycles", "--runtime", "--json"]).opts).toEqual({
      level: "2",
      external: true,
      cycles: true,
      runtime: true,
      json: true
    });
    expect(ok(["deps", "--cycles", "--in", "packages", "--runtime"])).toEqual({ sub: "deps", arg: undefined, opts: { cycles: true, in: "packages", runtime: true } });
    expect(refused(["deps"])).toMatch(/give a <file> or <dir>, or --cycles/);
    expect(refused(["deps", "a", "b"])).toMatch(/at most one <file\|dir> expected/);
    expect(refused(["deps", "--cycles", "--level", "2"])).toMatch(/need a <dir>/);
    expect(refused(["deps", "--cycles", "--external"])).toMatch(/need a <dir>/);
    expect(refused(["deps", "src", "--in", "x"])).toMatch(/--in goes with --cycles/);
    expect(refused(["deps", "src", "--runtime"])).toMatch(/--runtime applies to --cycles only/);
    expect(refused(["deps", "src", "--level", "0"])).toMatch(/positive integer/);
    expect(refused(["deps", "src", "-d", "1"])).toMatch(/not allowed/);
    expect(depsTargetError({ level: "2" }, "file")).toMatch(/need a <dir>/);
    expect(depsTargetError({ cycles: true }, "dir")).toBeNull();
  });

  it("dups: no positional, --min >= 2, --kind function|all, --in, --json", () => {
    expect(ok(["dups", "--min", "3", "--kind", "all", "--in", "packages", "--json"]).opts).toEqual({ min: "3", kind: "all", in: "packages", json: true });
    expect(refused(["dups", "x"])).toMatch(/takes no arguments/);
    expect(refused(["dups", "--min", "1"])).toMatch(/integer >= 2/);
    expect(refused(["dups", "--kind", "class"])).toMatch(/function or all/);
  });

  it("the deps path from a subdirectory is rewritten like --in", () => {
    const root = path.resolve("/repo");
    const sub = path.join(root, "packages", "cli");
    const where = { cwd: sub, root, exists: (abs: string) => path.resolve(abs) === path.join(sub, "src") };
    expect(withRepoPaths(ok(["deps", "src", "--level", "2"]), where).arg).toBe("packages/cli/src");
    expect(normalizeDir("./packages/cli/")).toBe("packages/cli");
    expect(normalizeDir(".")).toBe("");
  });
});

describe("cs deps: imports and their kind", () => {
  it("parses import/export-from, side-effect, dynamic and require; marks type-only statements", () => {
    const text = [
      `import { a } from "./a.js";`,
      `import type { B } from "./b.js";`,
      `import {\n  type C,\n  type D,\n} from "./c.js";`,
      `import { type E, e } from "./e.js";`,
      `export type { F } from "./f.js";`,
      `export * from "./g.js";`,
      `export type * from "./h.js";`,
      `import "./side.js";`,
      `const m = await import("./dyn.js");`,
      `const r = require("cross-spawn");`,
      `type T = typeof import("./t.js");`,
      `/** @type {import("./jsdoc.js").X} */`,
      `const s = 'import { z } from "./in-string.js"';`,
      `export const k = { from: 1 };`
    ].join("\n");
    expect(parseImports(text)).toEqual([
      { spec: "./a.js", type: false },
      { spec: "./b.js", type: true },
      { spec: "./c.js", type: true },
      { spec: "./e.js", type: false },
      { spec: "./f.js", type: true },
      { spec: "./g.js", type: false },
      { spec: "./h.js", type: true },
      { spec: "./side.js", type: false },
      { spec: "./dyn.js", type: false },
      { spec: "cross-spawn", type: false },
      { spec: "./t.js", type: true },
      { spec: "./jsdoc.js", type: true }
    ]);
  });

  it("resolves .js to .ts, directories to index, keeps external specifiers; a target is type only if every statement is", () => {
    const files = new Set(["src/b/x.ts", "src/lib/index.ts", "src/util.js"]);
    expect(resolveSpec("src/a.ts", "./b/x.js", files)).toBe("src/b/x.ts");
    expect(resolveSpec("src/b/x.ts", "../lib", files)).toBe("src/lib/index.ts");
    expect(resolveSpec("src/b/x.ts", "../util.js", files)).toBe("src/util.js");
    expect(resolveSpec("src/a.ts", "node:fs", files)).toBe("node:fs");
    expect(resolveSpec("src/a.ts", "./missing.js", files)).toBe("src/missing.js");
    const text = `import type { X } from "./b/x.js";\nimport { y } from "./b/x.js";\nimport type { L } from "./lib/index.js";`;
    expect(Object.fromEntries(importKinds("src/a.ts", text, files))).toEqual({ "src/b/x.ts": "runtime", "src/lib/index.ts": "type" });
  });
});

describe("cs deps: graph, modules, cycles", () => {
  const texts: Record<string, string> = {
    "src/a.ts": `import { x } from "./b/x.js";\nimport { readFileSync } from "node:fs";\n`,
    "src/b/x.ts": `import { y } from "./y.js";\nexport const x = y;\n`,
    "src/b/y.ts": `import type { Z } from "../c/z.js";\nexport const y = 1;\n`,
    "src/c/z.ts": `import { x } from "../b/x.js";\nexport type Z = typeof x;\n`,
    "test/t.test.ts": `import { a } from "../src/a.js";\n`
  };
  const file = (p: string) => ({ id: p, name: p.split("/").pop() as string, kind: "file", path: p, span: "L1-L2" });
  const imp = (source: string, target: string) => ({ source, target, relation: "imports" });
  const wiring = {
    nodes: [...Object.keys(texts).map(file), { id: "src/a.ts#run", name: "run", kind: "function", path: "src/a.ts", span: "L3-L4" }],
    edges: [
      imp("src/a.ts", "src/b/x.ts"),
      imp("src/a.ts", "node:fs"),
      imp("src/a.ts", "src/b/x.ts"), // duplicate
      imp("src/b/x.ts", "src/b/y.ts"),
      imp("src/b/y.ts", "src/c/z.ts"),
      imp("src/c/z.ts", "src/b/x.ts"),
      imp("test/t.test.ts", "src/a.ts"),
      { source: "src/a.ts", target: "src/a.ts#run", relation: "contains" }
    ]
  };
  const graph = importGraph(wiring);
  const kindOf = (from: string, to: string) => {
    const text = texts[from];
    return text === undefined ? "?" : (importKinds(from, text, graph.files).get(to) ?? "?");
  };

  it("keeps imports edges from indexed files, deduplicated, internal or external", () => {
    expect(graph.files.size).toBe(5);
    expect(graph.edges).toHaveLength(6);
    expect(graph.edges.filter((e) => !e.internal)).toEqual([{ from: "src/a.ts", to: "node:fs", internal: false }]);
  });

  it("deps <file>: imports, external modules and importers with their kind", () => {
    expect(depsFile("src/b/y.ts", graph, kindOf)).toEqual({
      format: "cs-deps/1",
      mode: "file",
      file: "src/b/y.ts",
      imports: [{ path: "src/c/z.ts", kind: "type" }],
      external: [],
      importedBy: [{ path: "src/b/x.ts", kind: "runtime" }]
    });
    expect(depsFile("src/a.ts", graph, kindOf).external).toEqual([{ module: "node:fs", kind: "runtime" }]);
    expect(formatDeps(depsFile("src/b/y.ts", graph, kindOf))).toContain("  src/c/z.ts  type-only");
  });

  it("module of a file: first N directories; a file directly in the dir is its own module", () => {
    expect(moduleOf("src/a.ts", "src", 1)).toBe("a.ts");
    expect(moduleOf("src/core/gates/l0/x.ts", "src", 2)).toBe("core/gates");
    expect(moduleOf("src/core/x.ts", "src", 2)).toBe("core");
    expect(moduleOf("src/core/x.ts", "", 1)).toBe("src");
  });

  it("deps <dir>: modules with Ca, Ce, instability, edges split runtime / type-only, module cycles", () => {
    const d = depsModules("src", 1, graph, kindOf, { cycles: true, external: true });
    expect(d.modules).toEqual([
      { id: "a.ts", files: 1, ca: 0, ce: 1, instability: 1, internal: 0, outside: 0, external: [{ module: "node:fs", count: 1 }] },
      { id: "b", files: 2, ca: 2, ce: 1, instability: 0.33, internal: 1, outside: 0, external: [] },
      { id: "c", files: 1, ca: 1, ce: 1, instability: 0.5, internal: 0, outside: 0, external: [] }
    ]);
    expect(d.edges).toEqual([
      { from: "a.ts", to: "b", imports: 1, runtime: 1, type: 0, unknown: 0 },
      { from: "b", to: "c", imports: 1, runtime: 0, type: 1, unknown: 0 },
      { from: "c", to: "b", imports: 1, runtime: 1, type: 0, unknown: 0 }
    ]);
    expect(d).toMatchObject({ format: "cs-deps/1", mode: "modules", dir: "src", level: 1, runtime: false, cycles: [{ size: 2, members: ["b", "c"], cycle: ["b", "c", "b"] }] });
    expect(depsModules("src", 1, graph, kindOf, { cycles: true, runtime: true })).toMatchObject({ runtime: true, cycles: [] });
    expect(depsModules("src", 1, graph, kindOf)).not.toHaveProperty("cycles");
    expect(depsModules("src", 1, graph, kindOf).modules[0]).not.toHaveProperty("external");
    const text = formatDeps(d);
    expect(text).toMatch(/^deps src --level 1 — 3 modules, 3 module edges \(3 file imports, 1 type-only\)/);
    expect(text).toContain("  b → c: 1, 1 type-only");
    expect(text).toContain("cycle 1 (2): b → c → b");
  });

  it("deps --cycles: file SCCs with one concrete cycle; --runtime drops type-only edges; --in narrows", () => {
    expect(depsCycles(graph, kindOf)).toEqual({
      format: "cs-deps/1",
      mode: "cycles",
      in: "",
      runtime: false,
      cycles: [{ size: 3, members: ["src/b/x.ts", "src/b/y.ts", "src/c/z.ts"], cycle: ["src/b/x.ts", "src/b/y.ts", "src/c/z.ts", "src/b/x.ts"] }]
    });
    expect(depsCycles(graph, kindOf, { runtime: true }).cycles).toEqual([]);
    expect(depsCycles(graph, kindOf, { in: "src/b" }).cycles).toEqual([]);
    expect(formatDeps(depsCycles(graph, kindOf))).toContain("cycle 1 (3): src/b/x.ts → src/b/y.ts → src/c/z.ts → src/b/x.ts");
  });

  it("tarjan finds components and self-loops; cycleOf returns the shortest way back", () => {
    const adj: Record<string, string[]> = { a: ["b"], b: ["c", "a"], c: ["a"], d: ["d"], e: ["a"] };
    const next = (n: string) => adj[n] ?? [];
    expect(tarjan(["a", "b", "c", "d", "e"], next)).toEqual([["a", "b", "c"], ["d"]]);
    expect(cycleOf(["a", "b", "c"], next)).toEqual(["a", "b", "a"]);
    expect(cycleOf(["d"], next)).toEqual(["d", "d"]);
  });
});

describe("cs dups: names defined in several files", () => {
  const n = (id: string, kind: string, span: string, exported: boolean) => {
    const [p, sym] = id.split("#") as [string, string];
    return { id, name: sym.split(".").pop() as string, kind, path: p, span, exported };
  };
  const nodes = [
    n("a.ts#readRecords", "function", "L5-L9", true),
    n("dev/m.js#readRecords", "function", "L62-L69", false),
    n("a.ts#isObj", "function", "L1-L2", false),
    n("b.ts#isObj", "function", "L1-L2", false),
    n("c.ts#isObj", "function", "L3-L4", false),
    n("git.ts#GitCli.head", "method", "L49-L51", false),
    n("fake.ts#FakeGit.head", "method", "L2-L3", false),
    n("x.ts#Options", "interface", "L1-L5", true),
    n("y.ts#Options", "interface", "L1-L5", true),
    n("a.ts#visit", "function", "L20-L22", false),
    { ...n("a.ts#visit~2", "function", "L30-L32", false), name: "visit" }
  ];

  it("groups by bare name across files, most files first, hazard when one is exported", () => {
    const d = dupsData(nodes);
    expect(d.format).toBe("cs-dups/1");
    expect(d.dups.map((x) => [x.name, x.files, x.hazard])).toEqual([
      ["isObj", 3, false],
      ["head", 2, false],
      ["readRecords", 2, true]
    ]);
    expect(d.dups[1]?.definitions).toEqual([
      { path: "fake.ts", line: 2, symbol: "FakeGit.head", kind: "method", exported: false },
      { path: "git.ts", line: 49, symbol: "GitCli.head", kind: "method", exported: false }
    ]);
    expect(dupsData(nodes, { kind: "all" }).dups.map((x) => x.name)).toContain("Options");
    expect(dupsData(nodes, { min: 3 }).dups.map((x) => x.name)).toEqual(["isObj"]);
    expect(dupsData(nodes, { in: "dev" }).dups).toEqual([]);
    const text = formatDups(d);
    expect(text).toMatch(/^dups — 3 names defined in ≥ 2 files \(kind function\)/);
    expect(text).toContain("readRecords  ×2 files  (hazard: cross-file callers dropped by graph)");
    expect(text).toContain("  a.ts:5  readRecords  function  exported");
  });
});
