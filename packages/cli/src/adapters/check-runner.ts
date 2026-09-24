/**
 * `CheckRunnerPort`: running one check command (design §2, §4, REQ-VER-002,
 * ADR-0025 п. 3).
 *
 * The argv goes to `cross-spawn` without a shell (as `exec.ts`; on
 * Windows it also resolves `.cmd` shims). The working directory is the
 * project root and the environment is inherited unchanged (P-14).
 *
 * Timeout kills the whole process tree, not just the child: a `vitest` or
 * `openspec` grandchild would otherwise outlive the CLI and keep holding the
 * lock "in fact". On POSIX the child leads its own process group
 * (`detached`) and the group is killed; on Windows `taskkill /T /F` walks the
 * tree. The timer, the interrupt hook and the stdout stream are closed on
 * every path — a handle left open would keep the CLI alive (B4).
 */
import { spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import spawnCjs from "cross-spawn";

import { onInterrupt } from "../core/check/interrupt.js";
import type { CheckRunnerPort, RunOutcome, RunSpec } from "../core/ports/checks.js";

// `cross-spawn` is CommonJS with `export =`.
const spawn = spawnCjs as unknown as typeof import("cross-spawn");

/** How long to wait for the killed tree to close its pipes before giving up on it. */
const KILL_GRACE_MS = 5_000;

/** Kills `pid` and every process below it. Never throws. */
export function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

export function runCommand(spec: RunSpec): Promise<RunOutcome> {
  const [command, ...args] = spec.argv;
  if (command === undefined) return Promise.resolve({ kind: "spawn-error", message: "empty command" });
  const forward = spec.forward ?? ((chunk: Buffer) => void process.stderr.write(chunk));

  return new Promise<RunOutcome>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd: spec.cwd,
        stdio: ["ignore", "pipe", "inherit"],
        detached: process.platform !== "win32",
        windowsHide: true
      });
    } catch (cause) {
      resolve({ kind: "spawn-error", message: (cause as Error).message });
      return;
    }

    const chunks: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    let spawnError: string | undefined;
    let timer: NodeJS.Timeout | undefined;
    let grace: NodeJS.Timeout | undefined;

    const unregister = onInterrupt(() => killTree(child.pid));

    const finish = (outcome: RunOutcome): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (grace !== undefined) clearTimeout(grace);
      unregister();
      child.stdout?.destroy();
      resolve(outcome);
    };

    timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
      grace = setTimeout(() => finish({ kind: "timeout" }), KILL_GRACE_MS);
    }, spec.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (spec.captureStdout) chunks.push(chunk);
      else forward(chunk);
    });

    child.on("error", (error) => {
      spawnError = error.message;
      // A process that never started emits no `close` reliably; one that did
      // (cross-spawn reports a missing command on Windows this way) still will.
      if (child.pid === undefined) finish({ kind: "spawn-error", message: spawnError });
    });

    child.on("close", (code, signal) => {
      if (timedOut) finish({ kind: "timeout" });
      else if (spawnError !== undefined) finish({ kind: "spawn-error", message: spawnError });
      else finish({ kind: "exited", code, signal, stdout: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

export class CheckRunner implements CheckRunnerPort {
  run(spec: RunSpec): Promise<RunOutcome> {
    return runCommand(spec);
  }
}
