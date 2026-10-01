import { describe, expect, it } from "vitest";
import { cliError, EXIT, WarrantError } from "../../src/core/errors.js";
import { claimAnswer, emit, failure, failures, success, toEnvelope, type Printer } from "../../src/io/output.js";

function capture(): Printer & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (t) => out.push(t), stderr: (t) => err.push(t) };
}

describe("envelope", () => {
  it("prints exactly one JSON object with the contract keys in order", () => {
    const printer = capture();
    const code = emit("fmt", success({ changed: [] }), printer);
    expect(code).toBe(EXIT.OK);
    expect(printer.out).toHaveLength(1);
    const parsed = JSON.parse(printer.out[0]!);
    expect(Object.keys(parsed)).toEqual(["command", "ok", "data", "errors"]);
    expect(parsed).toEqual({ command: "fmt", ok: true, data: { changed: [] }, errors: [] });
    expect(printer.err).toHaveLength(0);
  });

  it("includes change between ok and data when present", () => {
    const envelope = toEnvelope("status", success({}, "add-search"));
    expect(Object.keys(envelope)).toEqual(["command", "ok", "change", "data", "errors"]);
  });

  it("USAGE error → ok false, exit code 3, error has code and message", () => {
    const printer = capture();
    const code = emit("id", failure(new WarrantError("USAGE", "missing AREA")), printer);
    expect(code).toBe(EXIT.CONFIG);
    const parsed = JSON.parse(printer.out[0]!);
    expect(parsed.ok).toBe(false);
    expect(parsed.errors).toEqual([{ code: "USAGE", message: "missing AREA" }]);
  });

  it("carries path when the error has one", () => {
    const err = new WarrantError("SCHEMA_VIOLATION", "bad", { path: ".warrant/warrant.json" });
    expect(err.toCliError()).toEqual({ code: "SCHEMA_VIOLATION", message: "bad", path: ".warrant/warrant.json" });
  });

  it("prints hint after path, and neither key when absent (REQ-KRN-002)", () => {
    const printer = capture();
    const err = new WarrantError("LOCK_MISMATCH", "lock file is missing", { path: "l.json", hint: "run `warrant sync`" });
    emit("validate", failure(err), printer);
    const entry = JSON.parse(printer.out[0]!).errors[0];
    expect(Object.keys(entry)).toEqual(["code", "message", "path", "hint"]);
    expect(entry.hint).toBe("run `warrant sync`");
    expect(Object.keys(cliError("USAGE", "x", { hint: "pass --y" }))).toEqual(["code", "message", "hint"]);
    expect(Object.keys(new WarrantError("USAGE", "x").toCliError())).toEqual(["code", "message"]);
  });
});

describe("retryable (REQ-KRN-002, exit-contract D5)", () => {
  it("a code of class retry gets retryable: true last; others have no key (SCN-KRN-160)", () => {
    const busy = new WarrantError("BUSY", "lock held", { path: ".git/warrant/check.lock", hint: "wait" });
    const envelope = toEnvelope("check", failure(busy));
    expect(Object.keys(envelope.errors[0]!)).toEqual(["code", "message", "path", "hint", "retryable"]);
    expect(envelope.errors[0]!.retryable).toBe(true);
    const missing = toEnvelope("validate", failure(new WarrantError("CONFIG_MISSING", "no warrant.json")));
    expect(missing.errors).toEqual([{ code: "CONFIG_MISSING", message: "no warrant.json" }]);
  });

  it("literals of any key order and every retry code — CHECK_TIMEOUT, FORGE_UNAVAILABLE", () => {
    const literal = { hint: "retry", message: "timed out", code: "CHECK_TIMEOUT" } as const;
    const envelope = toEnvelope("verify", failures([literal, cliError("FORGE_UNAVAILABLE", "down"), cliError("USAGE", "x")], {}));
    expect(envelope.errors.map((e) => Object.keys(e))).toEqual([
      ["code", "message", "hint", "retryable"],
      ["code", "message", "retryable"],
      ["code", "message"]
    ]);
  });

  it("the result keeps the errors as built; only the envelope adds the key", () => {
    const result = failures([cliError("BUSY", "held")]);
    expect(result.errors).toEqual([{ code: "BUSY", message: "held" }]);
  });
});

describe("exit code of a result (exit-contract D2, D4)", () => {
  it("failures computes it from errors and outcome", () => {
    expect(failures([cliError("BUSY", "held")]).exitCode).toBe(EXIT.RETRY);
    expect(failures([cliError("BUSY", "held"), cliError("CONFIG_INVALID", "bad")]).exitCode).toBe(EXIT.CONFIG);
    expect(failures([], {}, "add-search", "STOP")).toEqual({ ok: false, change: "add-search", data: {}, errors: [], outcome: "STOP", exitCode: EXIT.FAIL });
    expect(failures([cliError("CHECK_TIMEOUT", "slow")], { n: 1 }, undefined, "WAIT").exitCode).toBe(EXIT.RETRY);
  });

  it("success is 0 and carries no outcome", () => {
    expect(success({})).toEqual({ ok: true, data: {}, errors: [], exitCode: EXIT.OK });
  });

  it("emit returns the computed code", () => {
    expect(emit("ci", failures([cliError("SCOPE_VIOLATION", "x"), cliError("BUSY", "y")]), capture())).toBe(EXIT.FAIL);
  });
});

describe("one answer per process (exit-contract D9)", () => {
  it("claimAnswer gives the answer once: emitToProcess, emitNative and the crash handler print no second object", () => {
    expect(claimAnswer()).toBe(true);
    expect(claimAnswer()).toBe(false);
    expect(claimAnswer()).toBe(false);
  });
});
