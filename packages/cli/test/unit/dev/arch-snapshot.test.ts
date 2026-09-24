/**
 * Architecture snapshot (skill `architecture-audit`): `scripts/dev/arch-snapshot-lib.js` turns `cs --json` answers
 * into one snapshot — cohesion per module, slices by module with the entry's share, calls through ports attached to
 * the slice symbols that make them — and diffs two snapshots.
 */
import { describe, expect, it } from "vitest";

import { buildSlice, buildSnapshot, diffSnapshots, formatDiff, moduleOf, portCallsBySymbol, portPattern } from "../../../../../scripts/dev/arch-snapshot-lib.js";

const DIR = "packages/cli/src";
const sym = (file: string, name: string) => ({ id: `${DIR}/${file}#${name}`, name, kind: "function", path: `${DIR}/${file}`, span: "L1-L2" });

const DEPS = {
  modules: [
    { id: "commands", files: 2, ca: 0, ce: 1, instability: 1, internal: 1, outside: 0 },
    { id: "core/gates", files: 3, ca: 1, ce: 0, instability: 0, internal: 3, outside: 0 },
    { id: "version.ts", files: 1, ca: 0, ce: 0, instability: 0, internal: 0, outside: 0 }
  ],
  edges: [{ from: "commands", to: "core/gates", imports: 3, runtime: 2, type: 1, unknown: 0 }]
};
const CYCLES = { cycles: [{ size: 2, members: ["core/canon", "core/packs"] }, { size: 2, members: ["core", "core/ports"] }] };
const RUNTIME = { cycles: [{ size: 2, members: ["core/packs", "core/canon"] }] };
const DUPS = { dups: [{ name: "isPlainObject", files: 22, exported: false, hazard: false, definitions: [] }] };

const GREP = {
  groups: [
    { symbol: sym("core/gates/diff.ts", "readGitFacts"), path: `${DIR}/core/gates/diff.ts`, hits: [{ line: 5, text: "const h = await ctx.git.head(); await ctx.git.mergeBase(h);" }] },
    { symbol: sym("commands/verify.ts", "runVerify"), path: `${DIR}/commands/verify.ts`, hits: [{ line: 9, text: "ctx.clock.today()" }] },
    { symbol: sym("commands/other.ts", "unrelated"), path: `${DIR}/commands/other.ts`, hits: [{ line: 3, text: "ctx.openspec.status(c)" }] }
  ]
};

const CALLERS = {
  query: "runVerify",
  matches: [
    {
      symbol: sym("commands/verify.ts", "runVerify"),
      hits: [
        { ...sym("commands/gate.ts", "evaluateTransition"), relation: "calls", depth: 1 },
        { ...sym("core/gates/diff.ts", "readGitFacts"), relation: "calls", depth: 1 },
        { ...sym("core/gates/verdict.ts", "evaluateGates"), relation: "calls", depth: 2 },
        { ...sym("core/gates/verdict.ts", "evaluateGates"), relation: "references", depth: 3 },
        { id: "node_modules/x.ts#y", name: "y", kind: "function", path: "node_modules/x.ts", span: "L1", relation: "calls", depth: 2 }
      ]
    }
  ]
};

describe("moduleOf", () => {
  it("names a file by the first N directories under the dir, a top-level file by itself", () => {
    expect(moduleOf(`${DIR}/core/gates/l0/spec-approved.ts`, DIR, 2)).toBe("core/gates");
    expect(moduleOf(`${DIR}/core/errors.ts`, DIR, 2)).toBe("core");
    expect(moduleOf(`${DIR}/version.ts`, DIR, 2)).toBe("version.ts");
    expect(moduleOf("packages\\cli\\src\\commands\\gate.ts", DIR, 1)).toBe("commands");
  });
});

describe("port calls", () => {
  it("counts `<receiver>.<port>.<method>(` per enclosing symbol", () => {
    const calls = portCallsBySymbol(GREP);
    expect(Object.fromEntries(calls.get(`${DIR}/core/gates/diff.ts#readGitFacts`) ?? [])).toEqual({ "git.head": 1, "git.mergeBase": 1 });
    expect(new RegExp(portPattern(["git"])).test("ctx.git.head()")).toBe(true);
    expect(new RegExp(portPattern(["git"])).test("git.head()")).toBe(false);
  });
});

describe("buildSlice", () => {
  const slice = buildSlice(CALLERS, { dir: DIR, level: 2, portCalls: portCallsBySymbol(GREP) });

  it("counts each reached symbol of the dir once, by module, with the entry module's share", () => {
    expect(slice).toMatchObject({ entry: "runVerify", found: true, symbols: 3, module_count: 2, entry_module: "commands", entry_share: 0.33 });
    expect(slice.modules).toEqual({ "core/gates": 2, commands: 1 });
  });

  it("attaches port calls of the entry and of reached symbols only", () => {
    expect(slice.ports).toEqual({ "clock.today": 1, "git.head": 1, "git.mergeBase": 1 });
  });

  it("marks an entry the graph does not know", () => {
    expect(buildSlice({ query: "runNope", matches: [] }, { dir: DIR, level: 2 })).toEqual({ entry: "runNope", found: false });
  });
});

describe("buildSnapshot", () => {
  const snap = buildSnapshot({ commit: "abc", dir: DIR, level: 2, deps: DEPS, cycles: CYCLES, runtimeCycles: RUNTIME, dups: DUPS, slices: [] });

  it("adds cohesion = internal / (internal + outgoing imports); null for a module without edges", () => {
    const byId = Object.fromEntries(snap.modules.map((m: { id: string }) => [m.id, m]));
    expect(byId["commands"]).toMatchObject({ internal: 1, outgoing: 3, cohesion: 0.25 });
    expect(byId["core/gates"]).toMatchObject({ outgoing: 0, cohesion: 1 });
    expect(byId["version.ts"].cohesion).toBeNull();
  });

  it("marks which cycles survive without `import type`", () => {
    expect(snap.cycles).toEqual([
      { members: ["core/canon", "core/packs"], runtime: true },
      { members: ["core", "core/ports"], runtime: false }
    ]);
    expect(snap.totals).toMatchObject({ modules: 3, module_edges: 1, imports: 3, cycles: 2, runtime_cycles: 1, dups: 1 });
  });
});

describe("diffSnapshots", () => {
  const base = buildSnapshot({ commit: "a", dir: DIR, level: 2, deps: DEPS, cycles: CYCLES, runtimeCycles: RUNTIME, dups: DUPS, slices: [] });

  it("reports nothing for the same snapshot", () => {
    expect(diffSnapshots(base, base)).toEqual([]);
  });

  it("reports added, removed and moved items, ignoring noise below epsilon", () => {
    const next = buildSnapshot({
      commit: "b",
      dir: DIR,
      level: 2,
      deps: {
        modules: [
          { ...DEPS.modules[0], ce: 2, instability: 1.001 },
          DEPS.modules[1],
          { id: "core/fs", files: 1, ca: 1, ce: 0, instability: 0, internal: 0, outside: 0 }
        ],
        edges: DEPS.edges
      },
      cycles: { cycles: [CYCLES.cycles[1]] },
      runtimeCycles: { cycles: [] },
      dups: { dups: [] },
      slices: []
    });
    const changes = diffSnapshots(base, next);
    expect(changes).toEqual(
      expect.arrayContaining([
        { kind: "module", id: "commands", before: { ce: 1 }, after: { ce: 2 } },
        { kind: "module", id: "version.ts", before: expect.any(Object), after: null },
        { kind: "module", id: "core/fs", before: null, after: expect.any(Object) },
        { kind: "cycle", id: "core/canon ↔ core/packs", before: { runtime: true }, after: null },
        { kind: "dup", id: "isPlainObject", before: { files: 22 }, after: null }
      ])
    );
    expect(changes).toHaveLength(5);
    expect(formatDiff(changes, { from: "a", to: "b" })).toContain("~ module commands: ce=1 → ce=2");
  });
});
