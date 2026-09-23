/**
 * Graft experiment metrics (ADR-0026): `scripts/dev/graft-metrics-lib.js` counts a transcript once per API response
 * and once per tool call, tells `cs.js` calls from raw graft and from plain shell exploration, counts deviations from
 * the code-search procedure, reads the blind arm label, and gives the verdict only with enough compliant runs.
 */
import { describe, expect, it } from "vitest";

import {
  buildReport,
  buildRun,
  closedGroups,
  csCalls,
  deviationsOf,
  isShellSearch,
  MAX_DEVIATIONS,
  modeOf,
  parseTranscript,
  rawGraftCalls,
} from "../../../../../scripts/dev/graft-metrics-lib.js";

const usage = (input: number, output: number) => ({ input_tokens: input, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: output });
const bash = (id: string, command: string) => ({ type: "tool_use", id, name: "Bash", input: { command } });
const tool = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name, input });

function line(ts: string, msgId: string, content: unknown[], u = usage(1, 5)): string {
  return JSON.stringify({ type: "assistant", timestamp: ts, message: { id: msgId, usage: u, content } });
}

const transcript = [
  JSON.stringify({ type: "user", timestamp: "2026-09-24T10:00:00.000Z", message: { content: "go" } }),
  // one response split over two lines: usage counted once
  line("2026-09-24T10:00:05.000Z", "m1", [{ type: "text", text: "look" }]),
  line("2026-09-24T10:00:05.000Z", "m1", [bash("t1", "cd /d/project/SRA-graft && cat docs/04-lifecycle.md")]),
  line("2026-09-24T10:00:09.000Z", "m2", [bash("t2", 'node scripts/dev/cs.js callers evaluateGates -d 2'), tool("t3", "Read", { file_path: "D:/x/packages/cli/src/a.ts", offset: 10, limit: 20 })]),
  line("2026-09-24T10:00:09.000Z", "m2", [bash("t2", 'node scripts/dev/cs.js callers evaluateGates -d 2')]), // duplicate tool_use
  line("2026-09-24T10:01:40.000Z", "m3", [bash("t4", "npm test")], usage(2, 7)),
  "not json",
].join("\n");

describe("graft-metrics", () => {
  it("counts usage per response and tools per tool_use id", () => {
    const m = parseTranscript(transcript);
    expect(m.requests).toBe(3);
    expect(m.tokens).toMatchObject({ input: 4, output: 17, cache_creation: 30, cache_read: 300, total: 351, context_peak: 112 });
    expect(m.tool_calls).toMatchObject({ total: 4, read_like: 1, shell_search: 1, graft: 1, raw_graft: 0 });
    expect(m.window).toEqual({ start: "2026-09-24T10:00:00.000Z", end: "2026-09-24T10:01:40.000Z", duration_s: 100 });
    expect(m.deviations).toEqual([]);
  });

  it("tells cs.js calls, raw graft and shell exploration apart", () => {
    expect(csCalls('node "D:/project/SRA-graft/scripts/dev/cs.js" ask "q" --source')).toEqual(["ask"]);
    expect(rawGraftCalls("node scripts/dev/cs.js grep foo")).toEqual([]);
    expect(rawGraftCalls("cd /d/project/SRA-graft && npx -y @nanonets/graft ask 'q'")).toEqual(["ask"]);
    expect(isShellSearch("cd /d/x && sed -n 1,20p f.ts")).toBe(true);
    expect(isShellSearch("npm run typecheck")).toBe(false);
  });

  it("counts deviations from the code-search procedure", () => {
    expect(deviationsOf(tool("a", "Grep", { pattern: "x", path: "packages/cli/src" }))).toEqual(["Grep over code"]);
    expect(deviationsOf(tool("b", "Grep", { pattern: "x", path: "docs" }))).toEqual([]);
    expect(deviationsOf(tool("c", "Read", { file_path: "D:/x/packages/cli/src/core/check/lock.ts" }))).toEqual(["whole read check/lock.ts"]);
    expect(deviationsOf(tool("d", "Read", { file_path: "D:/x/docs/adr/README.md" }))).toEqual([]);
    expect(deviationsOf(bash("e", "cd /d/x && grep -rn acquireLock packages/cli/src"))).toEqual(["shell search over code"]);
    expect(deviationsOf(bash("f", "cat packages/cli/src/a.ts"))).toEqual(["shell whole read of code"]);
    expect(deviationsOf(bash("g", "sed -n 10,40p packages/cli/src/a.ts"))).toEqual([]);
    expect(deviationsOf(bash("h", "graft callers foo"))).toEqual(["raw graft callers"]);
    expect(deviationsOf(bash("i", "node scripts/dev/cs.js grep foo | grep -v test"))).toEqual([]);
  });

  it("reads the blind arm label; ON keeps deviations, OFF may not use graft", () => {
    expect(modeOf("test-levels group 3 [A]")).toBe("on");
    expect(modeOf("test-levels group 4 [B]")).toBe("off");
    expect(modeOf("phase-3b group 1: docs")).toBeNull();
    const metrics = parseTranscript(transcript);
    expect(buildRun({ change: "c", group: 2, mode: "off", agent: {}, metrics, card: {} }).violations).toEqual(["graft used in an OFF run"]);
    const many = { ...metrics, deviations: Array.from({ length: MAX_DEVIATIONS + 1 }, () => "Grep over code") };
    expect(buildRun({ change: "c", group: 1, mode: "on", agent: {}, metrics: many, card: {} }).compliant).toBe(false);
  });

  it("finds groups whose every box is ticked", () => {
    const md = "## 1. A\n\n- [x] 1.1 a\n- [x] 1.2 b\n\n## 2. B\n\n- [x] 2.1 a\n- [ ] 2.2 b\n\n## 3. C\n\n- [ ] 3.1 a\n";
    expect(closedGroups(md)).toEqual([1]);
  });

  it("gives a verdict only with ≥ 2 counted runs per arm, by the 20 % threshold", () => {
    const run = (mode: string, group: number, total: number, tools: number, card = {}, deviations: string[] = []) => ({
      ...buildRun({ change: "c", group, mode, agent: {}, metrics: { ...parseTranscript(""), deviations }, card }),
      tokens: { input: 0, cache_creation: 0, cache_read: 0, output: 0, total, context_peak: 0 },
      tool_calls: { total: tools, by_name: {}, read_like: 0, shell_search: 0, graft: 0, raw_graft: 0 },
    });
    const off = [run("off", 2, 100, 50), run("off", 4, 100, 60)];
    expect(buildReport([run("on", 1, 70, 50), ...off]).verdict).toBe("insufficient");

    const accept = buildReport([run("on", 1, 70, 50), run("on", 3, 80, 60), ...off], { missing: ["c#5"] });
    expect(accept.verdict).toBe("accept");
    expect(accept.delta.tokens_total_pct).toBe(-25);
    expect(accept.missing).toEqual(["c#5"]);

    const nonCompliant = buildReport([run("on", 1, 70, 50), run("on", 3, 80, 60, {}, ["a", "b", "c", "d"]), ...off]);
    expect(nonCompliant.verdict).toBe("insufficient");
    expect(nonCompliant.non_compliant).toEqual([{ group: "c#3", deviations: ["a", "b", "c", "d"] }]);

    const misled = buildReport([run("on", 1, 70, 50, { misled: "wrong callers" }), run("on", 3, 80, 60), ...off]);
    expect(misled.verdict).toBe("reject");
    expect(misled.reasons).toEqual(["graft misled 1 run(s)"]);

    expect(buildReport([run("on", 1, 95, 50), run("on", 3, 95, 60), ...off]).verdict).toBe("reject");
  });
});
