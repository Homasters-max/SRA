/**
 * The handler of an exception no command caught (exit-contract D9): the test
 * calls `onCrash` directly with a capturing printer — no test entry into the CLI.
 */
import { describe, expect, it } from "vitest";
import { crashMode, onCrash, type CrashState } from "../../../src/bin/crash.js";
import { EXIT, WarrantError } from "../../../src/core/errors.js";
import { UNREADABLE_EXIT } from "../../../src/core/ports/frontend.js";
import type { Printer } from "../../../src/io/output.js";

function capture(): Printer & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (t) => out.push(t), stderr: (t) => err.push(t) };
}

const argv = (...words: string[]): string[] => ["node", "warrant", ...words];
const boom = (): Error => new Error("boom in a callback");

function crash(state: CrashState, thrown: unknown = boom()): { exit: number; out: string[]; err: string[] } {
  const printer = capture();
  const exit = onCrash(thrown, state, printer);
  return { exit, out: printer.out, err: printer.err };
}

describe("mode of the call (D9)", () => {
  it("guard with --frontend, guard, any other command", () => {
    expect(crashMode(argv("guard", "--frontend", "claude"))).toBe("guard-frontend");
    expect(crashMode(argv("guard", "--frontend=claude"))).toBe("guard-frontend");
    expect(crashMode(argv("--json", "guard"))).toBe("guard");
    expect(crashMode(argv("validate"))).toBe("command");
    expect(crashMode(argv())).toBe("command");
  });
});

describe("SCN-KRN-163: an exception the command did not catch", () => {
  it("before the answer — one envelope INTERNAL with command from argv, the stack on stderr, exit 3", () => {
    const { exit, out, err } = crash({ argv: argv("verify", "add-search"), answered: false });
    expect(exit).toBe(EXIT.CONFIG);
    expect(out).toHaveLength(1);
    const envelope = JSON.parse(out[0]!);
    expect(envelope).toMatchObject({ command: "verify", ok: false, data: {} });
    expect(envelope.errors).toEqual([{ code: "INTERNAL", message: "boom in a callback" }]);
    expect(err.join("")).toMatch(/Error: boom in a callback\n\s+at /);
  });

  it("the envelope name of the running command wins over argv (`run start`)", () => {
    const { out } = crash({ argv: argv("run", "start", "x"), answered: false, command: "run start" });
    expect(JSON.parse(out[0]!).command).toBe("run start");
  });

  it("argv without a command — command `warrant`", () => {
    const { exit, out } = crash({ argv: argv("--json"), answered: false });
    expect(exit).toBe(EXIT.CONFIG);
    expect(JSON.parse(out[0]!).command).toBe("warrant");
  });

  it("a rejection with a non-Error value and an escaped WarrantError are INTERNAL too", () => {
    expect(JSON.parse(crash({ argv: argv("status"), answered: false }, "plain reason").out[0]!).errors).toEqual([
      { code: "INTERNAL", message: "plain reason" }
    ]);
    const { exit, out } = crash({ argv: argv("status"), answered: false }, new WarrantError("BUSY", "lock held"));
    expect(exit).toBe(EXIT.CONFIG);
    expect(JSON.parse(out[0]!).errors).toEqual([{ code: "INTERNAL", message: "BUSY: lock held" }]);
  });

  it("after the answer — no second object, the stack on stderr, exit 3", () => {
    const { exit, out, err } = crash({ argv: argv("status"), answered: true });
    expect(exit).toBe(EXIT.CONFIG);
    expect(out).toEqual([]);
    expect(err.join("")).toContain("boom in a callback");
  });
});

describe("SCN-ENF-046: an exception of `guard --frontend` is fail-closed", () => {
  it("before the answer — the reason on stderr, empty stdout, exit 2 (not INTERNAL)", () => {
    const { exit, out, err } = crash({ argv: argv("guard", "--frontend", "claude"), answered: false, guardInput: "{}" });
    expect(exit).toBe(UNREADABLE_EXIT);
    expect(exit).toBe(2);
    expect(out).toEqual([]);
    expect(err.join("")).toContain("boom in a callback");
  });

  it("after the answer — exit 2, no second answer", () => {
    const { exit, out } = crash({ argv: argv("guard", "--frontend", "claude"), answered: true });
    expect(exit).toBe(2);
    expect(out).toEqual([]);
  });
});

describe("REQ-ENF-004: an exception of `guard` is a decision, exit 0", () => {
  const event = (phase: string): string => JSON.stringify({ phase, action: "edit", paths: ["src/a.ts"], cwd: "." });

  it("pre — deny with the reason and hint `warrant validate`, exit 0", () => {
    const { exit, out, err } = crash({ argv: argv("guard"), answered: false, guardInput: event("pre") });
    expect(exit).toBe(EXIT.OK);
    expect(out).toHaveLength(1);
    const envelope = JSON.parse(out[0]!);
    expect(envelope).toMatchObject({ command: "guard", ok: true, errors: [] });
    expect(envelope.data).toEqual({ decision: "deny", reason: "guard failed: boom in a callback", hints: ["run `warrant validate`"] });
    expect(err.join("")).toContain("boom in a callback");
  });

  it("stdin not read yet or without a phase — deny, as pre", () => {
    for (const guardInput of [undefined, "not json", JSON.stringify({ action: "edit" })]) {
      const state: CrashState = { argv: argv("guard"), answered: false, ...(guardInput === undefined ? {} : { guardInput }) };
      const { exit, out } = crash(state);
      expect(exit, String(guardInput)).toBe(EXIT.OK);
      expect(JSON.parse(out[0]!).data.decision, String(guardInput)).toBe("deny");
    }
  });

  it("post — allow without hints, the message on stderr, exit 0", () => {
    const { exit, out, err } = crash({ argv: argv("guard"), answered: false, guardInput: event("post") });
    expect(exit).toBe(EXIT.OK);
    expect(JSON.parse(out[0]!).data).toEqual({ decision: "allow", hints: [] });
    expect(err.join("")).toContain("boom in a callback");
  });

  it("a broken post event is still post — allow", () => {
    const { out } = crash({ argv: argv("guard"), answered: false, guardInput: JSON.stringify({ phase: "post" }) });
    expect(JSON.parse(out[0]!).data.decision).toBe("allow");
  });

  it("after the decision — no second object, stderr, exit 0", () => {
    const { exit, out, err } = crash({ argv: argv("guard"), answered: true, guardInput: event("pre") });
    expect(exit).toBe(EXIT.OK);
    expect(out).toEqual([]);
    expect(err.join("")).toContain("boom in a callback");
  });
});
