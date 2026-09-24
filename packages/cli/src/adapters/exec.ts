/**
 * One asynchronous child process for the adapters (ADR-0025 п. 3, I-64): the
 * event loop stays free while `openspec` or `git` runs.
 *
 * `cross-spawn` because on Windows `openspec` is a `.cmd` shim, which
 * `child_process.spawn` will not execute without a shell. Never rejects: a
 * command that cannot start, or exits non-zero, is `ok: false`.
 */
import spawnCjs from "cross-spawn";

// `cross-spawn` is CommonJS with `export =`.
const spawn = spawnCjs as unknown as typeof import("cross-spawn");

export interface ExecResult {
  /** Started, and exited with code 0. */
  ok: boolean;
  stdout: Buffer;
  stderr: Buffer;
}

export function exec(command: string, args: readonly string[], cwd: string, input?: string): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let failed = false;
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve({ ok, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
    };
    let child;
    try {
      child = spawn(command, [...args], {
        cwd,
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        windowsHide: true
      });
    } catch {
      finish(false);
      return;
    }
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", () => {
      failed = true;
      // A process that never started emits no `close` reliably.
      if (child.pid === undefined) finish(false);
    });
    child.on("close", (code) => finish(!failed && code === 0));
    if (input !== undefined && child.stdin !== null) {
      // A child that exits before reading all of its input must not crash the CLI.
      child.stdin.on("error", () => undefined);
      child.stdin.end(input);
    }
  });
}
