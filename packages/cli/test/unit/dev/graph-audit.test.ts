/**
 * Graph audit (D-2, ADR-0028 п. 4): `scripts/dev/graph-audit-lib.js` builds ground truth with the TypeScript checker
 * (calls through a port resolve to the interface member and its implementations; a local const that shadows a
 * function is not a call of it; module-level calls belong to the file), scores a graph against it — a call of a shared
 * name through an explicit named import is an `ambiguous_cross_file` site — and fails the baseline gate only beyond the
 * tolerance.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildGroundTruth, checkBaseline, compareWithGraph, makeBaseline, truthCallers } from "../../../../../scripts/dev/graph-audit-lib.js";

const FIXTURE: Record<string, string> = {
  "packages/cli/src/ports.ts": [
    "export interface GitPort {",
    "  head(): string | null;",
    "}",
    "export class GitCli implements GitPort {",
    "  head(): string | null {",
    "    return null;",
    "  }",
    "}",
  ].join("\n"),
  "packages/cli/src/flow.ts": [
    'import type { GitPort } from "./ports.js";',
    'export const KEY = "PATH";',
    "export function forward(): number {",
    "  return 1;",
    "}",
    "export function runTransition(): number {",
    "  return forward();",
    "}",
    "export function readFacts(git: GitPort): string | null {",
    "  return git.head();",
    "}",
    "export function runCommand(): number {",
    "  const forward = (x: number): number => x;",
    "  return forward(2);",
    "}",
  ].join("\n"),
  "packages/cli/test/flow.test.ts": ['import { forward, KEY } from "../src/flow.js";', "forward();", "export const use = (): string => KEY;"].join("\n"),
};

/** Audit 2026-09-25 §3.3: `runVerify` imports `evaluate` by name; a test file has its own local `evaluate`. */
const NAMED_IMPORT: Record<string, string> = {
  "packages/cli/src/evaluate.ts": ["export function evaluate(): number {", "  return 1;", "}"].join("\n"),
  "packages/cli/src/verify.ts": ['import { evaluate } from "./evaluate.js";', "export function runVerify(): number {", "  return evaluate();", "}"].join("\n"),
  "packages/cli/test/verdict.test.ts": ["function evaluate(): number {", "  return 0;", "}", "evaluate();"].join("\n"),
};

const roots: string[] = [];
let gt: ReturnType<typeof buildGroundTruth>;
let gtNamed: ReturnType<typeof buildGroundTruth>;

function truthOf(fixture: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "graph-audit-"));
  roots.push(root);
  for (const [file, text] of Object.entries(fixture)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), `${text}\n`);
  }
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true, types: [] };
  return buildGroundTruth(ts, { root, files: Object.keys(fixture).sort(), options });
}

beforeAll(() => {
  gt = truthOf(FIXTURE);
  gtNamed = truthOf(NAMED_IMPORT);
});

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A graph built from the truth nodes (same ids and spans) with the given call edges. */
function graphWith(calls: [string, string][], truth = gt, fixture = FIXTURE) {
  const nodes = [
    ...Object.keys(fixture).map((f) => ({ id: f, name: path.basename(f), kind: "file", path: f, span: "L1-L99" })),
    ...truth.nodes.filter((n) => n.kind !== "const").map((n) => ({ id: n.id, name: n.name, kind: n.kind, path: n.path, span: `L${n.line}-L${n.endLine}` })),
  ];
  const edges = calls.map(([source, target]) => ({ source, target, relation: "calls" }));
  return { nodes, edges };
}

const SRC = "packages/cli/src/flow.ts";
const TEST = "packages/cli/test/flow.test.ts";

describe("graph-audit ground truth", () => {
  it("resolves a call through the port to the interface member and the implementing class", () => {
    const site = gt.calls.find((c) => c.text === "git.head");
    expect(site?.targets).toEqual([{ kind: "ifaceMember", member: "packages/cli/src/ports.ts#GitPort.head", impls: ["packages/cli/src/ports.ts#GitCli.head"] }]);
    expect(truthCallers(gt, "packages/cli/src/ports.ts#GitPort.head")).toEqual([{ file: SRC, symbol: "readFacts", caller: `${SRC}#readFacts`, lines: [10] }]);
  });

  it("does not count a local const of the same name as a call, and gives module-level calls to the file", () => {
    expect(truthCallers(gt, `${SRC}#forward`).map((c) => `${c.file}::${c.symbol}`)).toEqual([`${SRC}::runTransition`, `${TEST}::(file)`]);
  });

  it("finds reads of a module-level const only with refs", () => {
    expect(truthCallers(gt, `${SRC}#KEY`)).toEqual([]);
    expect(truthCallers(gt, `${SRC}#KEY`, { refs: true }).map((c) => `${c.file}::${c.symbol}`)).toEqual([`${TEST}::use`]);
  });
});

describe("graph-audit comparison", () => {
  it("counts a name-collision edge as false and a missed port call as a dispatch miss", () => {
    const wiring = graphWith([
      [`${SRC}#runTransition`, `${SRC}#forward`],
      [`${SRC}#runCommand`, `${SRC}#forward`],
      [TEST, `${SRC}#forward`],
    ]);
    const { metrics, classes } = compareWithGraph(wiring, gt);
    expect(metrics["calls.false_edges"].value).toBe(1);
    expect(metrics["calls.precision"]).toMatchObject({ n: 2, d: 3 });
    expect(metrics["nodes.recall"]).toMatchObject({ n: 9, d: 9 });
    expect(metrics["sites.port_dispatch"]).toMatchObject({ n: 0, d: 1 });
    expect(metrics["calls.recall.src.dispatch"]).toMatchObject({ n: 1, d: 3 }); // runTransition→forward; missed: runCommand→its local forward, readFacts→GitCli.head
    expect(classes.port_dispatch.examples[0]).toContain("git.head");
  });

  it("scores a cross-file call of a shared name through a named import in sites.ambiguous_cross_file", () => {
    const [VERIFY, EVALUATE] = ["packages/cli/src/verify.ts", "packages/cli/src/evaluate.ts"];
    expect(gtNamed.calls.find((c) => c.file === VERIFY)).toMatchObject({ name: "evaluate", importFrom: EVALUATE });
    const missed = compareWithGraph(graphWith([], gtNamed, NAMED_IMPORT), gtNamed);
    expect(missed.metrics["sites.ambiguous_cross_file"]).toMatchObject({ n: 0, d: 1 });
    expect(missed.classes.ambiguous_cross_file.examples).toEqual([`${VERIFY}:3 evaluate -> ${EVALUATE}#evaluate`]);
    const found = compareWithGraph(graphWith([[`${VERIFY}#runVerify`, `${EVALUATE}#evaluate`]], gtNamed, NAMED_IMPORT), gtNamed);
    expect(found.metrics["sites.ambiguous_cross_file"]).toMatchObject({ n: 1, d: 1 });
  });
});

describe("graph-audit baseline", () => {
  const metrics = {
    "calls.precision": { n: 99, d: 100, value: 0.99, better: "higher" },
    "calls.false_edges": { n: 11, value: 11, better: "lower", count: true },
    "snippet.not_call": { n: 30, d: 100, value: 0.3, better: "lower" },
  };
  const baseline = makeBaseline(metrics, { graft: "0.19.0", commit: "4a3c586" });

  it("sorts metric keys and records graft and commit", () => {
    expect(Object.keys(baseline.metrics)).toEqual(["calls.false_edges", "calls.precision", "snippet.not_call"]);
    expect(baseline).toMatchObject({ graft: "0.19.0", commit: "4a3c586", tolerance: { rate_pp: 0.5, count: 2 } });
  });

  it("passes within the tolerance and fails beyond it", () => {
    const within = { ...metrics, "calls.precision": { ...metrics["calls.precision"], value: 0.986 }, "calls.false_edges": { ...metrics["calls.false_edges"], value: 13 } };
    expect(checkBaseline(within, baseline)).toEqual([]);
    const worse = { ...metrics, "calls.precision": { ...metrics["calls.precision"], value: 0.984 }, "calls.false_edges": { ...metrics["calls.false_edges"], value: 14 }, "snippet.not_call": { ...metrics["snippet.not_call"], value: 0.306 } };
    expect(checkBaseline(worse, baseline).map((r) => r.metric).sort()).toEqual(["calls.false_edges", "calls.precision", "snippet.not_call"]);
  });

  it("treats an improvement and a new metric as fine, a missing one as worse", () => {
    const better = { ...metrics, "calls.precision": { ...metrics["calls.precision"], value: 1 }, "calls.false_edges": { ...metrics["calls.false_edges"], value: 0 }, "x.new": { n: 0, d: 1, value: 0, better: "higher" } };
    expect(checkBaseline(better, baseline)).toEqual([]);
    const { "snippet.not_call": _gone, ...rest } = metrics;
    expect(checkBaseline(rest, baseline)).toEqual([{ metric: "snippet.not_call", baseline: 0.3, current: null, delta: null }]);
  });
});
