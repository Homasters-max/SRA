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
  isBlockedResult,
  isShellSearch,
  isShellWrite,
  MAX_DEVIATIONS,
  mergeParts,
  modeOf,
  parseTranscript,
  rawGraftCalls,
  scoreAnswer,
  SMALL_FILE_LINES,
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
  line("2026-09-24T10:00:09.000Z", "m2", [bash("t2", "node scripts/dev/cs.js callers evaluateGates -d 2"), tool("t3", "Read", { file_path: "D:/project/SRA/packages/cli/src/a.ts", offset: 10, limit: 20 })]),
  line("2026-09-24T10:00:09.000Z", "m2", [bash("t2", "node scripts/dev/cs.js callers evaluateGates -d 2")]), // duplicate tool_use
  result("t2", "b".repeat(40)),
  result("t3", "c".repeat(30)),
  line("2026-09-24T10:00:30.000Z", "m3", [tool("t5", "Edit", { file_path: "D:/project/SRA/packages/cli/src/a.ts" })]),
  result("t5", "ok"),
  line("2026-09-24T10:01:00.000Z", "m4", [tool("t6", "Read", { file_path: "D:/project/SRA/packages/cli/src/b.ts", offset: 1, limit: 5 })]),
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
    expect(isShellSearch("cd /d/project/SRA && sed -n 1,20p f.ts")).toBe(true);
    expect(isShellSearch("npm test 2>&1 | tail -5")).toBe(false);
    expect(isShellWrite("cat > a.ts <<'EOF'\nx\nEOF")).toBe(true);
    expect(isShellWrite("sed -i s/a/b/ package.json")).toBe(true);
    expect(isShellWrite("node x.js > /dev/null 2>&1")).toBe(false);
  });

  it("counts real deviations from the code-search procedure", () => {
    expect(deviationsOf(tool("a", "Grep", { pattern: "x", path: "packages/cli/src" }))).toEqual(["Grep over code"]);
    expect(deviationsOf(tool("c", "Read", { file_path: "D:/project/SRA/packages/cli/src/core/check/lock.ts" }))).toEqual(["whole read check/lock.ts"]);
    expect(deviationsOf(bash("e", "cd /d/project/SRA && grep -rn acquireLock packages/cli/src"))).toEqual(["shell search over code"]);
    expect(deviationsOf(bash("e2", "git grep -n foo packages/cli/src"))).toEqual(["shell search over code"]);
    expect(deviationsOf(bash("e3", 'grep -n "^export" packages/cli/test/helpers/x.ts'))).toEqual(["shell search over code"]);
    expect(deviationsOf(bash("f", "cat packages/cli/src/a.ts"))).toEqual(["shell whole read of code"]);
    expect(deviationsOf(bash("h", "graft callers foo"))).toEqual(["raw graft callers"]);
  });

  it("does not count writes, data files, node_modules, listing or output filters (test-levels false positives)", () => {
    const clean = [
      tool("b", "Grep", { pattern: "x", path: "docs" }),
      tool("b2", "Glob", { pattern: "packages/**/*.ts" }),
      tool("d", "Read", { file_path: "D:/project/SRA/docs/adr/README.md" }),
      bash("g", "sed -n 10,40p packages/cli/src/a.ts"),
      bash("i", "node scripts/dev/cs.js grep foo | grep -v test"),
      bash("j", "cd /d/project/SRA/packages/cli/test && cat > unit/tmp-spawn.test.ts <<'EOF'\nimport { spawnSync } from \"node:child_process\";\ncat packages/cli/src/a.ts\nEOF"),
      bash("k", "cd /d/project/SRA && sed -i '3s/0.4.0/0.4.1/' package.json && grep -n version packages/cli/package.json"),
      bash("l", "cd /d/project/SRA/node_modules/vitest/dist && grep -n groupOrder chunks/reporters.d.ts"),
      bash("m", 'cd /d/project/SRA/packages/cli && find test -name "*.test.ts" | wc -l; ls test/unit/*/'),
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

/** Audit 2026-09-24: cases the detector missed, false positives it raised, and D-8 (a range covering the file). */
describe("graft-metrics: code-search deviations (audit 2026-09-24)", () => {
  const grep = (input: Record<string, unknown>, ctx = {}) => deviationsOf(tool("g", "Grep", { pattern: "x", ...input }), ctx);
  const sh = (command: string, ctx = {}) => deviationsOf(bash("s", command), ctx);
  const ps = (command: string, ctx = {}) => deviationsOf(tool("p", "PowerShell", { command }), ctx);
  const read = (input: Record<string, unknown>, ctx = {}) => deviationsOf(tool("r", "Read", input), ctx);
  /** A Read result of lines 1..n (`     1\t…`). */
  const numbered = (n: number) => Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(6)}\tline ${i + 1}`).join("\n");
  const output = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");
  const file = "D:/project/SRA/packages/cli/src/core/a.ts";

  it("rule 1: Grep over the repo root, without a path, or with a brace glob is over code", () => {
    expect(grep({})).toEqual(["Grep over code"]);
    expect(grep({}, { cwd: String.raw`D:\project\SRA` })).toEqual(["Grep over code"]);
    expect(grep({ path: String.raw`D:\project\SRA` })).toEqual(["Grep over code"]);
    expect(grep({ path: "D:/project/SRA/packages" })).toEqual(["Grep over code"]);
    expect(grep({ path: "/d/project/SRA-graft-audit" })).toEqual(["Grep over code"]);
    expect(grep({ path: "D:/work/repo" }, { root: "D:/work/repo" })).toEqual(["Grep over code"]);
    expect(grep({ glob: "*.{ts,js}", path: "D:/project/SRA/packages" })).toEqual(["Grep over code"]);
    expect(grep({ type: "ts" })).toEqual(["Grep over code"]);
  });

  it("rule 1: Grep over JSON schemas, docs or a non-code glob is not over code", () => {
    expect(grep({ path: "packages/cli/schemas" })).toEqual([]);
    expect(grep({ path: String.raw`D:\project\SRA\packages\cli\schemas` })).toEqual([]);
    expect(grep({ path: "packages/cli/test/fixtures" })).toEqual([]);
    expect(grep({ glob: "*.md" })).toEqual([]);
    expect(grep({ glob: "*.{md,json}", path: "D:/project/SRA" })).toEqual([]);
    expect(grep({ glob: "docs/**" })).toEqual([]);
    expect(grep({ type: "md" })).toEqual([]);
    expect(grep({ path: "D:/work/other" }, { root: "D:/work/repo" })).toEqual([]);
  });

  it("rule 1: shell search over code — git grep, recursive grep and rg over the cwd, cd, PowerShell, xargs, find -exec", () => {
    const search = ["shell search over code"];
    expect(sh("git grep foo")).toEqual(search);
    expect(sh("grep -rn foo .")).toEqual(search);
    expect(sh("grep -rn foo")).toEqual(search);
    expect(sh("rg foo")).toEqual(search);
    expect(sh("rg -t ts foo packages/cli")).toEqual(search);
    expect(sh("rg -n -g '*.{ts,js}' foo")).toEqual(search);
    expect(sh("grep -rn --include=*.ts foo packages")).toEqual(search);
    expect(sh("cd packages/cli/src && grep -rn foo core")).toEqual(search);
    expect(sh("cd /d/project/SRA-graft && grep -rn foo .")).toEqual(search);
    expect(sh("git -C packages/cli grep -n foo")).toEqual(search);
    expect(ps(String.raw`Select-String -Path packages\cli\src\*.ts -Pattern foo`)).toEqual(search);
    expect(ps(String.raw`Get-ChildItem -Recurse packages\cli\src -Filter *.ts | Select-String -Pattern foo`)).toEqual(search);
    expect(sh("find packages -name '*.ts' | xargs grep -l foo")).toEqual(search);
    expect(sh("git ls-files packages | xargs grep -n foo")).toEqual(search);
    expect(sh("find packages/cli/src -type f -exec grep -n foo {} +")).toEqual(search);
    expect(sh(String.raw`find . -name "*.ts" -exec grep -l foo {} \;`)).toEqual(search);
    expect(sh("cat packages/cli/src/a.ts | grep foo")).toEqual(search);
    expect(sh("git show HEAD:packages/cli/src/a.ts | grep -oE 'SCN-[A-Z]+' | sort -u")).toEqual(search);
    expect(sh("for f in $(grep -rl foo packages); do echo $f; done")).toEqual(search);
  });

  it("H-1: code is .ts/.js under packages/ or scripts/ of a WARRANT work tree — not a scratchpad, temp or another repo", () => {
    const scratch = "C:/Users/u/AppData/Local/Temp/claude/D--project-SRA/s1/scratchpad";
    // arch-boundaries g3: a grep over the coordinator's scratch script was counted as a search over code
    expect(sh(`cd "${scratch}" && node -e "x" && grep -n rep edits2.js`, { cwd: String.raw`D:\project\SRA` })).toEqual([]);
    expect(sh("grep -n rep edits2.js", { cwd: scratch })).toEqual([]);
    expect(read({ file_path: `${scratch}/big.ts` }, { cwd: "D:/project/SRA", fileLines: () => 500 })).toEqual([]);
    expect(sh("cat /tmp/x/src/a.ts", { fileLines: () => 500 })).toEqual([]);
    expect(sh("rg -t ts foo D:/elsewhere")).toEqual([]);
    expect(sh("grep -rn --include=*.ts foo D:/elsewhere")).toEqual([]);
    expect(grep({ glob: "*.{ts,js}", path: "D:/elsewhere" })).toEqual([]);
    // inside a work tree but outside packages/ and scripts/
    expect(read({ file_path: "D:/project/SRA/vitest.config.ts" }, { fileLines: () => 500 })).toEqual([]);
    expect(sh("grep -n foo docs/x.js lattice/a.ts", { cwd: "D:/project/SRA" })).toEqual([]);
    // another worktree of the repo, reached by an absolute path from the main checkout's cwd
    expect(sh("grep -n foo D:/project/SRA-impl/packages/cli/src/a.ts", { cwd: String.raw`D:\project\SRA` })).toEqual(["shell search over code"]);
    // the live hook looks the root up on disk: a lookup decides, whatever the directory is called
    const rootOf = (p: string) => (p.toLowerCase().startsWith("e:/work/w") ? "E:/work/w" : null);
    expect(grep({ path: "E:/work/w/scripts/dev" }, { cwd: "E:/work/w", root: "E:/work/w", rootOf })).toEqual(["Grep over code"]);
    expect(grep({ path: "D:/project/SRA/packages" }, { cwd: "E:/work/w", root: "E:/work/w", rootOf })).toEqual([]);
    expect(grep({ path: "E:/work" }, { cwd: "E:/work/w", root: "E:/work/w", rootOf })).toEqual(["Grep over code"]);
  });

  it("rule 1: not a search over code — docs, quoted pipes, file-name filters, other trees", () => {
    for (const command of [
      'grep -rnE "foo|bar" openspec/**/*.md',
      "grep -rn 'a|b' docs openspec",
      "git grep foo -- '*.md'",
      "cd docs && grep -rn foo .",
      "rg -t md foo",
      "rg --files packages | grep lock",
      "find packages -name '*.ts' | grep lock",
      "find docs -name '*.md' | xargs grep -l foo",
      "npm test 2>&1 | grep -n FAIL",
      "grep -rn foo packages/cli/schemas",
    ]) {
      expect(sh(command), command).toEqual([]);
    }
    expect(ps("Get-ChildItem -Recurse docs -Filter *.md | Select-String -Pattern foo")).toEqual([]);
  });

  it("rule 1: raw graft — node on graft's cli.js, not text that mentions graft", () => {
    expect(sh("node node_modules/@nanonets/graft/dist/cli.js ask 'where'")).toEqual(["raw graft ask"]);
    expect(sh('node "D:/project/SRA/node_modules/@nanonets/graft/dist/cli.js" callers foo')).toEqual(["raw graft callers"]);
    expect(sh("cd node_modules/@nanonets/graft && node dist/cli.js skeleton x.ts")).toEqual(["raw graft skeleton"]);
    expect(sh('git commit -m "process: graft ask wording, graft callers"')).toEqual([]);
    expect(sh('echo "graft ask" && echo graft callers')).toEqual([]);
    expect(sh("node D:/project/SRA-graft/scripts/dev/graft-metrics.js report")).toEqual([]);
    expect(rawGraftCalls('git commit -m "graft ask"')).toEqual([]);
    expect(csCalls('node "$(git rev-parse --show-toplevel)/scripts/dev/cs.js" skeleton x.ts')).toEqual(["skeleton"]);
  });

  it("rule 5: cs output cut with head / tail; filtering with grep is fine", () => {
    expect(sh("node scripts/dev/cs.js grep foo | head -20")).toEqual(["cs output truncated"]);
    expect(sh("node scripts/dev/cs.js callers foo -d 2 2>&1 | tail -5")).toEqual(["cs output truncated"]);
    expect(ps("node scripts/dev/cs.js grep foo | Select-Object -First 10")).toEqual(["cs output truncated"]);
    expect(sh("node scripts/dev/cs.js grep foo | grep -v test")).toEqual([]);
    expect(sh("node scripts/dev/cs.js grep foo 2>&1")).toEqual([]);
  });

  it("rule 2 / D-8: a range that covers the whole code file is a whole read", () => {
    // Read stopped short of its limit: end of file reached
    expect(read({ file_path: file, offset: 1, limit: 200 }, { result: numbered(120) })).toEqual(["whole read core/a.ts via range"]);
    // the file length is known (live hook, or rescore from git)
    expect(read({ file_path: file, offset: 1, limit: 73 }, { result: numbered(73), fileLines: () => 73 })).toEqual(["whole read core/a.ts via range"]);
    expect(read({ file_path: file, limit: 500 }, { fileLines: () => 300 })).toEqual(["whole read core/a.ts via range"]);
    // the result beats a stale length (the agent had shortened the file); openspec/ under packages/ is code
    expect(read({ file_path: file, offset: 1, limit: 80 }, { result: numbered(56), fileLines: () => 409 })).toEqual(["whole read core/a.ts via range"]);
    expect(read({ file_path: "D:/project/SRA/packages/cli/src/core/openspec/cli.ts", offset: 1, limit: 68 }, { result: numbered(68), fileLines: () => 68 })).toEqual([
      "whole read openspec/cli.ts via range",
    ]);
    // Read's own cap
    expect(read({ file_path: file, offset: 1, limit: 2000 })).toEqual(["whole read core/a.ts via range"]);
    expect(read({ file_path: file }, { result: numbered(300) })).toEqual(["whole read core/a.ts"]);
    // shell ranges
    expect(sh("head -500 packages/cli/src/a.ts", { result: output(300) })).toEqual(["shell whole read of code"]);
    expect(sh("head -n 120 packages/cli/src/a.ts", { fileLines: () => 110 })).toEqual(["shell whole read of code"]);
    expect(sh("sed -n 1,9999p packages/cli/src/a.ts", { result: output(300) })).toEqual(["shell whole read of code"]);
    expect(sh("sed -n '1,120p' packages/cli/src/a.ts", { fileLines: () => 110 })).toEqual(["shell whole read of code"]);
    expect(sh("sed -n '1,$p' packages/cli/src/a.ts")).toEqual(["shell whole read of code"]);
    expect(sh("tail -n +1 packages/cli/src/a.ts")).toEqual(["shell whole read of code"]);
    expect(sh("cat packages/cli/src/a.ts | head -300", { fileLines: () => 250 })).toEqual(["shell whole read of code"]);
    expect(sh("git show HEAD:packages/cli/src/a.ts")).toEqual(["shell whole read of code"]);
    expect(sh("git show main~2:scripts/dev/cs.js", { result: output(200) })).toEqual(["shell whole read of code"]);
    expect(ps("Get-Content packages/cli/src/a.ts -TotalCount 400", { fileLines: () => 380 })).toEqual(["shell whole read of code"]);
    // the cwd a relative path is joined with feeds the line count
    const seen: string[] = [];
    sh("cd packages/cli && head -50 src/a.ts", { cwd: "D:/project/SRA", fileLines: (p: string) => (seen.push(p), 200) });
    expect(seen).toEqual(["D:/project/SRA/packages/cli/src/a.ts"]);
  });

  it("rule 2 / D-8: a real range, a short file, or a filtered read is not a whole read", () => {
    expect(read({ file_path: file, offset: 1, limit: 50 }, { result: numbered(50) })).toEqual([]);
    expect(read({ file_path: file, offset: 1, limit: 50 }, { fileLines: () => 51 })).toEqual([]);
    // the file grew since the known length (more lines came back than it has): not judged whole
    expect(read({ file_path: file, offset: 1, limit: 370 }, { result: numbered(370), fileLines: () => 347 })).toEqual([]);
    expect(read({ file_path: file, offset: 30, limit: 5000 }, { result: numbered(10) })).toEqual([]);
    expect(read({ file_path: file, offset: 1, limit: 100 }, { result: numbered(SMALL_FILE_LINES) })).toEqual([]);
    expect(read({ file_path: file }, { result: numbered(SMALL_FILE_LINES) })).toEqual([]);
    expect(read({ file_path: file, offset: 1, limit: 100 }, { result: numbered(SMALL_FILE_LINES + 1) })).toEqual(["whole read core/a.ts via range"]);
    expect(read({ file_path: file, limit: 100 }, { result: "<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>" })).toEqual([]);
    expect(read({ file_path: "D:/project/SRA/packages/cli/schemas/lock.schema.json" })).toEqual([]);
    expect(sh("cat packages/cli/src/a.ts | head -50", { result: output(50) })).toEqual([]);
    expect(sh("cat packages/cli/src/a.ts | wc -l")).toEqual([]);
    expect(sh("head -50 packages/cli/src/a.ts", { fileLines: () => 200 })).toEqual([]);
    expect(sh("head -500 packages/cli/src/a.ts", { result: output(30) })).toEqual([]);
    expect(sh("cat packages/cli/src/a.ts", { result: output(25) })).toEqual([]);
    expect(sh("sed -n 10,40p packages/cli/src/a.ts")).toEqual([]);
    expect(sh("sed -n '/export/p' packages/cli/src/a.ts")).toEqual([]);
    expect(sh("git show HEAD:packages/cli/src/a.ts | sed -n 1,40p", { fileLines: () => 300 })).toEqual([]);
    expect(sh("git show HEAD --stat")).toEqual([]);
    // a range piped into grep, and file content captured by $(…) instead of printed
    expect(sh('sed -n 1,60p packages/cli/test/helpers/cli.ts | grep -n "export"')).toEqual([]);
    expect(sh("A=$(cat packages/cli/src/a.ts packages/cli/src/b.ts); B=`git show HEAD:packages/cli/src/a.ts`; echo done")).toEqual([]);
    expect(sh("grep -rn 0.4.0 packages/cli/test/golden packs/*/golden")).toEqual([]);
  });

  it("judges a transcript call by its result and counts whole reads with their bytes", () => {
    const text = [
      line("2026-09-24T10:00:00.000Z", "m1", [tool("r1", "Read", { file_path: file, offset: 1, limit: 400 }), tool("r2", "Read", { file_path: file, offset: 1, limit: 30 })]),
      result("r1", numbered(250)),
      result("r2", numbered(30)),
      line("2026-09-24T10:00:05.000Z", "m2", [tool("r3", "Read", { file_path: file, offset: 1, limit: 90 })]),
      result("r3", numbered(90)),
    ].join("\n");
    const m = parseTranscript(text);
    expect(m.deviations).toEqual(["whole read core/a.ts via range"]);
    expect(m.whole_reads).toEqual({ count: 1, bytes: Buffer.byteLength(numbered(250)) });
    // with the file length known, the read of lines 1..90 of a 90-line file is whole too
    const known = parseTranscript(text, { fileLines: () => 90 });
    expect(known.tool_calls.blocked).toBe(0);
    expect(known.deviations).toEqual(["whole read core/a.ts via range", "whole read core/a.ts via range"]);
    expect(known.whole_reads.count).toBe(2);
  });

  it("H-6: a call denied by the PreToolUse hook did not run — counted as blocked, not a deviation, no bytes", () => {
    const denied = (id: string, reason: string) =>
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: reason }] } });
    const failed = (id: string, text: string) =>
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: text }] } });
    const text = [
      line("2026-09-24T10:00:00.000Z", "m1", [tool("g1", "Grep", { pattern: "x", path: "packages/cli/src" }), bash("b1", "cat packages/cli/src/a.ts")]),
      denied("g1", 'code-search: rule 1 — Grep tool over code → `node scripts/dev/cs.js grep "<name>"`'),
      denied("b1", "code-search: rule 2 — whole code file printed by the shell → `cs skeleton <file>`"),
      line("2026-09-24T10:00:05.000Z", "m2", [bash("b2", "grep -rn foo packages")]),
      failed("b2", "Exit code 1\ncode-search: rule 1 — …"),
      line("2026-09-24T10:00:09.000Z", "m3", [bash("c1", "node scripts/dev/cs.js grep x")]),
      result("c1", "hit"),
    ].join("\n");
    const m = parseTranscript(text);
    expect(m.tool_calls.blocked).toBe(2);
    expect(m.tool_calls.total).toBe(4);
    // the failed command ran (the hook was off, or it came through): it stays a deviation with its bytes
    expect(m.deviations).toEqual(["shell search over code"]);
    expect(m.ingest.explore_bytes).toBe(Buffer.byteLength("Exit code 1\ncode-search: rule 1 — …") + 3);
    expect(isBlockedResult({ is_error: false }, "code-search: rule 1")).toBe(false);
  });
});
