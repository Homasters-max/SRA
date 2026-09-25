/**
 * Architecture snapshot (skill `architecture-audit`): one JSON per audit, built from `cs deps` / `cs dups` /
 * `cs callers` / `cs grep` answers (`--json`), and the diff of two snapshots — the trend between audits.
 * For `scripts/dev/arch-snapshot.js` and `packages/cli/test/unit/dev/arch-snapshot.test.ts`.
 *
 * What the snapshot adds to `cs`: module cohesion (internal / (internal + outgoing imports)); vertical slices of
 * entry points aggregated by module, with the share of the entry's own module; calls through ports (`ctx.git.head()`),
 * which the graph does not see (ADR-0029), attached to the slice symbols that make them; calls of a name shared with
 * another file (a test helper), which the graph drops, restored from `cs grep` (`completeCallers`).
 *
 * Plain Node ESM, no dependencies. Dev tooling only — not in `files` of package.json.
 */
import path from "node:path";

export const SNAPSHOT_FORMAT = "arch-snapshot/1";
export const DEFAULT_PORTS = ["git", "openspec", "checks", "clock"];
/** Changes smaller than this are noise in a diff (instability, cohesion). */
export const EPSILON = 0.005;

const round = (n) => Math.round(n * 100) / 100;

/** Module id of a file as `cs deps <dir> --level N` names it: the first N directories under `dir`, or the file itself. */
export function moduleOf(file, dir, level) {
  const rel = path.posix.relative(dir.replace(/\\/g, "/"), file.replace(/\\/g, "/"));
  const parts = rel.split("/");
  const base = parts.pop();
  return parts.length === 0 ? base : parts.slice(0, level).join("/");
}

/** `cs grep` pattern for calls through the ports of `Ctx`: `<receiver>.<port>.<method>(`. */
export function portPattern(ports = DEFAULT_PORTS) {
  return `\\.(${ports.join("|")})\\.[A-Za-z_$][\\w$]*\\(`;
}

/** Port calls per enclosing symbol id from a `cs grep --json` answer: Map<symbolId, Map<"port.method", count>>. */
export function portCallsBySymbol(grep, ports = DEFAULT_PORTS) {
  const re = new RegExp(`\\.(${ports.join("|")})\\.([A-Za-z_$][\\w$]*)\\(`, "g");
  const out = new Map();
  for (const group of grep.groups ?? []) {
    const id = group.symbol?.id ?? `${group.path}#(file)`;
    for (const hit of group.hits ?? []) {
      for (const m of hit.text.matchAll(re)) {
        if (!out.has(id)) out.set(id, new Map());
        const key = `${m[1]}.${m[2]}`;
        out.get(id).set(key, (out.get(id).get(key) ?? 0) + 1);
      }
    }
  }
  return out;
}

/**
 * Names whose calls the graph drops (audit 2026-09-25 §3.3): a function defined in more than one file of the index
 * (`cs dups --min 2 --json`, all of it) but exactly once in `dir` — a call from another file of `dir` means that one
 * definition, yet Graft discards a cross-file call of a shared name even through an explicit named import.
 * Map<name, path of the definition in `dir`>.
 */
export function blindNames(dups, dir) {
  const prefix = `${dir.replace(/\\/g, "/")}/`;
  const out = new Map();
  for (const d of dups.dups ?? []) {
    const inDir = (d.definitions ?? []).filter((x) => x.path.startsWith(prefix));
    if (inDir.length === 1 && inDir[0].kind === "function" && inDir[0].symbol === d.name) out.set(d.name, inDir[0].path);
  }
  return out;
}

/** `cs grep` pattern for bare calls `name(` of `names` — not `x.name(` (a method or a port call). */
export function bareCallPattern(names) {
  return `(^|[^\\w$.])(${names.join("|")})\\(`;
}

/**
 * Bare calls of `names` per enclosing symbol id from a `cs grep --json` answer: Map<symbolId, { path, names }>. A
 * definition line (`function name(`) is not a call.
 */
export function bareCallsBySymbol(grep, names) {
  const re = new RegExp(`(?:^|[^\\w$.])(?<!function\\s+)(${names.join("|")})\\(`, "g");
  const out = new Map();
  for (const group of grep.groups ?? []) {
    const id = group.symbol?.id;
    if (id === undefined) continue;
    for (const hit of group.hits ?? []) {
      for (const m of hit.text.matchAll(re)) {
        if (!out.has(id)) out.set(id, { path: group.symbol.path ?? group.path, names: new Set() });
        out.get(id).names.add(m[1]);
      }
    }
  }
  return out;
}

/**
 * A `cs callers <entry> --direction out -d all --json` answer completed with what the graph dropped: a bare call of a
 * blind name by the entry or a reached symbol counts when the caller's file is the definition's file or imports it
 * (`importsOf(path)` — imported paths, `cs deps <file>`; a local `resolve` of `new Promise` is not a call of
 * `core/resolve`); then the definition and its own out-slice (`sliceOf(name)` — the same `cs callers` answer, or null)
 * join the answer, until nothing new is reached.
 * Returns `{ callers, recovered }` — the answer with the added hits and the sorted names that added them.
 */
export function completeCallers(callers, bareCalls, { defOf, importsOf, sliceOf }) {
  const [match, ...rest] = callers.matches ?? [];
  if (match === undefined) return { callers, recovered: [] };
  const hits = [...(match.hits ?? [])];
  const ids = new Set([match.symbol.id, ...hits.map((h) => h.id)]);
  const queue = [...ids];
  const done = new Set();
  const recovered = new Set();
  while (queue.length > 0) {
    const site = bareCalls.get(queue.pop());
    for (const name of site?.names ?? []) {
      const def = defOf.get(name);
      if (done.has(name) || def === undefined || (site.path !== def && !importsOf(site.path)?.has(def))) continue;
      done.add(name);
      const m = sliceOf(name)?.matches?.[0];
      if (m === undefined) continue;
      for (const h of [{ ...m.symbol, relation: "calls" }, ...(m.hits ?? [])]) {
        if (ids.has(h.id)) continue;
        ids.add(h.id);
        hits.push(h);
        queue.push(h.id);
        recovered.add(name);
      }
    }
  }
  return { callers: { ...callers, matches: [{ ...match, hits }, ...rest] }, recovered: [...recovered].sort() };
}

/**
 * One slice from a `cs callers <entry> --direction out -d all --json` answer: reached symbols of `dir` by module,
 * the share of the entry's module, and the port calls of the entry and every reached symbol. `recovered` — names
 * whose dropped calls `completeCallers` restored.
 */
export function buildSlice(callers, { dir, level, portCalls = new Map(), recovered = [] }) {
  const match = callers.matches?.[0];
  if (match === undefined) return { entry: callers.query, found: false };
  const entryModule = moduleOf(match.symbol.path, dir, level);
  const prefix = `${dir.replace(/\\/g, "/")}/`;
  const seen = new Set();
  const modules = {};
  for (const hit of match.hits ?? []) {
    if (!hit.path?.startsWith(prefix) || seen.has(hit.id)) continue;
    seen.add(hit.id);
    const m = moduleOf(hit.path, dir, level);
    modules[m] = (modules[m] ?? 0) + 1;
  }
  const ports = {};
  for (const id of [match.symbol.id, ...seen]) {
    for (const [key, n] of portCalls.get(id) ?? []) ports[key] = (ports[key] ?? 0) + n;
  }
  const symbols = seen.size;
  return {
    entry: match.symbol.name,
    path: match.symbol.path,
    found: true,
    symbols,
    module_count: Object.keys(modules).length,
    entry_module: entryModule,
    entry_share: symbols === 0 ? 0 : round((modules[entryModule] ?? 0) / symbols),
    modules: Object.fromEntries(Object.entries(modules).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))),
    ports: Object.fromEntries(Object.entries(ports).sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    recovered
  };
}

/**
 * The snapshot. `deps` — `cs deps <dir> --level N --json`; `cycles` / `runtimeCycles` — the same with `--cycles`
 * (and `--runtime`); `dups` — `cs dups --json`; `slices` — `buildSlice` results.
 */
export function buildSnapshot({ commit, dir, level, deps, cycles, runtimeCycles, dups, slices }) {
  const outgoing = new Map();
  for (const e of deps.edges) outgoing.set(e.from, (outgoing.get(e.from) ?? 0) + e.imports);
  const modules = deps.modules.map((m) => {
    const out = outgoing.get(m.id) ?? 0;
    return {
      id: m.id, files: m.files, ca: m.ca, ce: m.ce, instability: m.instability, internal: m.internal, outgoing: out,
      cohesion: m.internal + out === 0 ? null : round(m.internal / (m.internal + out))
    };
  });
  return {
    format: SNAPSHOT_FORMAT,
    commit,
    dir,
    level,
    totals: {
      modules: modules.length,
      module_edges: deps.edges.length,
      imports: deps.edges.reduce((s, e) => s + e.imports, 0),
      cycles: cycles.cycles.length,
      runtime_cycles: runtimeCycles.cycles.length,
      dups: dups.dups.length
    },
    modules,
    edges: deps.edges.map((e) => ({ from: e.from, to: e.to, imports: e.imports, runtime: e.runtime, type: e.type })),
    cycles: cycles.cycles.map((c) => ({ members: c.members, runtime: runtimeCycles.cycles.some((r) => sameSet(r.members, c.members)) })),
    dups: dups.dups.map((d) => ({ name: d.name, files: d.files, hazard: d.hazard })),
    slices
  };
}

function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

const cycleKey = (c) => [...c.members].sort().join(" ↔ ");
const edgeKey = (e) => `${e.from} → ${e.to}`;

/** What changed between two snapshots: [{ kind, id, before, after }], `before`/`after` null for added/removed. */
export function diffSnapshots(before, after) {
  const changes = [];
  const byId = (list, key) => new Map(list.map((x) => [key(x), x]));
  const compare = (kind, a, b, key, fields) => {
    const A = byId(a, key);
    const B = byId(b, key);
    for (const [id, x] of A) if (!B.has(id)) changes.push({ kind, id, before: pick(x, fields), after: null });
    for (const [id, y] of B) {
      const x = A.get(id);
      if (x === undefined) { changes.push({ kind, id, before: null, after: pick(y, fields) }); continue; }
      const moved = fields.filter((f) => differs(x[f], y[f]));
      if (moved.length > 0) changes.push({ kind, id, before: pick(x, moved), after: pick(y, moved) });
    }
  };
  compare("module", before.modules, after.modules, (m) => m.id, ["files", "ca", "ce", "instability", "cohesion"]);
  compare("edge", before.edges, after.edges, edgeKey, ["imports"]);
  compare("cycle", before.cycles, after.cycles, cycleKey, ["runtime"]);
  compare("dup", before.dups, after.dups, (d) => d.name, ["files"]);
  compare("slice", before.slices.filter((s) => s.found), after.slices.filter((s) => s.found), (s) => s.entry,
    ["symbols", "module_count", "entry_share"]);
  return changes;
}

function pick(x, fields) {
  return Object.fromEntries(fields.map((f) => [f, x[f]]));
}

function differs(a, b) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) >= EPSILON;
  return a !== b;
}

/** Human-readable snapshot: modules with cohesion, cycles, dups, slices with ports. */
export function formatSnapshot(s) {
  const lines = [`arch-snapshot — ${s.dir} (level ${s.level}), commit ${s.commit}`];
  const t = s.totals;
  lines.push(`${t.modules} modules, ${t.module_edges} module edges, ${t.imports} imports; cycles ${t.cycles} (runtime ${t.runtime_cycles}); dups ${t.dups}`);
  lines.push("", "module                 files  Ca  Ce  I     internal  outgoing  cohesion");
  for (const m of s.modules) {
    lines.push(`${m.id.padEnd(22)} ${String(m.files).padStart(5)} ${String(m.ca).padStart(3)} ${String(m.ce).padStart(3)}  ${String(m.instability).padEnd(5)} ${String(m.internal).padStart(8)} ${String(m.outgoing).padStart(9)}  ${m.cohesion ?? "-"}`);
  }
  lines.push("", "cycles:");
  for (const c of s.cycles) lines.push(`  ${c.members.join(" ↔ ")}${c.runtime ? "" : "  (type-only)"}`);
  lines.push("", "dups (name × files):");
  for (const d of s.dups) lines.push(`  ${d.name} ×${d.files}${d.hazard ? "  (hazard)" : ""}`);
  lines.push("", "slices (symbols / modules / entry share; top modules; ports):");
  for (const sl of s.slices) {
    if (!sl.found) { lines.push(`  ${sl.entry}: not found`); continue; }
    const top = Object.entries(sl.modules).slice(0, 5).map(([m, n]) => `${m} ${n}`).join(", ");
    const ports = Object.entries(sl.ports).map(([p, n]) => `${p}×${n}`).join(" ") || "-";
    const recovered = sl.recovered?.length ? `; recovered: ${sl.recovered.join(", ")}` : "";
    lines.push(`  ${sl.entry}: ${sl.symbols} / ${sl.module_count} / ${sl.entry_share}; ${top}; ports: ${ports}${recovered}`);
  }
  return lines.join("\n");
}

/** Human-readable diff. */
export function formatDiff(changes, { from, to }) {
  const lines = [`arch-snapshot diff ${from} → ${to}: ${changes.length} changes`];
  const show = (x) => (x === null ? "—" : Object.entries(x).map(([k, v]) => `${k}=${v}`).join(" "));
  for (const c of changes) {
    const tag = c.before === null ? "+" : c.after === null ? "-" : "~";
    lines.push(`  ${tag} ${c.kind.padEnd(6)} ${c.id}: ${show(c.before)} → ${show(c.after)}`);
  }
  return lines.join("\n");
}
