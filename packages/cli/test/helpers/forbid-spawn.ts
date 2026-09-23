/**
 * Setup file of the `unit` and `app` projects (ADR-0025 п. 7a): these levels
 * never start a process. Every function of `node:child_process` and
 * `cross-spawn` throws `SPAWN_FORBIDDEN_AT_LEVEL`, so a test that reaches a
 * process — directly or through the code under test — fails at once instead of
 * silently running `openspec` or `git`. A test that needs a process belongs to
 * `contract` or `e2e`.
 */
import { vi } from "vitest";

const guard = vi.hoisted(() => {
  const CODE = "SPAWN_FORBIDDEN_AT_LEVEL";
  const forbidden =
    (name: string) =>
    (): never => {
      const error = new Error(`${CODE}: ${name}() starts a process; tests of this level must not (ADR-0025 п. 7a) — move the test to contract or e2e`);
      Object.assign(error, { code: CODE });
      throw error;
    };
  /** Same shape as `module`, every function replaced by one that throws. */
  const forbid = (module: Record<string, unknown>, label: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(module)) {
      out[key] = typeof value === "function" ? forbidden(`${label}.${key}`) : value;
    }
    return out;
  };
  return { forbidden, forbid };
});

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const forbidden = guard.forbid(original, "child_process");
  return { ...forbidden, default: forbidden };
});

vi.mock("cross-spawn", () => {
  const spawn = Object.assign(guard.forbidden("cross-spawn"), { sync: guard.forbidden("cross-spawn.sync") });
  return { default: spawn };
});
