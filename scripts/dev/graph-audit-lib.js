/**
 * Graph audit (D-2, ADR-0028 п. 4): the Graft code graph (`graft/.graph/wiring.json`) against ground truth from the
 * TypeScript checker, for `scripts/dev/graph-audit.js` and `packages/cli/test/unit/dev/graph-audit.test.ts`.
 *
 * Ground truth (`buildGroundTruth`): every call site in the indexed code (`packages/**`, `scripts/**` — .ts/.js)
 * resolved by the checker to its declaration; the "container" of a site is the nearest enclosing named function,
 * method or class (null — module level). A call through an interface member (a port: `ctx.git.head()`) is resolved
 * to the member and, for metrics, to the members of the classes that `implements` that interface (dispatch).
 *
 * Comparison (`compareWithGraph`): graph nodes are matched to truth nodes by path + name + start line; truth edges
 * are mapped into graph ids (a container the graph does not model is replaced by its parent, then by the file).
 * Metrics are ratios `{ n, d, value, better }` or counts; `checkBaseline` compares them with a saved baseline.
 *
 * Plain Node ESM, no dependencies: `typescript` is passed in by the caller. Dev tooling only — not in `files` of
 * package.json.
 */
import path from "node:path";

export const AUDIT_FORMAT = "graph-audit/1";
export const BASELINE_FORMAT = "graph-audit-baseline/1";
export const CODE_FILE = /\.(ts|js|mjs|cjs)$/;
export const CATEGORIES = ["src", "test", "scripts"];
/** Default tolerances: a ratio may drop by `rate_pp` percentage points, a count may grow by `count`. */
export const DEFAULT_TOLERANCE = { rate_pp: 0.5, count: 2 };

/** Files the audit covers: from `git ls-files` of packages/ and scripts/ — code only, no declaration files. */
export const auditFiles = (lsFiles) => lsFiles.filter((f) => CODE_FILE.test(f) && !f.endsWith(".d.ts")).sort();

export const categoryOf = (p) =>
  p.startsWith("scripts/") ? "scripts" : p.includes("/test/") || p.endsWith("vitest.config.ts") ? "test" : "src";

/** Compiler options: packages/cli/tsconfig.json + JavaScript, no emit; `typesRoot` — where node_modules/@types is. */
export function auditCompilerOptions(ts, root, typesRoot = root) {
  const cfgPath = path.join(root, "packages", "cli", "tsconfig.json");
  const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile).config ?? {};
  const parsed = ts.parseJsonConfigFileContent(cfg, ts.sys, path.dirname(cfgPath));
  return {
    ...parsed.options,
    allowJs: true,
    checkJs: false,
    noEmit: true,
    rootDir: undefined,
    outDir: undefined,
    types: ["node"],
    typeRoots: [path.join(typesRoot, "node_modules", "@types")],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Ground truth
// ---------------------------------------------------------------------------------------------------------------

function unwrap(ts, e) {
  while (e && (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression?.(e))) {
    e = e.expression;
  }
  return e;
}

const isFunctionValue = (ts, e) => {
  const x = unwrap(ts, e);
  return !!x && (ts.isArrowFunction(x) || ts.isFunctionExpression(x));
};

const nameText = (ts, name) => (name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : null);

/**
 * A declaration the graph can model as a node: `{ kind, name, flags }` or null. `flags` mark forms the graph may
 * miss: `propAssign` (`{ key: () => … }`), `objLit` (method of an object literal), `propArrow` (class field arrow).
 */
function declInfo(ts, n) {
  if (ts.isFunctionDeclaration(n) && n.name) return { kind: "function", name: n.name.text, flags: [] };
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && isFunctionValue(ts, n.initializer)) return { kind: "function", name: n.name.text, flags: [] };
  if (ts.isClassDeclaration(n) && n.name) return { kind: "class", name: n.name.text, flags: [] };
  if (ts.isMethodDeclaration(n) && nameText(ts, n.name)) {
    return { kind: "method", name: nameText(ts, n.name), flags: ts.isObjectLiteralExpression(n.parent) ? ["objLit"] : [] };
  }
  if (ts.isConstructorDeclaration(n)) return { kind: "method", name: "constructor", flags: [] };
  if ((ts.isGetAccessor(n) || ts.isSetAccessor(n)) && ts.isIdentifier(n.name)) return { kind: "method", name: n.name.text, flags: ["accessor"] };
  if (ts.isPropertyDeclaration(n) && ts.isIdentifier(n.name) && isFunctionValue(ts, n.initializer)) return { kind: "method", name: n.name.text, flags: ["propArrow"] };
  if (ts.isPropertyAssignment(n) && nameText(ts, n.name) && isFunctionValue(ts, n.initializer)) {
    return { kind: "function", name: nameText(ts, n.name), flags: ["propAssign"] };
  }
  if (ts.isInterfaceDeclaration(n)) return { kind: "interface", name: n.name.text, flags: [] };
  if (ts.isTypeAliasDeclaration(n)) return { kind: "type", name: n.name.text, flags: [] };
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.parent?.parent && ts.isVariableStatement(n.parent.parent) && ts.isSourceFile(n.parent.parent.parent)) {
    return { kind: "const", name: n.name.text, flags: [] }; // module-level value; the graph has no such nodes
  }
  return null;
}

/** Kinds that never enclose a call site: a call in an initializer belongs to the enclosing function or the module. */
const NOT_CONTAINER = new Set(["interface", "type", "const"]);

function isExported(ts, n) {
  const d = ts.isVariableDeclaration(n) ? n.parent?.parent : n;
  return !!(d && ts.canHaveModifiers?.(d) && ts.getModifiers(d)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

/**
 * Ground truth for `files` (paths relative to `root`, forward slashes).
 * Returns `{ files, nodes, calls, refs, imports }`:
 * - nodes: `{ id: "<path>#<Qual.name>", path, name, kind, line, endLine, exported, cat, flags, depth }`, kind —
 *   function, method, class, interface, type or const (module-level value, not compared with the graph);
 * - calls: one per call or `new` site — `{ file, cat, line, isNew, form, text, name, caller, callerChain, targets, … }`,
 *   `caller` — id of the nearest enclosing function/method/class node or null (module level), `callerChain` — all
 *   enclosing ones, innermost first; `targets` — `{ kind: "node", id }`, `{ kind: "ifaceMember", member, impls }`
 *   (`member` = "<path>#<Interface>.<name>") or `{ kind: "external" | "local" | … }`;
 * - refs: a function, method or class used as a value (callback) or a module-level const read,
 *   `{ file, line, caller, target }`;
 * - imports: `{ from, to, spec, kind }` with `to` = in-scope file or null.
 */
export function buildGroundTruth(ts, { root, files, options }) {
  const fileSet = new Set(files);
  const program = ts.createProgram(
    files.map((f) => path.join(root, f)),
    options,
  );
  const checker = program.getTypeChecker();
  const rel = (fileName) => path.relative(root, fileName).split(path.sep).join("/");
  const inScope = (fileName) => fileSet.has(rel(fileName));
  const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const sourceFiles = program.getSourceFiles().filter((sf) => inScope(sf.fileName));

  // ---- nodes -------------------------------------------------------------------------------------------------
  const nodes = [];
  const nodeOfDecl = new Map(); // declaration AST node -> node record (functions, classes, methods, interfaces, types)
  for (const sf of sourceFiles) {
    const p = rel(sf.fileName);
    const seen = new Map(); // same qualified name twice in a file (two local `visit`): `visit`, `visit~2`, … as in Graft
    const visit = (n, qual) => {
      const info = declInfo(ts, n);
      let inner = qual;
      if (info) {
        const q = [...qual, info.name];
        const k = seen.get(q.join(".")) ?? 0;
        seen.set(q.join("."), k + 1);
        if (k > 0) q[q.length - 1] += `~${k + 1}`;
        const rec = {
          id: `${p}#${q.join(".")}`,
          path: p,
          name: info.name,
          kind: info.kind,
          line: lineOf(sf, n.getStart(sf)),
          endLine: lineOf(sf, n.getEnd()),
          exported: isExported(ts, n),
          cat: categoryOf(p),
          flags: info.flags,
          depth: q.length,
        };
        nodes.push(rec);
        nodeOfDecl.set(n, rec);
        if (!NOT_CONTAINER.has(info.kind)) inner = q;
      }
      ts.forEachChild(n, (c) => visit(c, inner));
    };
    visit(sf, []);
  }

  // ---- explicit `implements` / `extends`: interface or base symbol -> classes --------------------------------
  const resolveAlias = (s) => {
    for (let i = 0; s && s.flags & ts.SymbolFlags.Alias && i < 10; i++) {
      try {
        s = checker.getAliasedSymbol(s);
      } catch {
        break;
      }
    }
    return s;
  };
  const implementors = new Map();
  for (const sf of sourceFiles) {
    const visit = (n) => {
      if (ts.isClassDeclaration(n) && n.heritageClauses) {
        for (const h of n.heritageClauses) {
          for (const t of h.types) {
            const s = resolveAlias(checker.getSymbolAtLocation(t.expression));
            if (s) implementors.set(s, [...(implementors.get(s) ?? []), n]);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  const containers = (n) => {
    const out = [];
    for (let a = n.parent; a && !ts.isSourceFile(a); a = a.parent) {
      const r = nodeOfDecl.get(a);
      if (r && !NOT_CONTAINER.has(r.kind)) out.push(r.id);
    }
    return out;
  };

  /** What a declaration is, from the point of view of a call that resolves to it. */
  function classify(decl) {
    const sf = decl.getSourceFile();
    if (!inScope(sf.fileName)) return { kind: "external" };
    const r = nodeOfDecl.get(decl);
    if (r) return { kind: "node", id: r.id };
    if ((ts.isMethodSignature(decl) || ts.isPropertySignature(decl)) && ts.isInterfaceDeclaration(decl.parent)) {
      const iface = decl.parent;
      const member = nameText(ts, decl.name);
      const impls = [];
      for (const cls of implementors.get(checker.getSymbolAtLocation(iface.name)) ?? []) {
        for (const m of cls.members) {
          if (nameText(ts, m.name) === member && nodeOfDecl.get(m)) impls.push(nodeOfDecl.get(m).id);
        }
      }
      return { kind: "ifaceMember", member: `${rel(sf.fileName)}#${iface.name.text}.${member}`, impls };
    }
    if (ts.isPropertySignature(decl)) return { kind: "typeLiteralMember" };
    if (ts.isParameter(decl) || ts.isBindingElement(decl) || ts.isVariableDeclaration(decl)) return { kind: "local" };
    if (ts.isPropertyAssignment(decl) || ts.isShorthandPropertyAssignment(decl) || ts.isPropertyDeclaration(decl)) return { kind: "property" };
    return { kind: `other:${ts.SyntaxKind[decl.kind]}` };
  }

  function targetsOf(nameNode, receiver) {
    const s = checker.getSymbolAtLocation(nameNode);
    let symbols = s ? [resolveAlias(s)] : [];
    if (!s && receiver) {
      // a member of a union receiver has no single symbol: take the member of every constituent
      const t = checker.getTypeAtLocation(receiver);
      symbols = (t.isUnion() ? t.types : [t]).map((x) => x.getProperty(nameNode.text)).filter(Boolean);
    }
    const out = symbols.flatMap((sym) => (sym.declarations?.length ? sym.declarations.map(classify) : [{ kind: "noDeclaration" }]));
    return out.length ? out : [{ kind: "unresolved" }];
  }

  // ---- imports: resolved once per (file, specifier) -----------------------------------------------------------
  const host = ts.createCompilerHost(options);
  const cache = ts.createModuleResolutionCache(root, (x) => x, options);
  const resolveModule = (spec, fromFile) => {
    const r = ts.resolveModuleName(spec, path.join(root, fromFile), options, host, cache).resolvedModule;
    return r && inScope(r.resolvedFileName) ? rel(r.resolvedFileName) : null;
  };

  // ---- call sites, value references, imports ------------------------------------------------------------------
  const calls = [];
  const refs = [];
  const imports = [];
  const nodeById = new Map(nodes.map((x) => [x.id, x]));
  const isCallee = (n) => (ts.isCallExpression(n.parent) || ts.isNewExpression(n.parent)) && n.parent.expression === n;
  const isValuePosition = (n) =>
    !isCallee(n) &&
    !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n && isCallee(n.parent)) &&
    !ts.isImportSpecifier(n.parent) &&
    !ts.isExportSpecifier(n.parent) &&
    !ts.isImportClause(n.parent) &&
    !(declInfo(ts, n.parent) && n.parent.name === n) &&
    !ts.isTypeReferenceNode(n.parent) &&
    !ts.isExpressionWithTypeArguments(n.parent) &&
    !ts.isTypeQueryNode(n.parent) &&
    !ts.isQualifiedName(n.parent);

  for (const sf of sourceFiles) {
    const p = rel(sf.fileName);
    const visit = (n) => {
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) calls.push(callSite(sf, p, n));
      if (ts.isIdentifier(n) && isValuePosition(n)) {
        const s = resolveAlias(checker.getSymbolAtLocation(n));
        for (const d of s?.declarations ?? []) {
          const c = classify(d);
          const tgt = c.kind === "node" ? nodeById.get(c.id) : null;
          if (tgt && tgt.kind !== "interface" && tgt.kind !== "type") {
            const chain = containers(n);
            refs.push({ file: p, cat: categoryOf(p), line: lineOf(sf, n.getStart(sf)), name: n.text, caller: chain[0] ?? null, callerChain: chain, target: c.id });
          }
        }
      }
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
        const kind = ts.isExportDeclaration(n) ? "reexport" : n.importClause?.isTypeOnly ? "typeOnly" : "static";
        imports.push({ from: p, spec: n.moduleSpecifier.text, kind, line: lineOf(sf, n.getStart(sf)) });
      }
      if (ts.isCallExpression(n) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
        if (n.expression.kind === ts.SyntaxKind.ImportKeyword) imports.push({ from: p, spec: n.arguments[0].text, kind: "dynamic", line: lineOf(sf, n.getStart(sf)) });
        if (ts.isIdentifier(n.expression) && n.expression.text === "require") imports.push({ from: p, spec: n.arguments[0].text, kind: "require", line: lineOf(sf, n.getStart(sf)) });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  for (const im of imports) im.to = resolveModule(im.spec, im.from);

  function callSite(sf, p, n) {
    const e = unwrap(ts, n.expression);
    let nameNode = null;
    let receiver = null;
    let form = "other";
    if (e && ts.isIdentifier(e)) [nameNode, form] = [e, "ident"];
    else if (e && ts.isPropertyAccessExpression(e)) [nameNode, receiver, form] = [e.name, e.expression, "prop"];
    else if (e?.kind === ts.SyntaxKind.ImportKeyword) form = "dynamicImport";
    else if (e?.kind === ts.SyntaxKind.SuperKeyword) form = "super";
    const chain = containers(n);
    const site = {
      file: p,
      cat: categoryOf(p),
      line: lineOf(sf, n.getStart(sf)),
      isNew: ts.isNewExpression(n),
      form,
      text: e ? e.getText(sf).replace(/\s+/g, " ").slice(0, 80) : "",
      name: nameNode ? nameNode.text : null,
      caller: chain[0] ?? null,
      callerChain: chain,
      targets: nameNode ? targetsOf(nameNode, receiver) : [{ kind: form }],
    };
    if (nameNode) {
      const raw = checker.getSymbolAtLocation(nameNode);
      const d = raw && raw.flags & ts.SymbolFlags.Alias ? raw.declarations?.[0] : null;
      if (d && ts.isImportSpecifier(d) && d.propertyName) site.renamed = true;
      if (d && ts.isImportClause(d)) site.defaultImport = true;
      const decl = d && (ts.isImportSpecifier(d) ? d.parent.parent.parent : ts.isImportClause(d) ? d.parent : null);
      if (decl?.moduleSpecifier) site.importFrom = resolveModule(decl.moduleSpecifier.text, p);
      if (receiver && ts.isIdentifier(receiver)) {
        const rs = checker.getSymbolAtLocation(receiver);
        if (rs && rs.flags & ts.SymbolFlags.Alias && rs.declarations?.[0] && ts.isNamespaceImport(rs.declarations[0])) site.namespaceImport = true;
      }
    }
    return site;
  }

  return { files: [...files], nodes, calls, refs, imports };
}

// ---------------------------------------------------------------------------------------------------------------
// Callers from the truth (benchmark answers)
// ---------------------------------------------------------------------------------------------------------------

/**
 * True callers of `target` — a node id (`<path>#<Qual.name>`) or an interface member (`<path>#<Interface>.<name>`):
 * one entry per enclosing named function (`symbol` = its last name segment) or `"(file)"` for module-level sites.
 * With `{ refs: true }` value references (callbacks) count too.
 */
export function truthCallers(gt, target, { refs = false } = {}) {
  const hits = (c) => c.targets.some((t) => (t.kind === "node" && t.id === target) || (t.kind === "ifaceMember" && t.member === target));
  const sites = gt.calls.filter(hits).map((c) => ({ ...c, via: "call" }));
  if (refs) sites.push(...gt.refs.filter((r) => r.target === target).map((r) => ({ ...r, via: "ref" })));
  const byKey = new Map();
  for (const s of sites) {
    const symbol = s.caller ? s.caller.split("#")[1].split(".").pop().replace(/~d+$/, "") : "(file)";
    const key = `${s.file}::${symbol}`;
    const row = byKey.get(key) ?? { file: s.file, symbol, caller: s.caller ?? s.file, lines: [] };
    row.lines.push(s.via === "ref" ? `${s.line}(ref)` : s.line);
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => (a.file === b.file ? a.symbol.localeCompare(b.symbol) : a.file < b.file ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------------------------
// Comparison with the graph
// ---------------------------------------------------------------------------------------------------------------

const ratio = (n, d, better = "higher") => ({ n, d, value: d ? Math.round((n / d) * 10000) / 10000 : null, better });
const count = (n) => ({ n, value: n, better: "lower", count: true });
const pathOf = (id) => id.split("#")[0];
const startLine = (graphNode) => Number(/^L(\d+)/.exec(graphNode.span)?.[1] ?? 0);

/** Graph node id for every truth node id (by path + name + start line, else the nearest line), and back. */
export function matchNodes(graphNodes, truthNodes) {
  const byLine = new Map(truthNodes.map((t) => [`${t.path}|${t.name}|${t.line}`, t]));
  const byName = new Map();
  for (const t of truthNodes) byName.set(`${t.path}|${t.name}`, [...(byName.get(`${t.path}|${t.name}`) ?? []), t]);
  const toGraph = new Map();
  const toTruth = new Map();
  for (const g of graphNodes) {
    let t = byLine.get(`${g.path}|${g.name}|${startLine(g)}`);
    if (!t || toGraph.has(t.id)) {
      const free = (byName.get(`${g.path}|${g.name}`) ?? []).filter((x) => !toGraph.has(x.id));
      t = free.sort((a, b) => Math.abs(a.line - startLine(g)) - Math.abs(b.line - startLine(g)))[0];
    }
    if (t) {
      toGraph.set(t.id, g.id);
      toTruth.set(g.id, t);
    }
  }
  return { toGraph, toTruth };
}

/** Receiver shape of a member call `a.b.m()`: `this`, `this.field`, a plain identifier or anything longer. */
function receiverShape(site) {
  const recv = site.text.split(".").slice(0, -1).join(".");
  if (recv === "this") return "this";
  if (/^this\.[\w$]+$/.test(recv)) return "thisField";
  if (/^[A-Za-z_$][\w$]*$/.test(recv)) return "ident";
  return "chained";
}

/**
 * Metrics of `wiring` (graft/.graph/wiring.json) against `gt` (buildGroundTruth). `readLines(path)` returns the
 * source lines of a file (for the snippet metric). Returns `{ metrics, classes, examples }`.
 */
export function compareWithGraph(wiring, gt, { readLines } = {}) {
  const graphNodes = wiring.nodes.filter((n) => n.kind !== "file");
  const graphById = new Map(wiring.nodes.map((n) => [n.id, n]));
  const truthNodes = gt.nodes.filter((t) => t.kind !== "const");
  const { toGraph, toTruth } = matchNodes(graphNodes, truthNodes);
  const fileSet = new Set(gt.files);
  const graphCaller = (site) => {
    for (const id of site.callerChain) if (toGraph.has(id)) return toGraph.get(id);
    return site.file;
  };
  const edgeKey = (s, t) => `${s} -> ${t}`;
  const catOfKey = (k) => categoryOf(pathOf(k.split(" -> ")[0]));

  const graphCalls = wiring.edges.filter((e) => e.relation === "calls");
  const graphRefs = wiring.edges.filter((e) => e.relation === "references");
  const callSet = new Set(graphCalls.map((e) => edgeKey(e.source, e.target)));
  const refSet = new Set(graphRefs.map((e) => edgeKey(e.source, e.target)));

  // ---- truth edges in graph ids ----
  const direct = new Map(); // key -> sites, calls resolved to a node (excluding `new Class()`)
  const newClass = new Map(); // key -> sites, `new Class()`
  const dispatch = new Map(); // key -> sites, interface member -> implementing class member
  const add = (m, k, s) => m.set(k, [...(m.get(k) ?? []), s]);
  for (const c of gt.calls) {
    const src = graphCaller(c);
    for (const t of c.targets) {
      if (t.kind === "node" && toGraph.has(t.id)) {
        const k = edgeKey(src, toGraph.get(t.id));
        if (c.isNew && toTruth.get(toGraph.get(t.id))?.kind === "class") add(newClass, k, c);
        else add(direct, k, c);
      } else if (t.kind === "ifaceMember") {
        for (const impl of t.impls) if (toGraph.has(impl)) add(dispatch, edgeKey(src, toGraph.get(impl)), c);
      }
    }
  }
  const valueRefs = new Set(gt.refs.filter((r) => toGraph.has(r.target)).map((r) => edgeKey(graphCaller(r), toGraph.get(r.target))));
  const anyTruth = (k) => direct.has(k) || newClass.has(k) || dispatch.has(k) || valueRefs.has(k);

  const metrics = {};

  // ---- nodes ----
  metrics["nodes.recall"] = ratio(truthNodes.filter((t) => toGraph.has(t.id)).length, truthNodes.length);

  // ---- call edges ----
  const falseEdges = graphCalls.filter((e) => !anyTruth(edgeKey(e.source, e.target)));
  metrics["calls.precision"] = ratio(graphCalls.length - falseEdges.length, graphCalls.length);
  metrics["calls.false_edges"] = count(falseEdges.length);
  for (const cat of CATEGORIES) {
    const d = [...direct.keys()].filter((k) => catOfKey(k) === cat);
    const all = [...new Set([...d, ...[...dispatch.keys()].filter((k) => catOfKey(k) === cat)])];
    metrics[`calls.recall.${cat}.direct`] = ratio(d.filter((k) => callSet.has(k)).length, d.length);
    if (cat !== "scripts") metrics[`calls.recall.${cat}.dispatch`] = ratio(all.filter((k) => callSet.has(k)).length, all.length);
  }

  // ---- imports ----
  const truthImports = new Set(gt.imports.filter((i) => i.to).map((i) => edgeKey(i.from, i.to)));
  const graphImports = new Set(wiring.edges.filter((e) => e.relation === "imports" && fileSet.has(e.target)).map((e) => edgeKey(e.source, e.target)));
  metrics["imports.recall"] = ratio([...truthImports].filter((k) => graphImports.has(k)).length, truthImports.size);
  metrics["imports.false_edges"] = count([...graphImports].filter((k) => !truthImports.has(k)).length);

  // ---- per-target completeness of `cs callers <target> -d 1` (graph in-edges: calls + references) ----
  const truthIn = new Map();
  for (const k of [...direct.keys(), ...newClass.keys(), ...dispatch.keys()]) {
    const [s, t] = k.split(" -> ");
    truthIn.set(t, (truthIn.get(t) ?? new Set()).add(s));
  }
  const graphIn = new Map();
  for (const e of [...graphCalls, ...graphRefs]) graphIn.set(e.target, (graphIn.get(e.target) ?? new Set()).add(e.source));
  for (const cat of CATEGORIES) {
    const targets = [...truthIn.keys()].filter((t) => toTruth.get(t)?.cat === cat);
    const complete = targets.filter((t) => [...truthIn.get(t)].every((s) => graphIn.get(t)?.has(s)));
    metrics[`callers.complete.${cat}`] = ratio(complete.length, targets.length);
  }

  // ---- site classes: how often the graph has the edge for one kind of call site ----
  const nameCount = new Map();
  for (const n of graphNodes) nameCount.set(n.name, (nameCount.get(n.name) ?? 0) + 1);
  const classes = {};
  const bump = (cls, hit, site, target) => {
    const r = (classes[cls] ??= { sites: 0, hit: 0, examples: [] });
    r.sites++;
    if (hit) r.hit++;
    else if (r.examples.length < 3) r.examples.push(`${site.file}:${site.line} ${site.text} -> ${target}`);
  };
  for (const c of gt.calls) {
    const src = graphCaller(c);
    for (const t of c.targets) {
      const tgts = t.kind === "node" ? [toGraph.get(t.id)] : t.kind === "ifaceMember" ? t.impls.map((i) => toGraph.get(i)) : [];
      for (const tg of tgts.filter(Boolean)) {
        const tn = toTruth.get(tg);
        const hit = callSet.has(edgeKey(src, tg)) || (c.isNew && refSet.has(edgeKey(src, tg)));
        let cls;
        if (t.kind === "ifaceMember") cls = "port_dispatch";
        else if (c.isNew) cls = "new_class";
        else if (c.form === "ident") cls = (nameCount.get(tn.name) ?? 0) > 1 ? (tn.path === c.file ? "ambiguous_same_file" : "ambiguous_cross_file") : "unique_name";
        else if (c.namespaceImport) cls = "namespace_import";
        else {
          const shape = receiverShape(c);
          cls = shape === "ident" && tn.flags.includes("objLit") ? "receiver_object_literal" : `receiver_${shape}`;
        }
        bump(cls, hit, c, tg);
      }
    }
  }
  for (const cls of ["port_dispatch", "ambiguous_cross_file", "receiver_ident", "receiver_chained", "new_class"]) {
    metrics[`sites.${cls}`] = ratio(classes[cls]?.hit ?? 0, classes[cls]?.sites ?? 0);
  }
  metrics["refs.value"] = ratio([...valueRefs].filter((k) => refSet.has(k) || callSet.has(k)).length, valueRefs.size);

  // ---- snippet: the line `cs callers` prints under a caller is the first textual occurrence of the callee name
  // in the caller's span (checked on the audit prototype); count true edges where that line is not a call site.
  if (readLines) {
    const callLines = new Map();
    for (const c of gt.calls) if (c.name) callLines.set(`${c.file}|${c.name}`, (callLines.get(`${c.file}|${c.name}`) ?? new Set()).add(c.line));
    let n = 0;
    let bad = 0;
    for (const e of graphCalls) {
      const s = graphById.get(e.source);
      const t = graphById.get(e.target);
      if (!s || !t || !anyTruth(edgeKey(e.source, e.target))) continue;
      const [a, b] = (s.span.match(/\d+/g) ?? []).map(Number);
      const lines = readLines(s.path);
      const re = new RegExp(`(^|[^\\w$])${t.name.replace(/[$]/g, "\\$")}([^\\w$]|$)`);
      let first = null;
      for (let i = a; i <= b && first === null; i++) if (re.test(lines[i - 1] ?? "")) first = i;
      if (first === null) continue;
      n++;
      if (!callLines.get(`${s.path}|${t.name}`)?.has(first)) bad++;
    }
    metrics["snippet.not_call"] = ratio(bad, n, "lower");
  }

  const examples = {
    falseEdges: falseEdges.map((e) => {
      const name = graphById.get(e.target)?.name;
      const sites = gt.calls.filter((c) => graphCaller(c) === e.source && c.name === name);
      const why = sites.length ? [...new Set(sites.flatMap((c) => c.targets.map((t) => t.kind)))].join("+") : "no call of that name";
      return `${e.source} -> ${e.target} [${why}]`;
    }),
    missedNodes: truthNodes.filter((t) => !toGraph.has(t.id)).map((t) => `${t.path}:${t.line} ${t.kind} ${t.name}${t.flags.length ? ` [${t.flags}]` : ""}`),
  };
  return { metrics, classes, examples };
}

// ---------------------------------------------------------------------------------------------------------------
// Baseline gate
// ---------------------------------------------------------------------------------------------------------------

/** Baseline document for the current metrics. */
export function makeBaseline(metrics, { graft, commit, tolerance = DEFAULT_TOLERANCE }) {
  const sorted = Object.fromEntries(
    Object.keys(metrics)
      .sort()
      .map((k) => [k, metrics[k]]),
  );
  return { format: BASELINE_FORMAT, graft, commit, tolerance, metrics: sorted };
}

/**
 * Regressions of `metrics` against `baseline`: a ratio worse by more than `tolerance.rate_pp` percentage points, a
 * count worse by more than `tolerance.count`, or a baseline metric that is missing now.
 * Returns `[{ metric, baseline, current, delta }]`, empty when nothing got worse.
 */
export function checkBaseline(metrics, baseline) {
  const tol = { ...DEFAULT_TOLERANCE, ...(baseline.tolerance ?? {}) };
  const out = [];
  for (const [key, base] of Object.entries(baseline.metrics ?? {})) {
    const cur = metrics[key];
    if (!cur || cur.value === null || cur.value === undefined) {
      if (base.value !== null) out.push({ metric: key, baseline: base.value, current: null, delta: null });
      continue;
    }
    if (base.value === null) continue;
    const sign = base.better === "lower" ? -1 : 1; // positive delta = better
    const delta = sign * (cur.value - base.value);
    const allowed = base.count ? tol.count : tol.rate_pp / 100;
    if (delta < -allowed - 1e-9) out.push({ metric: key, baseline: base.value, current: cur.value, delta: cur.value - base.value });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Text report
// ---------------------------------------------------------------------------------------------------------------

const show = (m) => (!m ? "—" : m.count ? String(m.value) : m.value === null ? "n/a" : `${(m.value * 100).toFixed(1)}%`);

/** Plain-text table: metric, value, n/d, baseline and verdict per metric; then site classes. */
export function formatReport({ metrics, classes }, { baseline, regressions = [] } = {}) {
  const bad = new Set(regressions.map((r) => r.metric));
  const rows = Object.keys(metrics)
    .sort()
    .map((k) => {
      const m = metrics[k];
      const b = baseline?.metrics?.[k];
      return [k, show(m), m.count ? "" : `${m.n}/${m.d}`, baseline ? show(b) : "", baseline ? (bad.has(k) ? "WORSE" : "ok") : "", m.better === "lower" ? "(lower is better)" : ""];
    });
  for (const r of regressions.filter((x) => !metrics[x.metric])) rows.push([r.metric, "missing", "", show(baseline.metrics[r.metric]), "WORSE", ""]);
  const width = rows.reduce((w, r) => r.map((c, i) => Math.max(w[i] ?? 0, c.length)), []);
  const line = (r) => r.map((c, i) => (i === 0 ? c.padEnd(width[i]) : c.padStart(width[i]))).join("  ").trimEnd();
  const out = [line(["metric", "value", "n/d", baseline ? "baseline" : "", baseline ? "" : "", ""]), ...rows.map(line)];
  out.push("", "call sites by class (graph has the edge / sites):");
  for (const [k, v] of Object.entries(classes).sort()) out.push(`  ${k.padEnd(26)} ${String(v.hit).padStart(5)}/${String(v.sites).padEnd(5)}${v.examples[0] ? `  e.g. ${v.examples[0]}` : ""}`);
  return out.join("\n");
}
