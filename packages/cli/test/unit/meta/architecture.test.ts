/**
 * Module boundaries of the CLI (ADR-0030 п. 1, 2, 4, 5, 6; design §1, §2):
 * every file of `src` belongs to one module of `architecture.json`, a `core`
 * module imports only modules of its own or a lower rank and an outer layer
 * only what its layer lists, modules form no cycle, a command imports no other
 * command but `commands/context.ts`, a registered helper is declared only by
 * its owner, and two or more values of a registered enum stand in an array
 * literal only in the owner file. Known violations are exceptions naming a
 * row A-N of the debt registry (docs/backlog.md, ADR-0032 п. 5); an exception that
 * covers nothing fails too (the ratchet only tightens).
 *
 * Imports come from `ts.preProcessFile` (multi-line imports, `import type`,
 * `export … from`, `import()`), not from the Graft graph: CI has none.
 * Level `unit`: reads files, starts no process.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../../helpers/cli.js";

type Rule = "module" | "rank" | "cycle" | "sibling" | "helper" | "enum";
const RULES: readonly Rule[] = ["module", "rank", "cycle", "sibling", "helper", "enum"];

interface Module {
  id: string;
  path: string;
  direct?: boolean;
  rank?: number;
  layer?: string;
}

interface Exception {
  id: string;
  rule: Rule;
  from?: string;
  to?: string;
  modules?: string[];
  helper?: string;
  enum?: string;
}

interface Architecture {
  root: string;
  modules: Module[];
  layers: Record<string, string[]>;
  no_sibling_imports: Record<string, string[]>;
  helpers: { name: string; owner: string }[];
  enums: { id: string; owner: string; doc: string; values: string[] }[];
  exceptions: Exception[];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCH = JSON.parse(readFileSync(path.join(HERE, "architecture.json"), "utf8")) as Architecture;

/** A violation: its identity (compared with exceptions) and its message line. */
interface Violation {
  key: string;
  text: string;
}

const posix = (p: string): string => p.split(path.sep).join("/");

// ---------------------------------------------------------------------------
// Sources and imports

interface Source {
  file: string;
  text: string;
}

/** Every `*.ts` under `dir`, as a POSIX path relative to `base`. */
function tsFiles(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full, base));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(posix(path.relative(base, full)));
  }
  return out.sort();
}

function readSources(arch: Architecture): Source[] {
  const root = path.join(REPO_ROOT, ...arch.root.split("/"));
  return tsFiles(root, root).map((file) => ({ file, text: readFileSync(path.join(root, ...file.split("/")), "utf8") }));
}

interface Edge {
  from: string;
  to: string;
}

/**
 * The file a relative specifier names: `.js` → `.ts`, or `<spec>.ts`, or
 * `<spec>/index.ts`; null for a package or a file outside the source set.
 */
function resolveImport(from: string, spec: string, files: ReadonlySet<string>): string | null | undefined {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  const candidates = /\.[cm]?js$/.test(base)
    ? [base.replace(/\.([cm]?)js$/, ".$1ts")]
    : [base, `${base}.ts`, `${base}/index.ts`];
  return candidates.find((c) => files.has(c));
}

/** Import edges between files; `unresolved` — relative specifiers naming no source file. */
function importEdges(sources: readonly Source[]): { edges: Edge[]; unresolved: string[] } {
  const files = new Set(sources.map((s) => s.file));
  const edges = new Map<string, Edge>();
  const unresolved: string[] = [];
  for (const { file, text } of sources) {
    for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
      const to = resolveImport(file, fileName, files);
      if (to === null) continue;
      if (to === undefined) {
        if (!fileName.endsWith(".json")) unresolved.push(`${file} → ${fileName}`);
        continue;
      }
      if (to !== file) edges.set(`${file} ${to}`, { from: file, to });
    }
  }
  return { edges: [...edges.values()], unresolved };
}

/** The module of a file: the longest matching `path`; `direct` matches only files right in the directory. */
function moduleOf(file: string, modules: readonly Module[]): Module | undefined {
  let best: Module | undefined;
  for (const m of modules) {
    const hit = m.direct
      ? path.posix.dirname(file) === m.path
      : file === m.path || file.startsWith(`${m.path}/`);
    if (hit && (best === undefined || m.path.length > best.path.length)) best = m;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Rules

function moduleViolations(arch: Architecture, sources: readonly Source[]): Violation[] {
  return sources
    .filter((s) => moduleOf(s.file, arch.modules) === undefined)
    .map((s) => ({ key: s.file, text: `${s.file} (module: no module in architecture.json)` }));
}

function rankViolations(arch: Architecture, edges: readonly Edge[]): Violation[] {
  const out: Violation[] = [];
  for (const { from, to } of edges) {
    const a = moduleOf(from, arch.modules);
    const b = moduleOf(to, arch.modules);
    if (a === undefined || b === undefined || a.id === b.id) continue;
    let allowed: boolean;
    if (a.rank !== undefined) {
      allowed = b.rank !== undefined && b.rank <= a.rank;
    } else {
      const list = arch.layers[a.layer ?? ""] ?? [];
      allowed = list.includes(b.id) || (list.includes("rank:*") && b.rank !== undefined);
    }
    if (!allowed) out.push({ key: `${from} → ${to}`, text: `${from} → ${to} (rank: ${a.id} → ${b.id})` });
  }
  return out;
}

/** Strongly connected sets of ≥ 2 modules (Tarjan), each as its sorted module ids. */
function moduleCycles(arch: Architecture, edges: readonly Edge[]): string[][] {
  const graph = new Map<string, Set<string>>();
  for (const { from, to } of edges) {
    const a = moduleOf(from, arch.modules)?.id;
    const b = moduleOf(to, arch.modules)?.id;
    if (a === undefined || b === undefined || a === b) continue;
    if (!graph.has(a)) graph.set(a, new Set());
    graph.get(a)?.add(b);
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  let counter = 0;
  const visit = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0));
      }
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) out.push(scc.sort());
    }
  };
  for (const v of [...graph.keys()].sort()) if (!index.has(v)) visit(v);
  return out;
}

const cycleKey = (modules: readonly string[]): string => [...modules].sort().join(" ↔ ");

function cycleViolations(arch: Architecture, edges: readonly Edge[]): Violation[] {
  return moduleCycles(arch, edges).map((scc) => ({ key: cycleKey(scc), text: `${cycleKey(scc)} (cycle)` }));
}

function siblingViolations(arch: Architecture, edges: readonly Edge[]): Violation[] {
  const out: Violation[] = [];
  for (const { from, to } of edges) {
    const a = moduleOf(from, arch.modules)?.id;
    if (a === undefined || moduleOf(to, arch.modules)?.id !== a) continue;
    const allowed = arch.no_sibling_imports[a];
    if (allowed === undefined || allowed.includes(to)) continue;
    out.push({ key: `${from} → ${to}`, text: `${from} → ${to} (sibling: ${a})` });
  }
  return out;
}

const parse = (s: Source): ts.SourceFile => ts.createSourceFile(s.file, s.text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

/** Names of top-level `function f` and `const f = (…) => …` / `function (…)` of a file. */
function topLevelFunctions(sf: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) names.push(statement.name.text);
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        const init = d.initializer;
        if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) names.push(d.name.text);
      }
    }
  }
  return names;
}

function helperViolations(arch: Architecture, sources: readonly Source[]): Violation[] {
  const owners = new Map(arch.helpers.map((h) => [h.name, h.owner]));
  const out: Violation[] = [];
  for (const s of sources) {
    for (const name of new Set(topLevelFunctions(parse(s)))) {
      const owner = owners.get(name);
      if (owner !== undefined && owner !== s.file) {
        out.push({ key: `${s.file} :: ${name}`, text: `${s.file} :: ${name} (helper: owner ${owner})` });
      }
    }
  }
  return out;
}

/** String elements of every array literal of a file (`new Set([...])` included). */
function arrayLiterals(sf: ts.SourceFile): string[][] {
  const out: string[][] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isArrayLiteralExpression(node)) {
      out.push(node.elements.filter(ts.isStringLiteralLike).map((e) => e.text));
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return out;
}

function enumViolations(arch: Architecture, sources: readonly Source[]): Violation[] {
  const out: Violation[] = [];
  for (const s of sources) {
    const literals = arrayLiterals(parse(s));
    for (const e of arch.enums) {
      if (e.owner === s.file) continue;
      const values = new Set(e.values);
      if (literals.some((items) => new Set(items.filter((v) => values.has(v))).size >= 2)) {
        out.push({ key: `${s.file} :: ${e.id}`, text: `${s.file} :: ${e.id} (enum: owner ${e.owner})` });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ratchet

function exceptionKey(x: Exception): string {
  switch (x.rule) {
    case "module":
      return x.from ?? "";
    case "rank":
    case "sibling":
      return `${x.from ?? ""} → ${x.to ?? ""}`;
    case "cycle":
      return cycleKey(x.modules ?? []);
    case "helper":
      return `${x.from ?? ""} :: ${x.helper ?? ""}`;
    case "enum":
      return `${x.from ?? ""} :: ${x.enum ?? ""}`;
  }
}

/** Violations no exception covers, then exceptions that cover nothing. */
function ratchet(arch: Architecture, rule: Rule, violations: readonly Violation[]): string[] {
  const exceptions = arch.exceptions.filter((x) => x.rule === rule);
  const covered = new Set(exceptions.map(exceptionKey));
  const found = new Set(violations.map((v) => v.key));
  return [
    ...violations.filter((v) => !covered.has(v.key)).map((v) => v.text),
    ...exceptions.filter((x) => !found.has(exceptionKey(x))).map((x) => `stale exception ${x.id}: ${exceptionKey(x)} (${rule})`)
  ];
}

/** All rules over one architecture and one source set: rule → failure lines. */
function check(arch: Architecture, sources: readonly Source[]): Record<Rule, string[]> & { unresolved: string[] } {
  const { edges, unresolved } = importEdges(sources);
  return {
    unresolved,
    module: ratchet(arch, "module", moduleViolations(arch, sources)),
    rank: ratchet(arch, "rank", rankViolations(arch, edges)),
    cycle: ratchet(arch, "cycle", cycleViolations(arch, edges)),
    sibling: ratchet(arch, "sibling", siblingViolations(arch, edges)),
    helper: ratchet(arch, "helper", helperViolations(arch, sources)),
    enum: ratchet(arch, "enum", enumViolations(arch, sources))
  };
}

// ---------------------------------------------------------------------------

const SOURCES = readSources(ARCH);
const RESULT = check(ARCH, SOURCES);
const DEBT = readFileSync(path.join(REPO_ROOT, "docs", "backlog.md"), "utf8");

describe("architecture.json is well-formed (ADR-0030 п. 5, 6)", () => {
  it("modules: unique ids, a rank or a layer, every layer listed; references name known modules", () => {
    const problems: string[] = [];
    const ids = new Set<string>();
    for (const m of ARCH.modules) {
      if (ids.has(m.id)) problems.push(`duplicate module ${m.id}`);
      ids.add(m.id);
      if ((m.rank === undefined) === (m.layer === undefined)) problems.push(`${m.id}: exactly one of rank / layer`);
      if (m.layer !== undefined && ARCH.layers[m.layer] === undefined) problems.push(`${m.id}: layer ${m.layer} not in layers`);
    }
    for (const [layer, allowed] of Object.entries(ARCH.layers)) {
      for (const target of allowed) if (target !== "rank:*" && !ids.has(target)) problems.push(`layers.${layer}: unknown module ${target}`);
    }
    for (const module of Object.keys(ARCH.no_sibling_imports)) if (!ids.has(module)) problems.push(`no_sibling_imports: unknown module ${module}`);
    for (const owner of [...ARCH.helpers.map((h) => h.owner), ...ARCH.enums.map((e) => e.owner)]) {
      if (moduleOf(owner, ARCH.modules) === undefined) problems.push(`owner ${owner} lies in no module`);
    }
    expect(problems).toEqual([]);
  });

  it("exceptions: a known rule, the fields of the rule, no duplicates, an A-N row of docs/backlog.md", () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const x of ARCH.exceptions) {
      if (!RULES.includes(x.rule)) {
        problems.push(`${x.id}: unknown rule ${String(x.rule)}`);
        continue;
      }
      const needed: Record<Rule, (keyof Exception)[]> = {
        module: ["from"],
        rank: ["from", "to"],
        cycle: ["modules"],
        sibling: ["from", "to"],
        helper: ["from", "helper"],
        enum: ["from", "enum"]
      };
      for (const field of needed[x.rule]) if (x[field] === undefined) problems.push(`${x.id} (${x.rule}): no ${field}`);
      const key = `${x.rule} ${exceptionKey(x)}`;
      if (seen.has(key)) problems.push(`duplicate exception ${key}`);
      seen.add(key);
      if (!/^A-\d+$/.test(x.id) || !new RegExp(`^\\| ${x.id} \\|`, "m").test(DEBT)) {
        problems.push(`${x.id}: not a row of docs/backlog.md`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("every enum value is written in its dictionary document (02 / 04 / 05)", () => {
    const missing: string[] = [];
    for (const e of ARCH.enums) {
      const doc = readFileSync(path.join(REPO_ROOT, ...e.doc.split("/")), "utf8");
      for (const value of e.values) {
        const transition = /^([A-Z_]+)->([A-Z_]+)$/.exec(value);
        const written = transition ? `${transition[1] ?? ""} → ${transition[2] ?? ""}` : `\`${value}\``;
        if (!doc.includes(written)) missing.push(`${e.id}: ${written} not in ${e.doc}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("module boundaries (ADR-0030 п. 1, 2, 4; ratchet п. 6)", () => {
  it("the source set and its imports are read", () => {
    expect(SOURCES.length).toBeGreaterThan(0);
    expect(importEdges(SOURCES).edges.length).toBeGreaterThan(0);
    expect(RESULT.unresolved, "relative imports naming no source file").toEqual([]);
  });

  it("module: every file of src belongs to a module", () => {
    expect(RESULT.module).toEqual([]);
  });

  it("rank: a core module imports only its own or a lower rank; a layer only what it lists", () => {
    expect(RESULT.rank).toEqual([]);
  });

  it("cycle: modules form no cycle", () => {
    expect(RESULT.cycle).toEqual([]);
  });

  it("sibling: a command imports no other command but commands/context.ts", () => {
    expect(RESULT.sibling).toEqual([]);
  });

  it("helper: a registered helper is declared only by its owner", () => {
    expect(RESULT.helper).toEqual([]);
  });

  it("enum: two or more values of a registered enum stand in an array literal only in the owner", () => {
    expect(RESULT.enum).toEqual([]);
  });
});
