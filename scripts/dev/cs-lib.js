/**
 * Logic of `cs` (`scripts/dev/cs.js`, ADR-0026 п. 2, ADR-0029 п. 1–2): the strict argv parser per subcommand, the
 * paths given relative to cwd, the scrubbed environment, the location of the installed `@nanonets/graft` package
 * (its version is checked and its own bin is run), the index build under a lock, cleaning and capping of graft
 * output, `cs impact` — the graph callers of a symbol reconciled with a grep of its call sites, `cs deps` — the file
 * import graph of `graft/.graph/wiring.json` (a file's imports and importers, modules of a directory with Ca / Ce /
 * instability, import cycles), `cs dups` — names defined in several files.
 *
 * No process is started here (the runner does it); only `ensureIndex` touches the file system (file texts for
 * `deps` come through a callback). Unit tests:
 * `packages/cli/test/unit/dev/cs.test.ts`.
 */
import { closeSync, existsSync, mkdirSync, openSync, rmSync, statSync, writeSync } from "node:fs";
import path from "node:path";

export const GRAFT_VERSION = "0.19.0";
/** Exit code: the command or a flag is not allowed — fix the command. */
export const EXIT_USAGE = 2;
/** Exit code: the environment is wrong (version, index, git, graft failed to start) — stop and report. */
export const EXIT_ENV = 3;
export const GRAFT_TIMEOUT_MS = 120_000;
export const CALLERS_MAX_LINES = 80;
export const IMPACT_MAX_LINES = 120;
export const DEPS_MAX_LINES = 150;
export const DUPS_MAX_LINES = 150;

const POSITIVE_INT = /^[1-9]\d*$/;
/** @typedef {{ names: string[], key: string, value?: (v: string) => string | null }} FlagSpec */
/** @type {FlagSpec} */
const IN = { names: ["--in"], key: "in", value: (v) => (v.length > 0 ? null : "a path") };
const JSON_FLAG = { names: ["--json"], key: "json" };
const SYMBOL = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/**
 * Subcommands of `cs`: the positional argument (null — none; `optional` — zero or one) and the allowed flags.
 * @typedef {{ positional: string | null, optional?: boolean, flags: FlagSpec[] }} CommandSpec
 */
export const COMMANDS = /** @type {Record<string, CommandSpec>} */ ({
  ask: {
    positional: "<question>",
    flags: [{ names: ["-n", "--limit"], key: "limit", value: (v) => (POSITIVE_INT.test(v) ? null : "a positive integer") }, { names: ["--source"], key: "source" }, IN, JSON_FLAG]
  },
  grep: { positional: "<pattern>", flags: [{ names: ["-i", "--ignore-case"], key: "ignoreCase" }, { names: ["--fixed"], key: "fixed" }, IN, JSON_FLAG] },
  skeleton: { positional: "<file>", flags: [JSON_FLAG] },
  callers: {
    positional: "<symbol>",
    flags: [
      { names: ["-d", "--depth"], key: "depth", value: (v) => (v === "all" || POSITIVE_INT.test(v) ? null : "a positive integer or all") },
      { names: ["--direction"], key: "direction", value: (v) => (v === "in" || v === "out" ? null : "in or out") },
      IN,
      JSON_FLAG
    ]
  },
  impact: { positional: "<symbol>", flags: [IN, JSON_FLAG] },
  deps: {
    positional: "<file|dir>",
    optional: true,
    flags: [
      { names: ["--level"], key: "level", value: (v) => (POSITIVE_INT.test(v) ? null : "a positive integer") },
      { names: ["--cycles"], key: "cycles" },
      { names: ["--runtime"], key: "runtime" },
      { names: ["--external"], key: "external" },
      IN,
      JSON_FLAG
    ]
  },
  dups: {
    positional: null,
    flags: [
      { names: ["--min"], key: "min", value: (v) => (POSITIVE_INT.test(v) && Number(v) >= 2 ? null : "an integer >= 2") },
      { names: ["--kind"], key: "kind", value: (v) => (v === "function" || v === "all" ? null : "function or all") },
      IN,
      JSON_FLAG
    ]
  },
  map: { positional: null, flags: [JSON_FLAG] },
  version: { positional: null, flags: [] }
});

export const USAGE =
  'cs ask "<question>" [--source] [-n N] [--in <path>] | grep "<pattern>" [-i] [--fixed] [--in <path>] | skeleton <file> | ' +
  "callers <symbol> [-d N|all] [--direction in|out] [--in <path>] | impact <symbol> [--in <path>] | " +
  "deps <file> | deps <dir> [--level N] [--external] [--cycles [--runtime]] | deps --cycles [--in <path>] [--runtime] | " +
  "dups [--min N] [--kind function|all] [--in <path>] | map | version; --json: all but version";

/**
 * @typedef {{ sub: string, arg: string | undefined, opts: Record<string, string | true> }} Parsed
 * @typedef {{ error: string }} ParseError
 */

/**
 * Parse `cs` argv (without `node cs.js`) against the whitelist of the subcommand: only its flags (`--flag=value` or
 * `--flag value`), each once; exactly one positional for ask/grep/skeleton/callers/impact, zero or one for deps (none
 * — `--cycles` over the file graph; with a path — no `--in`; `--runtime` only with `--cycles`), none for
 * map/version/dups; `--` ends the flags. A grep pattern with `\|` (POSIX alternation, matches nothing in a JS
 * regex) is refused.
 * @param {string[]} argv
 * @returns {Parsed | ParseError}
 */
export function parseArgv(argv) {
  const [sub, ...rest] = argv;
  if (sub === undefined || !Object.hasOwn(COMMANDS, sub)) {
    return { error: `unknown command ${sub === undefined ? "(none)" : `"${sub}"`}; allowed: ${Object.keys(COMMANDS).join(", ")}` };
  }
  const spec = /** @type {CommandSpec} */ (COMMANDS[sub]);
  /** @type {Record<string, string | true>} */
  const opts = {};
  const positionals = [];
  let flagsDone = false;
  for (let i = 0; i < rest.length; i++) {
    const a = /** @type {string} */ (rest[i]);
    if (!flagsDone && a === "--") {
      flagsDone = true;
      continue;
    }
    if (flagsDone || !a.startsWith("-") || a === "-") {
      positionals.push(a);
      continue;
    }
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const name = eq > 0 ? a.slice(0, eq) : a;
    const flag = spec.flags.find((f) => f.names.includes(name));
    if (!flag) {
      const allowed = spec.flags.map((f) => f.names.join("/")).join(", ") || "none";
      return { error: `${sub}: flag ${name} is not allowed (allowed: ${allowed}); a literal starting with "-" goes after --` };
    }
    if (Object.hasOwn(opts, flag.key)) return { error: `${sub}: flag ${name} given twice` };
    if (!flag.value) {
      if (eq > 0) return { error: `${sub}: flag ${name} takes no value` };
      opts[flag.key] = true;
      continue;
    }
    const value = eq > 0 ? a.slice(eq + 1) : rest[++i];
    if (value === undefined) return { error: `${sub}: flag ${name} needs a value` };
    const problem = flag.value(value);
    if (problem) return { error: `${sub}: ${name} expects ${problem}, got "${value}"` };
    opts[flag.key] = value;
  }
  if (spec.positional === null) {
    if (positionals.length > 0) return { error: `${sub}: takes no arguments, got ${positionals.map((p) => `"${p}"`).join(" ")}` };
    return { sub, arg: undefined, opts };
  }
  if (spec.optional && positionals.length === 0) {
    if (sub === "deps") {
      if (!opts.cycles) return { error: "deps: give a <file> or <dir>, or --cycles for the cycles of the file import graph" };
      if (opts.level || opts.external) return { error: "deps: --level and --external need a <dir>" };
    }
    return { sub, arg: undefined, opts };
  }
  if (positionals.length !== 1) {
    const got = positionals.length === 0 ? "none" : positionals.map((p) => `"${p}"`).join(" ");
    const hint = spec.optional ? "" : " (quote a multi-word argument; a directory argument is not allowed — narrow with --in)";
    return { error: `${sub}: ${spec.optional ? "at most" : "exactly"} one ${spec.positional} expected, got ${got}${hint}` };
  }
  const arg = /** @type {string} */ (positionals[0]);
  if (arg.trim() === "") return { error: `${sub}: ${spec.positional} is empty` };
  if (sub === "grep" && !opts.fixed && arg.includes("\\|")) {
    return { error: "pattern is a JS regex: use a|b, not a\\|b; --fixed for literals" };
  }
  if ((sub === "impact" || sub === "callers") && !SYMBOL.test(arg)) {
    return { error: `${sub}: ${spec.positional} must be a name or Type.name, got "${arg}"` };
  }
  if (sub === "deps" && opts.in) return { error: "deps: --in goes with --cycles without a path; with a <dir> the dir is the scope" };
  if (sub === "deps" && opts.runtime && !opts.cycles) return { error: "deps: --runtime applies to --cycles only" };
  return { sub, arg, opts };
}

/**
 * A path given to `cs` (the `--in` value, the skeleton file) as graft wants it: repo-root-relative with forward
 * slashes. Relative paths are taken from cwd when they exist there; otherwise (already root-relative, a unique
 * basename for skeleton, a typo) they pass unchanged.
 * @param {string} p
 * @param {{ cwd: string, root: string, exists: (abs: string) => boolean }} where
 * @returns {string}
 */
export function toRepoPath(p, { cwd, root, exists }) {
  const slashed = p.replace(/\\/g, "/");
  const abs = path.resolve(cwd, slashed);
  const rel = path.relative(path.resolve(root), abs);
  const inside = !rel.startsWith("..") && !path.isAbsolute(rel);
  if (path.isAbsolute(p)) return inside ? rel.split(path.sep).join("/") || "." : slashed;
  if (path.relative(path.resolve(root), path.resolve(cwd)) === "") return slashed;
  return inside && exists(abs) ? rel.split(path.sep).join("/") || "." : slashed;
}

/**
 * Rewrite the paths of a parsed command (`--in`, the skeleton file, the deps path) to repo-root-relative.
 * @param {Parsed} parsed
 * @param {{ cwd: string, root: string, exists: (abs: string) => boolean }} where
 * @returns {Parsed}
 */
export function withRepoPaths(parsed, where) {
  const opts = { ...parsed.opts };
  if (typeof opts.in === "string") opts.in = toRepoPath(opts.in, where);
  const arg = (parsed.sub === "skeleton" || parsed.sub === "deps") && parsed.arg !== undefined ? toRepoPath(parsed.arg, where) : parsed.arg;
  return { sub: parsed.sub, arg, opts };
}

/**
 * The graft argv of a parsed command (not for `impact` / `deps` / `dups` / `version`, which the runner answers itself). Flags go first
 * and the positional after `--`, so a literal starting with `-` is not read as a flag by graft.
 * @param {Parsed} parsed
 * @returns {string[]}
 */
export function graftArgs({ sub, arg, opts }) {
  const out = [sub];
  const flag = (/** @type {string} */ key, /** @type {string} */ name) => {
    const v = opts[key];
    if (v === true) out.push(name);
    else if (typeof v === "string") out.push(name, v);
  };
  if (sub === "ask") flag("limit", "--limit"), flag("source", "--source");
  if (sub === "grep") flag("ignoreCase", "--ignore-case"), flag("fixed", "--fixed");
  if (sub === "callers") flag("depth", "--depth"), flag("direction", "--direction");
  flag("in", "--in");
  flag("json", "--json");
  if (arg !== undefined) out.push("--", arg);
  return out;
}

/**
 * The environment for graft: no `GRAFT_*` of the caller (provider, key, model, dir…), then no `.gitignore` /
 * `.ignore` writes, no status line, no telemetry.
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
export function scrubEnv(env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || /^graft_/i.test(key) || /^do_not_track$/i.test(key)) continue;
    out[key] = value;
  }
  return { ...out, GRAFT_NO_GITIGNORE: "1", GRAFT_NO_IGNORE: "1", GRAFT_NO_STATUSLINE: "1", DO_NOT_TRACK: "1" };
}

/**
 * Graft output as `cs` shows it: without the `[graft] tokens saved` lines; `graft <sub>` hints → `cs <sub>`; build
 * and raw-grep hints → what holds under `cs`.
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function clean(text) {
  return (text ?? "")
    .split(/\r?\n/)
    .filter((l) => !l.startsWith("[graft] tokens saved"))
    .join("\n")
    .replace(/`graft build` if graft\/ is empty/g, "index builds itself (cs)")
    .replace(/\b[Rr]un `?graft build(?! --)`?(?: first)?/g, "index builds itself (cs)")
    .replace(/Fall back to raw grep -rn only for unindexed files/g, "unindexed files (docs, JSON) — ordinary grep")
    .replace(/\bgraft (ask|grep|skeleton|callers|map)\b/g, "cs $1");
}

/**
 * At most `max` lines of text, then one line saying how many were dropped and how to narrow.
 * @param {string} text
 * @param {number} max
 * @param {string} hint
 * @returns {string}
 */
export function capLines(text, max, hint) {
  const trailing = text.endsWith("\n");
  const lines = (trailing ? text.slice(0, -1) : text).split("\n");
  if (lines.length <= max) return text;
  return `${lines.slice(0, max).join("\n")}\n… +${lines.length - max} more lines — ${hint}\n`;
}

export const CALLERS_HINT = "narrow with --in <path> or -d 1";

/**
 * `cs callers` output: cleaned, capped, and when the graph has no callers — the pointer to `cs impact`, since calls
 * through port interfaces and cross-file calls of a name defined in several files are not in the graph.
 * @param {string} text cleaned graft output
 * @param {string} symbol
 * @returns {string}
 */
export function callersOutput(text, symbol) {
  let out = capLines(text, CALLERS_MAX_LINES, CALLERS_HINT);
  if (/no indexed callers/.test(text)) {
    out = `${out.replace(/\n?$/, "\n")}cs: the graph misses calls through port interfaces (ctx.git.head()) and cross-file calls of a shared name — cs impact ${symbol}\n`;
  }
  return out;
}

/**
 * The installed `@nanonets/graft` found on PATH (`<dir>/node_modules/…` or `<dir>/../lib/node_modules/…`): its
 * directory, version and the absolute path of its `graft` bin — the code that runs is the code whose version is checked.
 * @param {string} pathEnv
 * @param {{ delimiter: string, exists: (p: string) => boolean, readJson: (p: string) => any }} io
 * @returns {{ dir: string, version: string | null, bin: string | null } | null}
 */
export function findGraftPackage(pathEnv, { delimiter, exists, readJson }) {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const rel of ["node_modules", "../lib/node_modules"]) {
      const pkgDir = path.join(dir, rel, "@nanonets", "graft");
      const manifest = path.join(pkgDir, "package.json");
      if (!exists(manifest)) continue;
      const pkg = readJson(manifest);
      const entry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.graft;
      return { dir: pkgDir, version: typeof pkg.version === "string" ? pkg.version : null, bin: typeof entry === "string" ? path.join(pkgDir, entry) : null };
    }
  }
  return null;
}

/** Block the thread for `ms` (the runner is synchronous). */
export function sleepSync(/** @type {number} */ ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Make sure `graft/.graph/wiring.json` exists: one process builds under the exclusive lock `graft/.cs-build.lock`,
 * the others wait for the index (poll `pollMs`, up to `timeoutMs`); a lock older than `staleMs` is removed.
 * @param {string} root
 * @param {() => { ok: boolean, message?: string }} build
 * @param {{ now?: () => number, sleep?: (ms: number) => void, timeoutMs?: number, staleMs?: number, pollMs?: number }} [opts]
 * @returns {{ state: "present" | "built" | "waited" | "failed" | "timeout", message?: string }}
 */
export function ensureIndex(root, build, opts = {}) {
  const { now = Date.now, sleep = sleepSync, timeoutMs = 90_000, staleMs = 5 * 60_000, pollMs = 200 } = opts;
  const dir = path.join(root, "graft");
  const wiring = path.join(dir, ".graph", "wiring.json");
  const lock = path.join(dir, ".cs-build.lock");
  if (existsSync(wiring)) return { state: "present" };
  mkdirSync(dir, { recursive: true });
  const deadline = now() + timeoutMs;
  for (;;) {
    if (existsSync(wiring)) return { state: "waited" };
    let fd;
    try {
      fd = openSync(lock, "wx");
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== "EEXIST") throw e;
    }
    if (fd !== undefined) {
      try {
        writeSync(fd, `${process.pid}\n`);
        closeSync(fd);
        if (existsSync(wiring)) return { state: "waited" };
        const result = build();
        return result.ok ? { state: "built" } : { state: "failed", message: result.message ?? "" };
      } finally {
        rmSync(lock, { force: true });
      }
    }
    try {
      if (now() - statSync(lock).mtimeMs > staleMs) {
        rmSync(lock, { force: true });
        continue;
      }
    } catch {
      continue; // the lock went away between open and stat
    }
    if (now() >= deadline) return { state: "timeout" };
    sleep(pollMs);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// cs impact

const escapeRegex = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CALLABLE_KINDS = new Set(["function", "method"]);

/**
 * How `cs impact <symbol>` searches (H-7): `calls` — the symbol is a function or method in the graph (`Type.name` — that
 * very method); `word` — anything else (a module constant, a type, an interface method, a name the graph lacks), whose
 * uses are values, not calls.
 * @param {string} symbol
 * @param {{ id: string, name: string, kind: string }[]} nodes
 * @returns {"calls" | "word"}
 */
export function impactMatch(symbol, nodes) {
  const name = symbol.slice(symbol.lastIndexOf(".") + 1);
  const typed = symbol.includes(".");
  const hit = nodes.some((n) => CALLABLE_KINDS.has(n.kind) && n.name === name && (!typed || n.id.slice(n.id.indexOf("#") + 1) === symbol));
  return hit ? "calls" : "word";
}

/**
 * What `cs impact <symbol>` searches: the bare name (`CheckRunner.run` → `run`) and one graft grep regex. `calls` (see
 * `impactMatch`): a bare name — calls `name(` / `name<T>(` (a `.name(` call included), `import` / `export {` lines naming
 * it, a line that is only the name (a member of a multi-line import, a value in a list) and local bindings `const name`
 * (to spot shadowing); a `Type.name` — only `.name(` calls. `word`: every `\bname\b` (a `Type.name` — every `.name`).
 * @param {string} symbol
 * @param {"calls" | "word"} [match]
 * @returns {{ name: string, typed: boolean, match: "calls" | "word", pattern: string, call: RegExp, dotCall: RegExp, importLine: RegExp, bare: RegExp, decl: RegExp }}
 */
export function impactQuery(symbol, match = "calls") {
  const name = symbol.slice(symbol.lastIndexOf(".") + 1);
  const typed = symbol.includes(".");
  const n = escapeRegex(name);
  const call = `\\b${n}\\s*(?:<[^>()]*>)?\\s*\\(`;
  const dotCall = `\\.${n}\\s*(?:<[^>()]*>)?\\s*\\(`;
  const importLine = `^\\s*(?:import\\b[^"'\`]*|export\\s+(?:type\\s+)?\\{[^}]*)\\b${n}\\b`;
  const bare = `^\\s*(?:type\\s+)?${n}(?:\\s+as\\s+[\\w$]+)?\\s*,?\\s*$`;
  const decl = `\\b(?:const|let|var)\\s+(?:\\{[^}]*|\\[[^\\]]*)?\\b${n}\\b`;
  const word = typed ? `\\.${n}\\b` : `\\b${n}\\b`;
  const pattern = match === "word" ? word : typed ? dotCall : [call, importLine, bare, decl].join("|");
  return { name, typed, match, pattern, call: new RegExp(call), dotCall: new RegExp(dotCall), importLine: new RegExp(importLine), bare: new RegExp(bare), decl: new RegExp(decl) };
}

/**
 * @typedef {{ id: string, name: string, kind: string, path: string, span: string }} GraphNode
 * @typedef {{ matches?: { symbol: GraphNode, hits: (GraphNode & { relation?: string })[], note?: string }[] }} CallersJson
 * @typedef {{ totalHits?: number, truncated?: { files?: number, hits?: number }, groups?: { path: string, hits: { line: number, text: string }[] }[] }} GrepJson
 */

/** `L12-L40` → [12, 40]. */
export function parseSpan(/** @type {string} */ span) {
  const m = /^L(\d+)-L(\d+)$/.exec(span);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

const SCOPE_KINDS = new Set(["function", "method", "class", "interface", "type"]);
/** A comment line (`//`, `/*`, ` * `): mentions a call, is not one. */
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;
const PORT_RECEIVER = /\bctx\b|port|git|openspec|checks|clock/i;
const isTest = (/** @type {string} */ p) => /(^|\/)test\//.test(p) || /\.test\.[cm]?[jt]s$/.test(p);
const cmp = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : a > b ? 1 : 0);
const symbolOf = (/** @type {GraphNode} */ n) => n.id.slice(n.id.indexOf("#") + 1) || n.name;

/**
 * Reconcile the graph callers (`graft callers <symbol> -d 1 --json`) with the grep of the call sites
 * (`graft grep <impactQuery.pattern> --json`) over the nodes of `graft/.graph/wiring.json` into the `cs impact` report:
 * every site with its enclosing symbol and source line, tagged `[graph+grep]`, `[grep]` (the graph misses it: a call
 * through a port, a cross-file call of a shared name) or `[graph]` (only an edge — verify, possibly a false edge by
 * name); ` port` — a `.name(` call on a port-looking receiver; ` local?` — inside a scope that declares its own
 * `name`. Definition lines of the name and comment lines are not sites; several definitions of the name are listed.
 *
 * `word` (`impactMatch`): every use of the name is a site; a module-level `const NAME` is a definition (`kind: const`).
 *
 * The JSON of `cs impact --json` (format `cs-impact/1`): `{ format, symbol, name, match, counts: { sites, files, graph,
 * grepOnly, graphOnly }, definitions: [{ path, line, symbol, kind }], graph: { callers: N } | { error },
 * shadows: [{ path, line, scope }], grepTruncated: { files, hits }, sites: [{ path, line, enclosing, tags, text,
 * span?, relation? }] }`; `tags` — `graph+grep` | `grep` | `graph`, then `port` / `local?`; a graph-only site has
 * `text: null`, the caller `span` and the edge `relation`.
 * @param {{ symbol: string, callers: CallersJson | null, callersError?: string, grep: GrepJson, nodes: GraphNode[] }} input
 */
export function impactData({ symbol, callers, callersError, grep, nodes }) {
  const q = impactQuery(symbol, impactMatch(symbol, nodes));
  const defs = nodes.filter((n) => n.name === q.name && n.kind !== "file").map((n) => ({ path: n.path, line: parseSpan(n.span)[0], symbol: symbolOf(n), kind: n.kind }));
  const defLines = new Set(defs.map((d) => `${d.path}:${d.line}`));
  const byPath = new Map();
  for (const n of nodes) {
    if (!SCOPE_KINDS.has(n.kind)) continue;
    if (!byPath.has(n.path)) byPath.set(n.path, []);
    byPath.get(n.path).push(n);
  }
  /** Smallest function/method/class/interface/type around a line, or null (module level). */
  const enclosing = (/** @type {string} */ file, /** @type {number} */ line) => {
    let best = null;
    let bestSize = Infinity;
    for (const n of byPath.get(file) ?? []) {
      const [a, b] = parseSpan(n.span);
      if (line >= a && line <= b && b - a < bestSize) (best = n), (bestSize = b - a);
    }
    return best;
  };

  // graph edges, one per caller node
  /** @type {Map<string, GraphNode>} */
  const graphHits = new Map();
  for (const m of callers?.matches ?? []) for (const h of m.hits ?? []) graphHits.set(h.id, h);

  // grep lines: sites, and local declarations of the name (scopes that shadow it)
  const sites = [];
  const shadows = [];
  for (const g of grep.groups ?? []) {
    for (const h of g.hits ?? []) {
      if (defLines.has(`${g.path}:${h.line}`) || COMMENT.test(h.text)) continue;
      const scope = enclosing(g.path, h.line);
      // word: a module-level `const NAME` is the definition of a constant (constants are not graph nodes)
      if (q.match === "word" && !q.typed && !scope && q.decl.test(h.text) && !q.importLine.test(h.text)) {
        defs.push({ path: g.path, line: h.line, symbol: q.name, kind: "const" });
        continue;
      }
      if (q.match === "calls" && !q.typed && q.decl.test(h.text) && !q.call.test(h.text) && !q.importLine.test(h.text)) {
        shadows.push({ path: g.path, line: h.line, scope });
        continue;
      }
      sites.push({ path: g.path, line: h.line, text: h.text, scope });
    }
  }
  /** Local declarations of the name whose scope holds the line; each one found is reported. */
  const usedShadows = new Set();
  const shadowed = (/** @type {string} */ file, /** @type {number} */ line) => {
    const found = shadows.filter((s) => {
      if (s.path !== file) return false;
      if (!s.scope) return true;
      const [a, b] = parseSpan(s.scope.span);
      return line >= a && line <= b;
    });
    for (const s of found) usedShadows.add(s);
    return !q.typed && found.length > 0;
  };

  const matched = new Set();
  const rows = [];
  for (const s of sites) {
    const edges = [...graphHits.values()].filter((h) => {
      if (h.path !== s.path) return false;
      const [a, b] = parseSpan(h.span);
      return s.line >= a && s.line <= b;
    });
    for (const e of edges) matched.add(e.id);
    let tag = edges.length > 0 ? "graph+grep" : "grep";
    const dot = s.text.match(q.dotCall);
    if (dot && dot.index !== undefined) {
      const receiver = /[\w$.?!]+$/.exec(s.text.slice(0, dot.index))?.[0] ?? "";
      if (PORT_RECEIVER.test(receiver)) tag += " port";
    }
    if (shadowed(s.path, s.line)) tag += " local?";
    /** @type {ImpactSite} */
    const row = { path: s.path, line: s.line, enclosing: s.scope ? symbolOf(s.scope) : "(module)", tags: tag.split(" "), text: s.text.trim() };
    rows.push(row);
  }
  for (const h of graphHits.values()) {
    if (matched.has(h.id)) continue;
    const [a, b] = parseSpan(h.span);
    const local = shadows.some((s) => s.path === h.path && s.line >= a && s.line <= b && usedShadows.add(s));
    rows.push({
      path: h.path,
      line: a,
      enclosing: h.kind === "file" ? "(module)" : symbolOf(h),
      tags: local ? ["graph", "local?"] : ["graph"],
      text: null,
      span: h.span,
      relation: h.relation ?? "edge"
    });
  }
  rows.sort((x, y) => Number(isTest(x.path)) - Number(isTest(y.path)) || cmp(x.path, y.path) || x.line - y.line);

  const count = (/** @type {string} */ t) => rows.filter((r) => r.tags[0] === t).length;
  /** @type {{ callers: number } | { error: string }} */
  const graph = callersError ? { error: callersError.trim() } : { callers: graphHits.size };
  return {
    format: "cs-impact/1",
    symbol,
    name: q.name,
    match: q.match,
    counts: { sites: rows.length, files: new Set(rows.map((r) => r.path)).size, graph: count("graph+grep"), grepOnly: count("grep"), graphOnly: count("graph") },
    definitions: defs,
    graph,
    shadows: [...usedShadows].map((s) => ({ path: s.path, line: s.line, scope: s.scope ? symbolOf(s.scope) : "(module)" })),
    grepTruncated: { files: grep.truncated?.files ?? 0, hits: grep.truncated?.hits ?? 0 },
    sites: rows
  };
}

/**
 * @typedef {{ path: string, line: number, enclosing: string, tags: string[], text: string | null, span?: string, relation?: string }} ImpactSite
 */

/**
 * The `cs impact` text from `impactData`, at most `IMPACT_MAX_LINES` lines.
 * @param {ReturnType<typeof impactData>} d
 * @returns {string}
 */
export function formatImpact(d) {
  const c = d.counts;
  const out = [`impact ${d.symbol} — ${c.sites} sites in ${c.files} files (graph: ${c.graph}, grep-only: ${c.grepOnly}, graph-only: ${c.graphOnly})`];
  if (d.match === "word") {
    const word = d.symbol.includes(".") ? `.${d.name}` : d.name;
    out.push(`match: word — every "${word}" (not a function or method in the graph): values, types and re-exports, not only calls`);
    if (d.definitions.length === 1) out.push(`definition: ${d.definitions[0].path}:${d.definitions[0].line}  ${d.definitions[0].kind}`);
  }
  if (d.definitions.length > 1) {
    out.push(`${d.definitions.length} definitions share the name "${d.name}" — which one each site refers to is not resolved:`);
    for (const def of d.definitions) out.push(`  ${def.path}:${def.line}  ${def.symbol}  ${def.kind}`);
  }
  if ("error" in d.graph) out.push(`graph: ${d.graph.error}`);
  else if (d.graph.callers === 0) out.push("graph: no callers indexed — the grep sites below are the list (calls through ports and shared names are not in the graph)");
  for (const s of d.shadows) {
    out.push(`verify: ${s.scope} (${s.path}:${s.line}) declares its own "${d.name}" — sites there tagged local? likely use it, not ${d.symbol}`);
  }
  if (d.grepTruncated.hits > 0 || d.grepTruncated.files > 0) out.push(`grep truncated by graft: +${d.grepTruncated.hits} hits not shown — narrow with --in <path>`);
  if (c.sites === 0) out.push(`no ${d.match === "word" ? "uses" : "call sites"} of "${d.name}" found in indexed code (packages/**, scripts/**)`);
  for (const r of d.sites) {
    const text =
      r.text === null ? `(${r.relation}, span ${r.span}) verify: graph-only edge (possible false edge by name)` : r.text.length > 140 ? `${r.text.slice(0, 139)}…` : r.text;
    out.push(`${r.path}:${r.line}  ${r.enclosing}  [${r.tags.join(" ")}]  ${text}`);
  }
  return capLines(`${out.join("\n")}\n`, IMPACT_MAX_LINES, "narrow with --in <path>");
}

/**
 * The `cs impact` text report: `formatImpact(impactData(input))`.
 * @param {Parameters<typeof impactData>[0]} input
 * @returns {string}
 */
export function impactReport(input) {
  return formatImpact(impactData(input));
}

// ---------------------------------------------------------------------------------------------------------------------
// cs deps: the file import graph of wiring.json

/**
 * @typedef {{ source: string, target: string, relation: string }} GraphEdge
 * @typedef {"runtime" | "type" | "?"} ImportKind
 * @typedef {{ files: Set<string>, edges: { from: string, to: string, internal: boolean }[] }} ImportGraph
 * @typedef {(from: string, to: string) => ImportKind} KindOf
 * @typedef {{ size: number, members: string[], cycle: string[] }} Cycle
 */

/** `import … from` / `export … from` at the start of a line (or after `;`); the clause holds no `=` or `(`. */
const FROM_STATEMENT = /(?:^|[\n;])[ \t]*(?:import|export)(\s+type)?\s+([\w$\s{},*]*?)\s*from\s*(["'])([^"'\n]+)\3/g;
const SIDE_EFFECT = /(?:^|[\n;])[ \t]*import\s*(["'])([^"'\n]+)\1/g;
const CALL_IMPORT = /\b(?:import|require)\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g;

/** A statement clause is type-only: `import type …` / `export type …`, or `{ type A, type B }` only. */
function clauseIsType(/** @type {string | undefined} */ typeKeyword, /** @type {string} */ clause) {
  if (typeKeyword) return true;
  const braces = /^\{([\s\S]*)\}$/.exec(clause.trim());
  if (!braces) return false;
  const items = (braces[1] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return items.length > 0 && items.every((x) => /^type\s/.test(x));
}

/**
 * The import statements of a source text: `{ spec, type }` for `import`/`export … from`, side-effect `import "x"`,
 * `import("x")` and `require("x")`. `type` — the statement brings in types only: `import type`, `export type … from`,
 * `{ type A }` only, `typeof import("x")`, `import("x")` inside a comment (JSDoc).
 * @param {string} text
 * @returns {{ spec: string, type: boolean }[]}
 */
export function parseImports(text) {
  const out = [];
  for (const m of text.matchAll(FROM_STATEMENT)) out.push({ spec: /** @type {string} */ (m[4]), type: clauseIsType(m[1], m[2] ?? "") });
  for (const m of text.matchAll(SIDE_EFFECT)) out.push({ spec: /** @type {string} */ (m[2]), type: false });
  for (const m of text.matchAll(CALL_IMPORT)) {
    const at = m.index ?? 0;
    const before = text.slice(text.lastIndexOf("\n", at) + 1, at);
    const inComment = /^\s*(?:\*|\/\/)/.test(before) || before.lastIndexOf("/*") > before.lastIndexOf("*/") || before.includes("//");
    out.push({ spec: /** @type {string} */ (m[2]), type: inComment || /\btypeof\s*$/.test(before) });
  }
  return out;
}

/**
 * The repo file a specifier of `from` names (`./x.js` → `x.ts`, a directory → its index), else the specifier itself
 * (an external module) or the normalized relative path when no indexed file matches.
 * @param {string} from
 * @param {string} spec
 * @param {Set<string>} files
 * @returns {string}
 */
export function resolveSpec(from, spec, files) {
  if (!spec.startsWith(".")) return spec;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  const swapped = base.replace(/\.js$/, ".ts").replace(/\.jsx$/, ".tsx").replace(/\.mjs$/, ".mts").replace(/\.cjs$/, ".cts");
  const candidates = [base, swapped, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.js`];
  return candidates.find((c) => files.has(c)) ?? base;
}

/**
 * Kind of each import target of one file: `type` when every statement naming it is type-only, else `runtime`.
 * @param {string} from
 * @param {string} text
 * @param {Set<string>} files
 * @returns {Map<string, ImportKind>}
 */
export function importKinds(from, text, files) {
  /** @type {Map<string, ImportKind>} */
  const kinds = new Map();
  for (const im of parseImports(text)) {
    const target = resolveSpec(from, im.spec, files);
    if (kinds.get(target) !== "runtime") kinds.set(target, im.type ? "type" : "runtime");
  }
  return kinds;
}

/**
 * The file import graph of wiring.json: indexed files and `imports` edges from them (deduplicated); `internal` —
 * the target is an indexed file, else an external module specifier.
 * @param {{ nodes?: GraphNode[], edges?: GraphEdge[] }} wiring
 * @returns {ImportGraph}
 */
export function importGraph(wiring) {
  const files = new Set((wiring.nodes ?? []).filter((n) => n.kind === "file").map((n) => n.path));
  const seen = new Set();
  const edges = [];
  for (const e of wiring.edges ?? []) {
    if (e.relation !== "imports" || !files.has(e.source) || e.source === e.target) continue;
    const key = `${e.source}\n${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: e.source, to: e.target, internal: files.has(e.target) });
  }
  return { files, edges };
}

/**
 * `kindOf(from, to)` over file texts read on demand (`readText` → null when unreadable: `?`).
 * @param {Set<string>} files
 * @param {(file: string) => string | null} readText
 * @returns {KindOf}
 */
export function makeKindOf(files, readText) {
  /** @type {Map<string, Map<string, ImportKind> | null>} */
  const cache = new Map();
  return (from, to) => {
    if (!cache.has(from)) {
      const text = readText(from);
      cache.set(from, text === null ? null : importKinds(from, text, files));
    }
    return cache.get(from)?.get(to) ?? "?";
  };
}

const under = (/** @type {string} */ p, /** @type {string} */ prefix) => prefix === "" || p === prefix || p.startsWith(`${prefix}/`);

/** `./a/b/` → `a/b`; `.` → `` (the whole repo). */
export function normalizeDir(/** @type {string} */ d) {
  const s = d.replace(/\\/g, "/").replace(/\/+$/, "");
  return s === "." ? "" : s.replace(/^\.\//, "");
}

/**
 * Strongly connected components (Tarjan) with more than one node or a self-loop, largest first.
 * @param {string[]} nodes
 * @param {(n: string) => string[]} next
 * @returns {string[][]}
 */
export function tarjan(nodes, next) {
  let counter = 0;
  /** @type {Map<string, number>} */
  const index = new Map();
  /** @type {Map<string, number>} */
  const low = new Map();
  const onStack = new Set();
  /** @type {string[]} */
  const stack = [];
  /** @type {string[][]} */
  const out = [];
  const visit = (/** @type {string} */ v) => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of next(v)) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(/** @type {number} */ (low.get(v)), /** @type {number} */ (low.get(w))));
      } else if (onStack.has(w)) low.set(v, Math.min(/** @type {number} */ (low.get(v)), /** @type {number} */ (index.get(w))));
    }
    if (low.get(v) !== index.get(v)) return;
    const scc = [];
    let w;
    do {
      w = /** @type {string} */ (stack.pop());
      onStack.delete(w);
      scc.push(w);
    } while (w !== v);
    if (scc.length > 1 || next(v).includes(v)) out.push(scc.sort());
  };
  for (const v of nodes) if (!index.has(v)) visit(v);
  return out.sort((a, b) => b.length - a.length || cmp(a[0] ?? "", b[0] ?? ""));
}

/**
 * One concrete cycle through the first member of a component: the shortest path back to it (BFS), `[a, b, …, a]`.
 * @param {string[]} members
 * @param {(n: string) => string[]} next
 * @returns {string[]}
 */
export function cycleOf(members, next) {
  const inside = new Set(members);
  const start = /** @type {string} */ (members[0]);
  /** @type {Map<string, string>} */
  const prev = new Map();
  const queue = [start];
  const seen = new Set([start]);
  while (queue.length > 0) {
    const u = /** @type {string} */ (queue.shift());
    for (const v of next(u)) {
      if (!inside.has(v)) continue;
      if (v === start) {
        const back = [u];
        while (back[0] !== start) back.unshift(/** @type {string} */ (prev.get(/** @type {string} */ (back[0]))));
        return [...back, start];
      }
      if (!seen.has(v)) {
        seen.add(v);
        prev.set(v, u);
        queue.push(v);
      }
    }
  }
  return [start];
}

/** @returns {Cycle[]} */
const components = (/** @type {string[]} */ nodes, /** @type {(n: string) => string[]} */ next) =>
  tarjan(nodes, next).map((members) => ({ size: members.length, members, cycle: cycleOf(members, next) }));

/**
 * `cs deps <file>` (format `cs-deps/1`, mode `file`): `{ format, mode, file, imports: [{ path, kind }],
 * external: [{ module, kind }], importedBy: [{ path, kind }] }`, kind — `runtime` | `type` | `?`.
 * @param {string} file
 * @param {ImportGraph} graph
 * @param {KindOf} kindOf
 */
export function depsFile(file, graph, kindOf) {
  const out = graph.edges.filter((e) => e.from === file);
  return {
    format: "cs-deps/1",
    mode: "file",
    file,
    imports: out.filter((e) => e.internal).map((e) => ({ path: e.to, kind: kindOf(file, e.to) })).sort((a, b) => cmp(a.path, b.path)),
    external: out.filter((e) => !e.internal).map((e) => ({ module: e.to, kind: kindOf(file, e.to) })).sort((a, b) => cmp(a.module, b.module)),
    importedBy: graph.edges.filter((e) => e.to === file).map((e) => ({ path: e.from, kind: kindOf(e.from, file) })).sort((a, b) => cmp(a.path, b.path))
  };
}

/**
 * The module of a file under `prefix` at `level`: its first `level` directories below `prefix`; a file directly in
 * `prefix` is its own module.
 * @param {string} file
 * @param {string} prefix normalized dir ("" — the repo)
 * @param {number} level
 */
export function moduleOf(file, prefix, level) {
  const rel = prefix === "" ? file : file.slice(prefix.length + 1);
  const segs = rel.split("/");
  return segs.length === 1 ? rel : segs.slice(0, Math.min(level, segs.length - 1)).join("/");
}

/**
 * `cs deps <dir> [--level N]` (format `cs-deps/1`, mode `modules`): `{ format, mode, dir, level, modules: [{ id, files,
 * ca, ce, instability, internal, outside, external? }], edges: [{ from, to, imports, runtime, type, unknown }],
 * runtime?, cycles?: [{ size, members, cycle }] }`. Module ids are relative to `dir`; `imports` counts file-level
 * import edges; Ca / Ce — distinct modules depending on it / it depends on; instability = Ce / (Ca + Ce), null when
 * both are 0; `internal` — imports inside the module, `outside` — to repo files outside `dir`; `external` (with
 * `--external`) — module specifiers with counts. `cycles` (with `--cycles`) — over module edges, runtime ones only
 * with `runtime`.
 * @param {string} dir
 * @param {number} level
 * @param {ImportGraph} graph
 * @param {KindOf} kindOf
 * @param {{ external?: boolean, cycles?: boolean, runtime?: boolean }} [opts]
 */
export function depsModules(dir, level, graph, kindOf, opts = {}) {
  const prefix = normalizeDir(dir);
  /** @typedef {{ id: string, files: number, ca: Set<string>, ce: Set<string>, internal: number, outside: number, external: Map<string, number> }} Mod */
  /** @type {Map<string, Mod>} */
  const modules = new Map();
  const mod = (/** @type {string} */ id) => {
    let m = modules.get(id);
    if (!m) modules.set(id, (m = { id, files: 0, ca: new Set(), ce: new Set(), internal: 0, outside: 0, external: new Map() }));
    return m;
  };
  const inDir = (/** @type {string} */ f) => under(f, prefix) && f !== prefix;
  for (const f of graph.files) if (inDir(f)) mod(moduleOf(f, prefix, level)).files += 1;
  /** @type {Map<string, { from: string, to: string, imports: number, runtime: number, type: number, unknown: number }>} */
  const edges = new Map();
  for (const e of graph.edges) {
    if (!inDir(e.from)) continue;
    const from = mod(moduleOf(e.from, prefix, level));
    if (!e.internal) {
      from.external.set(e.to, (from.external.get(e.to) ?? 0) + 1);
      continue;
    }
    if (!inDir(e.to)) {
      from.outside += 1;
      continue;
    }
    const to = moduleOf(e.to, prefix, level);
    if (to === from.id) {
      from.internal += 1;
      continue;
    }
    const key = `${from.id}\n${to}`;
    let edge = edges.get(key);
    if (!edge) edges.set(key, (edge = { from: from.id, to, imports: 0, runtime: 0, type: 0, unknown: 0 }));
    edge.imports += 1;
    const kind = kindOf(e.from, e.to);
    if (kind === "runtime") edge.runtime += 1;
    else if (kind === "type") edge.type += 1;
    else edge.unknown += 1;
    from.ce.add(to);
    mod(to).ca.add(from.id);
  }
  const edgeList = [...edges.values()].sort((a, b) => b.imports - a.imports || cmp(a.from, b.from) || cmp(a.to, b.to));
  const moduleList = [...modules.values()]
    .sort((a, b) => cmp(a.id, b.id))
    .map((m) => ({
      id: m.id,
      files: m.files,
      ca: m.ca.size,
      ce: m.ce.size,
      instability: m.ca.size + m.ce.size === 0 ? null : Math.round((m.ce.size / (m.ca.size + m.ce.size)) * 100) / 100,
      internal: m.internal,
      outside: m.outside,
      ...(opts.external
        ? { external: [...m.external].map(([module, count]) => ({ module, count })).sort((a, b) => b.count - a.count || cmp(a.module, b.module)) }
        : {})
    }));
  const result = { format: "cs-deps/1", mode: "modules", dir: prefix, level, modules: moduleList, edges: edgeList };
  if (!opts.cycles) return result;
  const kept = edgeList.filter((e) => !opts.runtime || e.runtime + e.unknown > 0);
  const next = (/** @type {string} */ n) => kept.filter((e) => e.from === n).map((e) => e.to).sort();
  return { ...result, runtime: Boolean(opts.runtime), cycles: components(moduleList.map((m) => m.id), next) };
}

/**
 * `cs deps --cycles [--in <path>] [--runtime]` (format `cs-deps/1`, mode `cycles`): `{ format, mode, in, runtime,
 * cycles: [{ size, members, cycle }] }` — strongly connected components of the file import graph under `in`;
 * `runtime` drops type-only edges (`?` is kept).
 * @param {ImportGraph} graph
 * @param {KindOf} kindOf
 * @param {{ in?: string, runtime?: boolean }} [opts]
 */
export function depsCycles(graph, kindOf, opts = {}) {
  const prefix = normalizeDir(opts.in ?? "");
  const nodes = [...graph.files].filter((f) => under(f, prefix)).sort();
  const inScope = new Set(nodes);
  /** @type {Map<string, string[]>} */
  const adj = new Map();
  for (const e of graph.edges) {
    if (!e.internal || !inScope.has(e.from) || !inScope.has(e.to)) continue;
    if (opts.runtime && kindOf(e.from, e.to) === "type") continue;
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  for (const list of adj.values()) list.sort();
  const next = (/** @type {string} */ n) => adj.get(n) ?? [];
  return { format: "cs-deps/1", mode: "cycles", in: prefix, runtime: Boolean(opts.runtime), cycles: components(nodes, next) };
}

const kindMark = (/** @type {ImportKind} */ k) => (k === "type" ? "  type-only" : k === "?" ? "  ?" : "");

/**
 * The text of a `cs deps` result, at most `DEPS_MAX_LINES` lines.
 * @param {any} d a result of `depsFile`, `depsModules` or `depsCycles`
 * @returns {string}
 */
export function formatDeps(d) {
  /** @type {string[]} */
  const out = [];
  const cycleLines = (/** @type {Cycle[]} */ cycles) => {
    for (const [i, c] of cycles.entries()) {
      out.push(`cycle ${i + 1} (${c.size}): ${c.cycle.join(" → ")}`);
      if (c.size > c.cycle.length - 1) out.push(`  members: ${c.members.join(", ")}`);
    }
  };
  if (d.mode === "file") {
    /** @type {ReturnType<typeof depsFile>} */
    const f = d;
    out.push(`deps ${f.file} — imports ${f.imports.length} repo files, ${f.external.length} external; imported by ${f.importedBy.length}`);
    out.push("imports:");
    for (const i of f.imports) out.push(`  ${i.path}${kindMark(i.kind)}`);
    if (f.external.length > 0) {
      out.push(`external: ${f.external.map((x) => `${x.module}${x.kind === "type" ? " (type-only)" : x.kind === "?" ? " (?)" : ""}`).join(", ")}`);
    }
    out.push("imported by:");
    for (const i of f.importedBy) out.push(`  ${i.path}${kindMark(i.kind)}`);
  } else if (d.mode === "modules") {
    /** @type {ReturnType<typeof depsModules> & { cycles?: Cycle[], runtime?: boolean }} */
    const m = d;
    const imports = m.edges.reduce((s, e) => s + e.imports, 0);
    const types = m.edges.reduce((s, e) => s + e.type, 0);
    out.push(`deps ${m.dir || "."} --level ${m.level} — ${m.modules.length} modules, ${m.edges.length} module edges (${imports} file imports, ${types} type-only)`);
    const width = Math.max(6, ...m.modules.map((x) => x.id.length));
    out.push(`${"module".padEnd(width)}  files  Ca  Ce  I     internal  outside`);
    for (const x of m.modules) {
      const inst = x.instability === null ? "-" : x.instability.toFixed(2);
      out.push(`${x.id.padEnd(width)}  ${String(x.files).padStart(5)}  ${String(x.ca).padStart(2)}  ${String(x.ce).padStart(2)}  ${inst.padEnd(4)}  ${String(x.internal).padStart(8)}  ${String(x.outside).padStart(7)}`);
      const ext = /** @type {{ module: string, count: number }[] | undefined} */ (/** @type {any} */ (x).external);
      if (ext && ext.length > 0) out.push(`${" ".repeat(width)}  external: ${ext.map((e) => `${e.module} ×${e.count}`).join(", ")}`);
    }
    out.push("edges (from → to: file imports, of them type-only):");
    for (const e of m.edges) out.push(`  ${e.from} → ${e.to}: ${e.imports}${e.type > 0 ? `, ${e.type} type-only` : ""}${e.unknown > 0 ? `, ${e.unknown} ?` : ""}`);
    if (m.cycles) {
      out.push(`module cycles (${m.runtime ? "runtime edges" : "all edges"}): ${m.cycles.length}`);
      cycleLines(m.cycles);
    }
  } else {
    /** @type {ReturnType<typeof depsCycles>} */
    const c = d;
    out.push(`cycles in ${c.in || "."} (${c.runtime ? "runtime imports" : "all imports, type-only included"}): ${c.cycles.length} components`);
    cycleLines(c.cycles);
  }
  return capLines(`${out.join("\n")}\n`, DEPS_MAX_LINES, "narrow with --in / --level, or --json for everything");
}

// ---------------------------------------------------------------------------------------------------------------------
// cs dups: names defined in several files

/**
 * `cs dups` (format `cs-dups/1`): `{ format, min, in, kind, dups: [{ name, files, exported, hazard, definitions:
 * [{ path, line, symbol, kind, exported }] }] }` — bare names (a method `Type.name` groups under `name`, as graft
 * resolves callers by bare name) defined in at least `min` files, most files first. `hazard` — some definition is
 * exported: the graph drops cross-file callers of such a name.
 * @param {(GraphNode & { exported?: boolean })[]} nodes
 * @param {{ min?: number, in?: string, kind?: string }} [opts]
 */
export function dupsData(nodes, opts = {}) {
  const { min = 2, kind = "function" } = opts;
  const prefix = normalizeDir(opts.in ?? "");
  const kinds = kind === "all" ? SCOPE_KINDS : new Set(["function", "method"]);
  /** @type {Map<string, (GraphNode & { exported?: boolean })[]>} */
  const byName = new Map();
  for (const n of nodes) {
    if (!kinds.has(n.kind) || !under(n.path, prefix)) continue;
    const list = byName.get(n.name) ?? [];
    list.push(n);
    byName.set(n.name, list);
  }
  const dups = [];
  for (const [name, defs] of byName) {
    const files = new Set(defs.map((d) => d.path)).size;
    if (files < min) continue;
    const exported = defs.some((d) => d.exported === true);
    dups.push({
      name,
      files,
      exported,
      hazard: exported,
      definitions: defs
        .map((d) => ({ path: d.path, line: parseSpan(d.span)[0], symbol: symbolOf(d), kind: d.kind, exported: d.exported === true }))
        .sort((a, b) => cmp(a.path, b.path) || a.line - b.line)
    });
  }
  dups.sort((a, b) => b.files - a.files || cmp(a.name, b.name));
  return { format: "cs-dups/1", min, in: prefix, kind, dups };
}

/**
 * The text of `cs dups`, at most `DUPS_MAX_LINES` lines.
 * @param {ReturnType<typeof dupsData>} d
 * @returns {string}
 */
export function formatDups(d) {
  const out = [`dups — ${d.dups.length} names defined in ≥ ${d.min} files (kind ${d.kind}${d.in ? `, in ${d.in}` : ""})`];
  for (const x of d.dups) {
    out.push(`${x.name}  ×${x.files} files${x.hazard ? "  (hazard: cross-file callers dropped by graph)" : ""}`);
    for (const def of x.definitions) out.push(`  ${def.path}:${def.line}  ${def.symbol}  ${def.kind}${def.exported ? "  exported" : ""}`);
  }
  return capLines(`${out.join("\n")}\n`, DUPS_MAX_LINES, "narrow with --in <path> / --min N, or --json for everything");
}

/**
 * What `cs deps <path>` does not admit once the path is known to be a file: module-level flags.
 * @param {Record<string, string | true>} opts
 * @param {"file" | "dir"} kind
 * @returns {string | null}
 */
export function depsTargetError(opts, kind) {
  return kind === "file" && (opts.level || opts.cycles || opts.external) ? "deps <file>: --level, --cycles and --external need a <dir>" : null;
}
