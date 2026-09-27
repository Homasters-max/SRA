/**
 * `FakeCheckRunner` and `FakeClock` (ADR-0025 п. 4, design §5, task 4.1):
 * answers by command, journal, captured and forwarded output, timeout and
 * failure to start; a fixed, settable date. Conformity of the runner with the
 * real one: `test/contract/checks.contract.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { FakeCheckRunner } from "../../app/helpers/fakes/checks.js";
import { FAKE_TODAY, FakeClock } from "../../app/helpers/fakes/clock.js";
import type { RunSpec } from "../../../src/core/ports/checks.js";

const spec = (argv: string[], captureStdout = true, forward?: (chunk: Buffer) => void): RunSpec => ({
  argv,
  cwd: "/project",
  timeoutMs: 1_000,
  captureStdout,
  ...(forward === undefined ? {} : { forward })
});

describe("FakeCheckRunner", () => {
  it("answers by argv[0]: exit, signal, captured output; journals every run", async () => {
    const runner = new FakeCheckRunner()
      .on("tests", { exit: 3, output: "report" })
      .on("killed", { signal: "SIGTERM" })
      .on("echo", (run) => ({ output: run.argv.slice(1).join(" ") }));

    expect(await runner.run(spec(["tests"]))).toEqual({ kind: "exited", code: 3, signal: null, stdout: "report" });
    expect(await runner.run(spec(["killed"]))).toEqual({ kind: "exited", code: null, signal: "SIGTERM", stdout: "" });
    expect(await runner.run(spec(["echo", "a", "b"]))).toEqual({ kind: "exited", code: 0, signal: null, stdout: "a b" });
    expect(runner.calls.map((c) => c.argv[0])).toEqual(["tests", "killed", "echo"]);
  });

  it("uncaptured output goes to forward, or is kept when there is none", async () => {
    const runner = new FakeCheckRunner().on("tests", { output: "progress" });
    const chunks: string[] = [];
    expect(await runner.run(spec(["tests"], false, (chunk) => chunks.push(chunk.toString())))).toEqual({
      kind: "exited",
      code: 0,
      signal: null,
      stdout: ""
    });
    expect(chunks).toEqual(["progress"]);
    await runner.run(spec(["tests"], false));
    expect(runner.forwarded).toEqual(["progress"]);
  });

  it("timeout, a command it does not know, an empty argv, and the effect of a command", async () => {
    const written: string[] = [];
    const runner = new FakeCheckRunner()
      .on("slow", { timedOut: true })
      .on("broken", { spawnError: "EACCES" })
      .on("report", { effect: (run) => written.push(run.cwd) });
    expect(await runner.run(spec(["slow"]))).toEqual({ kind: "timeout" });
    expect(await runner.run(spec(["broken"]))).toEqual({ kind: "spawn-error", message: "EACCES" });
    expect((await runner.run(spec(["missing"]))).kind).toBe("spawn-error");
    expect(await runner.run(spec([]))).toEqual({ kind: "spawn-error", message: "empty command" });
    await runner.run(spec(["report"]));
    expect(written).toEqual(["/project"]);
  });
});

describe("FakeClock", () => {
  it("answers a fixed date until set, and refuses what is not YYYY-MM-DD", () => {
    const clock = new FakeClock();
    expect(clock.today()).toBe(FAKE_TODAY);
    expect(clock.set("2027-01-31").today()).toBe("2027-01-31");
    expect(() => clock.set("2027-1-31")).toThrow(/YYYY-MM-DD/);
  });

  it("answers the UTC date as the local one until setLocal moves it (SCN-KRN-147)", () => {
    const clock = new FakeClock("2026-09-26");
    expect(clock.localToday()).toBe("2026-09-26");
    expect(clock.setLocal("2026-09-27").localToday()).toBe("2026-09-27");
    expect(clock.today()).toBe("2026-09-26");
    expect(() => clock.setLocal("27.09.2026")).toThrow(/YYYY-MM-DD/);
  });
});
