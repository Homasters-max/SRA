/**
 * Contract of `CheckRunnerPort` (ADR-0025 п. 5, design §7, task 4.3): a check
 * command described once — its exit code, its output, whether it outlives the
 * timeout — is a `node -e` script for the real `CheckRunner` and a programmed
 * answer for `FakeCheckRunner`; both runners must return the same outcome and
 * route the output the same way (captured → `stdout`, else → `forward`).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { CheckRunner } from "../../src/adapters/check-runner.js";
import type { CheckRunnerPort, RunSpec } from "../../src/core/ports/checks.js";
import { FakeCheckRunner, type FakeCommand } from "../app/helpers/fakes/checks.js";

const NODE = process.execPath;
const cwd = mkdtempSync(path.join(tmpdir(), "warrant-checks-contract-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

/** A command described once: `node -e <script>` for the real runner, the same answer for the fake. */
interface Described {
  script: string;
  answer: FakeCommand;
}

const prints = (output: string, exit = 0): Described => ({
  script: `process.stdout.write(${JSON.stringify(output)}); process.exitCode = ${exit};`,
  answer: { output, exit }
});

const SLOW: Described = { script: "setTimeout(() => {}, 30000);", answer: { timedOut: true } };

const DESCRIBED = [prints("report\n"), prints("", 3), prints("progress\n", 1), SLOW];

function fakeRunner(): CheckRunnerPort {
  const byScript = new Map(DESCRIBED.map((d) => [d.script, d.answer]));
  return new FakeCheckRunner().on(NODE, (spec) => byScript.get(spec.argv[2] ?? "") ?? { spawnError: "unknown script" });
}

const SIDES = [
  { side: "CheckRunner (real processes)", runner: (): CheckRunnerPort => new CheckRunner() },
  { side: "FakeCheckRunner", runner: fakeRunner }
];

const run = (described: Described, extra: Partial<RunSpec> = {}): RunSpec => ({
  argv: [NODE, "-e", described.script],
  cwd,
  timeoutMs: 20_000,
  captureStdout: true,
  ...extra
});

describe.each(SIDES)("CheckRunnerPort contract: $side", ({ runner: make }) => {
  it("captured output and exit codes", async () => {
    const runner = make();
    expect(await runner.run(run(prints("report\n")))).toEqual({ kind: "exited", code: 0, signal: null, stdout: "report\n" });
    expect(await runner.run(run(prints("", 3)))).toEqual({ kind: "exited", code: 3, signal: null, stdout: "" });
  });

  it("uncaptured output goes to forward, not to stdout", async () => {
    const chunks: Buffer[] = [];
    const outcome = await make().run(run(prints("progress\n", 1), { captureStdout: false, forward: (chunk) => chunks.push(chunk) }));
    expect(outcome).toEqual({ kind: "exited", code: 1, signal: null, stdout: "" });
    expect(Buffer.concat(chunks).toString("utf8")).toBe("progress\n");
  });

  it("a command that outlives its timeout is a timeout", async () => {
    expect(await make().run(run(SLOW, { timeoutMs: 500 }))).toEqual({ kind: "timeout" });
  });

  it("a command that does not exist, and an empty command, cannot be started", async () => {
    const runner = make();
    const missing = await runner.run({ argv: ["warrant-no-such-command-4f2a"], cwd, timeoutMs: 20_000, captureStdout: true });
    expect(missing.kind).toBe("spawn-error");
    expect(await runner.run({ argv: [], cwd, timeoutMs: 20_000, captureStdout: true })).toEqual({
      kind: "spawn-error",
      message: "empty command"
    });
  });
});
