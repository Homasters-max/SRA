import { describe, expect, it } from "vitest";
import { cliError, EXIT, WarrantError } from "../../src/core/errors.js";
import { emit, failure, success, toEnvelope, type Printer } from "../../src/io/output.js";

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
