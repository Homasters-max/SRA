/**
 * Graft experiment metrics (ADR-0026): `scripts/dev/graft-metrics-lib.js` counts
 * a transcript once per API response and once per tool call, tells graft calls
 * from plain shell exploration, flags forbidden graft use, and gives the verdict
 * only with enough runs in both modes.
 */
import { describe, expect, it } from "vitest";

import { buildReport, buildRun, graftCalls, isShellSearch, modeOf, parseTranscript } from "../../../../../scripts/dev/graft-metrics-lib.js";

const usage = (input: number, output: number) => ({ input_tokens: input, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: output });
const bash = (id: string, command: string) => ({ type: "tool_use", id, name: "Bash", input: { command } });

function line(ts: string, msgId: string, content: unknown[], u = usage(1, 5)): string {
  return JSON.stringify({ type: "assistant", timestamp: ts, message: { id: msgId, usage: u, content } });
}

const transcript = [
  JSON.stringify({ type: "user", timestamp: "2026-09-24T10:00:00.000Z", message: { content: "go" } }),
  // one response split over two lines: usage counted once
  line("2026-09-24T10:00:05.000Z", "m1", [{ type: "text", text: "look" }]),
  line("2026-09-24T10:00:05.000Z", "m1", [bash("t1", "cd /d/x && cat a.ts b.ts")]),
  line("2026-09-24T10:00:09.000Z", "m2", [bash("t2", "graft callers evaluateGates -d 2 | head -20"), { type: "tool_use", id: "t3", name: "Read", input: {} }]),
  line("2026-09-24T10:00:09.000Z", "m2", [bash("t2", "graft callers evaluateGates -d 2 | head -20")]), // duplicate tool_use
  line("2026-09-24T10:01:40.000Z", "m3", [bash("t4", "npm test")], usage(2, 7)),
  "not json",
].join("\n");

describe("graft-metrics", () => {
  it("counts usage per response and tools per tool_use id", () => {
    const m = parseTranscript(transcript);
    expect(m.requests).toBe(3);
    expect(m.tokens).toMatchObject({ input: 4, output: 17, cache_creation: 30, cache_read: 300, total: 351, context_peak: 112 });
    expect(m.tool_calls).toMatchObject({ total: 4, read_like: 1, shell_search: 1, graft: 1 });
    expect(m.window).toEqual({ start: "2026-09-24T10:00:00.000Z", end: "2026-09-24T10:01:40.000Z", duration_s: 100 });
    expect(m.violations).toEqual([]);
  });

  it("recognises graft calls and shell exploration", () => {
    expect(graftCalls("cd x && npx -y @nanonets/graft ask 'q' --source")).toEqual(["ask"]);
    expect(graftCalls("echo graftless")).toEqual([]);
    expect(isShellSearch("cd /d/x && sed -n 1,20p f.ts")).toBe(true);
    expect(isShellSearch("npm run typecheck")).toBe(false);
  });

  it("flags forbidden graft use, and any graft use in an OFF run", () => {
    const bad = parseTranscript(line("2026-09-24T10:00:00.000Z", "m", [bash("t", "graft init --no-global"), bash("u", "graft build --deep")]));
    expect(bad.violations).toEqual(["graft init", "forbidden flag: --deep"]);
    const off = buildRun({ change: "c", group: 2, mode: "off", agent: {}, metrics: parseTranscript(transcript), card: {} });
    expect(off.violations).toEqual(["graft used in an OFF run"]);
  });

  it("reads the mode from the description tag", () => {
    expect(modeOf("test-levels group 3 [graft:ON]")).toBe("on");
    expect(modeOf("phase-3b group 1: docs")).toBeNull();
  });

  it("gives a verdict only with ≥ 2 runs per mode, by the 20 % threshold", () => {
    const run = (mode: string, group: number, total: number, tools: number, card = {}) => ({
      ...buildRun({ change: "c", group, mode, agent: {}, metrics: parseTranscript(""), card }),
      tokens: { input: 0, cache_creation: 0, cache_read: 0, output: 0, total, context_peak: 0 },
      tool_calls: { total: tools, by_name: {}, read_like: 0, shell_search: 0, graft: 0 },
    });
    expect(buildReport([run("on", 1, 70, 50), run("off", 2, 100, 50)]).verdict).toBe("insufficient");

    const accept = buildReport([run("on", 1, 70, 50), run("on", 3, 80, 60), run("off", 2, 100, 50), run("off", 4, 100, 60)]);
    expect(accept.verdict).toBe("accept");
    expect(accept.delta.tokens_total_pct).toBe(-25);

    const misled = buildReport([run("on", 1, 70, 50, { misled: "wrong callers" }), run("on", 3, 80, 60), run("off", 2, 100, 50), run("off", 4, 100, 60)]);
    expect(misled.verdict).toBe("reject");
    expect(misled.reasons).toEqual(["graft misled 1 run(s)"]);

    expect(buildReport([run("on", 1, 95, 50), run("on", 3, 95, 60), run("off", 2, 100, 50), run("off", 4, 100, 60)]).verdict).toBe("reject");
  });
});
