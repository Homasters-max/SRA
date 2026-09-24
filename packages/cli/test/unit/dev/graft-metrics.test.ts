/**
 * Graft experiment metrics (ADR-0026, ADR-0027): `scripts/dev/graft-metrics-lib.js` counts a transcript once per API
 * response and once per tool call, measures the bytes pulled in while exploring, tells `cs.js` calls from raw graft and
 * from plain shell exploration, counts deviations from the code-search procedure without the false positives seen on
 * change test-levels (heredoc writes, `sed -i`, JSON, node_modules, file listing), merges the parts of a split group,
 * and scores the code-search benchmark.
 */
import { describe, expect, it } from "vitest";

import {
  buildBenchReport,
  buildReport,
  buildRun,
  closedGroups,
  csCalls,
  deviationsOf,
  extractAnswer,
  isShellSearch,
  isShellWrite,
  MAX_DEVIATIONS,
  mergeParts,
  modeOf,
  parseTranscript,
  rawGraftCalls,
  scoreAnswer,
} from "../../../../../scripts/dev/graft-metrics-lib.js";

const usage = (input: number, output: number) => ({ input_tokens: input, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: output });
const bash = (id: string, command: string) => ({ type: "tool_use", id, name: "Bash", input: { command } });
const tool = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name, input });
const result = (id: string, text: string) => JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: text }] } });

function line(ts: string, msgId: string, content: unknown[], u = usage(1, 5)): string {
  return JSON.stringify({ type: "assistant", timestamp: ts, message: { id: msgId, usage: u, content } });
}

const transcript = [
  JSON.stringify({ type: "user", timestamp: "2026-09-24T10:00:00.000Z", message: { content: "go" } }),
  // one response split over two lines: usage counted once
  line("2026-09-24T10:00:05.000Z", "m1", [{ type: "text", text: "look" }]),
  line("2026-09-24T10:00:05.000Z", "m1", [bash("t1", "cd /d/project/SRA-graft && cat docs/04-lifecycle.md")]),
  result("t1", "a".repeat(100)),
  line("2026-09-24T10:00:09.000Z", "m2", [bash("t2", "node scripts/dev/cs.js callers evaluateGates -d 2"), tool("t3", "Read", { file_path: "D:/x/packages/cli/src/a.ts", offset: 10, limit: 20 })]),
  line("2026-09-24T10:00:09.000Z", "m2", [bash("t2", "node scripts/dev/cs.js callers evaluateGates -d 2")]), // duplicate tool_use
  result("t2", "b".repeat(40)),
  result("t3", "c".repeat(30)),
  line("2026-09-24T10:00:30.000Z", "m3", [tool("t5", "Edit", { file_path: "D:/x/packages/cli/src/a.ts" })]),
  result("t5", "ok"),
  line("2026-09-24T10:01:00.000Z", "m4", [tool("t6", "Read", { file_path: "D:/x/packages/cli/src/b.ts", offset: 1, limit: 5 })]),
  result("t6", "d".repeat(7)),
  line("2026-09-24T10:01:40.000Z", "m5", [bash("t4", "npm test 2>&1 | tail -5")], usage(2, 7)),
  result("t4", "e".repeat(50)),
  "not json",
].join("\n");

describe("graft-metrics", () => {
  it("counts usage per response, tools per tool_use id, and explore bytes before and after the first edit", () => {
    const m = parseTranscript(transcript);
    expect(m.requests).toBe(5);
    expect(m.tokens).toMatchObject({ input: 6, output: 27, cache_creation: 50, cache_read: 500, total: 583, context_peak: 112 });
    expect(m.tool_calls).toMatchObject({ total: 6, read_like: 2, shell_search: 1, graft: 1, raw_graft: 0 });
    expect(m.ingest).toEqual({ explore_bytes: 177, cs_bytes: 40, explore_before_edit_bytes: 170, results_bytes: 229 });
    expect(m.window).toEqual({ start: "2026-09-24T10:00:00.000Z", end: "2026-09-24T10:01:40.000Z", duration_s: 100 });
    expect(m.deviations).toEqual([]);
  });

  it("tells cs.js calls, raw graft, shell exploration and shell writes apart", () => {
    expect(csCalls('node "D:/project/SRA-graft/scripts/dev/cs.js" ask "q" --source')).toEqual(["ask"]);
    expect(rawGraftCalls("node scripts/dev/cs.js grep foo")).toEqual([]);
    expect(rawGraftCalls("cd /d/project/SRA-graft && npx -y @nanonets/graft ask 'q'")).toEqual(["ask"]);
    expect(isShellSearch("cd /d/x && sed -n 1,20p f.ts")).toBe(true);
    expect(isShellSearch("npm test 2>&1 | tail -5")).toBe(false);
    expect(isShellWrite("cat > a.ts <<'EOF'\nx\nEOF")).toBe(true);
    expect(isShellWrite("sed -i s/a/b/ package.json")).toBe(true);
    expect(isShellWrite("node x.js > /dev/null 2>&1")).toBe(false);
  });

  it("counts real deviations from the code-search procedure", () => {
    expect(deviationsOf(tool("a", "Grep", { pattern: "x", path: "packages/cli/src" }))).toEqual(["Grep over code"]);
    expect(deviationsOf(tool("c", "Read", { file_path: "D:/x/packages/cli/src/core/check/lock.ts" }))).toEqual(["whole read check/lock.ts"]);
    expect(deviationsOf(bash("e", "cd /d/x && grep -rn acquireLock packages/cli/src"))).toEqual(["shell search over code"]);
    expect(deviationsOf(bash("e2", "git grep -n foo packages/cli/src"))).toEqual(["shell search over code"]);
    expect(deviationsOf(bash("e3", 'grep -n "^export" packages/cli/test/helpers/x.ts'))).toEqual(["shell search over code"]);
    expect(deviationsOf(bash("f", "cat packages/cli/src/a.ts"))).toEqual(["shell whole read of code"]);
    expect(deviationsOf(bash("h", "graft callers foo"))).toEqual(["raw graft callers"]);
  });

  it("does not count writes, data files, node_modules, listing or output filters (test-levels false positives)", () => {
    const clean = [
      tool("b", "Grep", { pattern: "x", path: "docs" }),
      tool("b2", "Glob", { pattern: "packages/**/*.ts" }),
      tool("d", "Read", { file_path: "D:/x/docs/adr/README.md" }),
      bash("g", "sed -n 10,40p packages/cli/src/a.ts"),
      bash("i", "node scripts/dev/cs.js grep foo | grep -v test"),
      bash("j", "cd /d/x/packages/cli/test && cat > unit/tmp-spawn.test.ts <<'EOF'\nimport { spawnSync } from \"node:child_process\";\ncat packages/cli/src/a.ts\nEOF"),
      bash("k", "cd /d/x && sed -i '3s/0.4.0/0.4.1/' package.json && grep -n version packages/cli/package.json"),
      bash("l", "cd /d/x/node_modules/vitest/dist && grep -n groupOrder chunks/reporters.d.ts"),
      bash("m", 'cd /d/x/packages/cli && find test -name "*.test.ts" | wc -l; ls test/unit/*/'),
      bash("n", "npm test 2>&1 | tail -20"),
      bash("o", "grep -rn foo docs"),
    ];
    for (const block of clean) expect(deviationsOf(block), JSON.stringify(block.input)).toEqual([]);
  });

  it("reads the blind arm label; ON keeps deviations, OFF may not use graft", () => {
    expect(modeOf("test-levels group 3 [A]")).toBe("on");
    expect(modeOf("bench q4 [B]")).toBe("off");
    expect(modeOf("phase-3b group 1: docs")).toBeNull();
    const metrics = parseTranscript(transcript);
    expect(buildRun({ change: "c", group: 2, mode: "off", agent: {}, metrics, card: {} }).violations).toEqual(["graft used in an OFF run"]);
    const many = { ...metrics, deviations: Array.from({ length: MAX_DEVIATIONS + 1 }, () => "Grep over code") };
    expect(buildRun({ change: "c", group: 1, mode: "on", agent: {}, metrics: many, card: {} }).compliant).toBe(false);
  });

  it("merges the parts of a split group into one run", () => {
    const m = parseTranscript(transcript);
    const p1 = buildRun({ change: "c", group: 5, part: 1, mode: "on", agent: {}, metrics: m, card: { red_runs: 1, notes: "one" } });
    const p2 = buildRun({ change: "c", group: 5, part: 2, mode: "on", agent: {}, metrics: m, card: { red_runs: 0, notes: "two" } });
    const [merged] = mergeParts([p2, p1]);
    expect(merged.parts).toBe(2);
    expect(merged.tokens.total).toBe(2 * m.tokens.total);
    expect(merged.tokens.context_peak).toBe(m.tokens.context_peak);
    expect(merged.ingest.explore_bytes).toBe(2 * m.ingest.explore_bytes);
    expect(merged.tool_calls.by_name.Read).toBe(4);
    expect(merged.card).toMatchObject({ red_runs: 1, notes: "one; two" });
  });

  it("finds groups whose every box is ticked", () => {
    const md = "## 1. A\n\n- [x] 1.1 a\n- [x] 1.2 b\n\n## 2. B\n\n- [x] 2.1 a\n- [ ] 2.2 b\n\n## 3. C\n\n- [ ] 3.1 a\n";
    expect(closedGroups(md)).toEqual([1]);
  });

  it("gives the field verdict by explore bytes with ≥ 2 counted runs per arm", () => {
    const run = (mode: string, group: number, explore: number, card = {}, deviations: string[] = []) => ({
      ...buildRun({ change: "c", group, mode, agent: {}, metrics: { ...parseTranscript(""), deviations }, card }),
      ingest: { explore_bytes: explore, cs_bytes: 0, explore_before_edit_bytes: explore, results_bytes: explore },
    });
    const off = [run("off", 2, 100), run("off", 4, 100)];
    expect(buildReport([run("on", 1, 70), ...off]).verdict).toBe("insufficient");

    const accept = buildReport([run("on", 1, 70), run("on", 3, 80), ...off], { missing: ["c#5"] });
    expect(accept.verdict).toBe("accept");
    expect(accept.delta.explore_bytes_pct).toBe(-25);
    expect(accept.missing).toEqual(["c#5"]);

    const nonCompliant = buildReport([run("on", 1, 70), run("on", 3, 80, {}, ["a", "b", "c", "d"]), ...off]);
    expect(nonCompliant.verdict).toBe("insufficient");
    expect(nonCompliant.non_compliant).toEqual([{ group: "c#3", deviations: ["a", "b", "c", "d"] }]);

    const misled = buildReport([run("on", 1, 70, { misled: "wrong callers" }), run("on", 3, 80), ...off]);
    expect(misled.verdict).toBe("reject");
    expect(misled.reasons).toEqual(["graft misled 1 run(s)"]);

    expect(buildReport([run("on", 1, 95), run("on", 3, 95), ...off]).verdict).toBe("reject");
  });
});

describe("code-search benchmark", () => {
  const q = {
    id: "q",
    level: "symbol",
    truth: [
      { file: "packages/cli/src/a.ts", symbol: "f" },
      { file: "packages/cli/src/b.ts", symbol: "g" },
    ],
  };

  it("takes the last JSON array of the agent's last message", () => {
    const text = [
      line("2026-09-24T10:00:00.000Z", "m1", [{ type: "text", text: "first ```json\n[1]\n```" }]),
      line("2026-09-24T10:00:01.000Z", "m2", [{ type: "text", text: 'how I searched\n```json\n[{"file": "a"}]\n```\nfix:\n```json\n[{"file": "b"}]\n```' }]),
    ].join("\n");
    expect(extractAnswer(text)).toEqual([{ file: "b" }]);
    const handback = [
      line("2026-09-24T10:00:00.000Z", "m1", [tool("h", "SubagentHandback", { message: 'searched\n```json\n[{"file": "c"}]\n```' })]),
      line("2026-09-24T10:00:01.000Z", "m2", [{ type: "text", text: "Report handed back." }]),
    ].join("\n");
    expect(extractAnswer(handback)).toEqual([{ file: "c" }]);
    expect(extractAnswer(line("2026-09-24T10:00:00.000Z", "m", [{ type: "text", text: "no answer" }]))).toBeNull();
  });

  it("scores by file + symbol, normalising absolute paths and qualified names", () => {
    const s = scoreAnswer(q, [
      { file: "D:\\project\\SRA-bench\\packages\\cli\\src\\a.ts", symbol: "Mod.f()" },
      { file: "packages/cli/src/c.ts", symbol: "h" },
    ]);
    expect(s).toMatchObject({ answered: true, recall: 0.5, precision: 0.5, file_recall: 0.5, missed: ["packages/cli/src/b.ts::g"], extra: ["packages/cli/src/c.ts::h"] });
    expect(scoreAnswer({ ...q, level: "file" }, [{ file: "packages/cli/src/b.ts", symbol: "(file)" }]).recall).toBe(0.5);
    expect(scoreAnswer(q, null)).toMatchObject({ answered: false, recall: 0, precision: 0 });
  });

  it("pairs arms by question and applies the 0.8 explore ratio and the recall floor", () => {
    const r = (question: string, arm: string, explore: number, recall: number, cs = 0) => ({
      question,
      arm,
      ingest: { explore_bytes: explore },
      tokens: { total: explore * 10 },
      tool_calls: { total: 3, graft: cs },
      deviations: [],
      score: { recall, precision: 1 },
    });
    const all = [r("q1", "A", 50, 1, 2), r("q1", "B", 100, 1), r("q2", "A", 60, 1, 1), r("q2", "B", 100, 0.9)];
    const accept = buildBenchReport(all, ["q1", "q2"]);
    expect(accept.verdict).toBe("accept");
    expect(accept.summary).toMatchObject({ pairs: 2, median_ratio_explore: 0.55, mean_recall_a: 1, mean_recall_b: 0.95 });
    expect(buildBenchReport(all, ["q1", "q2", "q3"]).verdict).toBe("insufficient");
    const worse = buildBenchReport([r("q1", "A", 50, 0.5, 2), r("q1", "B", 100, 1)], ["q1"]);
    expect(worse.verdict).toBe("reject");
    expect(worse.reasons).toEqual(["recall A 0.5 < B 1"]);
    expect(buildBenchReport([r("q1", "A", 90, 1, 1), r("q1", "B", 100, 1)], ["q1"]).reasons).toEqual(["median explore ratio 0.9 is not ≤ 0.8"]);
    expect(buildBenchReport([r("q1", "A", 50, 1, 1), r("q1", "B", 100, 1, 3)], ["q1"]).reasons).toEqual(["cs used in [B]: q1"]);
  });
});
