/**
 * The normalised event of `guard` and the lines of its hints (REQ-ENF-004,
 * ADR-0018 п. 2, ADR-0019 п. 10): what reads as an event, what a broken one
 * keeps (its phase, F9), the finding line and the limit of 10.
 */
import { describe, expect, it } from "vitest";

import type { CliError } from "../../../src/core/errors.js";
import { parseEvent } from "../../../src/core/guard/event.js";
import { findingHints, findingLine } from "../../../src/core/guard/guard.js";

describe("parseEvent", () => {
  it("reads phase, action, paths, argv and cwd; other keys are ignored", () => {
    const text = JSON.stringify({ phase: "pre", action: "shell", paths: [], argv: ["pytest"], cwd: "/p", run: "RUN-X" });
    expect(parseEvent(text)).toEqual({ ok: true, event: { phase: "pre", action: "shell", paths: [], argv: ["pytest"], cwd: "/p" } });
  });

  it("not JSON, not an object, no phase: the phase is unknown", () => {
    expect(parseEvent("{")).toMatchObject({ ok: false, phase: undefined, message: expect.stringContaining("not JSON") });
    expect(parseEvent("[]")).toMatchObject({ ok: false, phase: undefined });
    expect(parseEvent(JSON.stringify({ phase: "during", action: "edit", paths: [], cwd: "." }))).toMatchObject({ ok: false, phase: undefined });
  });

  it("a broken event keeps its phase", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ phase: "post", action: "write", paths: [], cwd: "." }, "action"],
      [{ phase: "post", action: "edit", paths: "a.md", cwd: "." }, "paths"],
      [{ phase: "post", action: "edit", paths: [1], cwd: "." }, "paths"],
      [{ phase: "post", action: "shell", paths: [], argv: "pytest", cwd: "." }, "argv"],
      [{ phase: "post", action: "edit", paths: [] }, "cwd"]
    ];
    for (const [event, named] of cases) {
      expect(parseEvent(JSON.stringify(event))).toMatchObject({ ok: false, phase: "post", message: expect.stringContaining(named) });
    }
  });
});

describe("hint lines of findings", () => {
  const error = (n: number): CliError => ({ code: "NOT_CANONICAL", message: `not canonical ${n}`, path: `.warrant/a${n}.json`, hint: "run `warrant fmt`" });

  it("CODE path: message — hint; without path or hint the parts are left out", () => {
    expect(findingLine(error(1))).toBe("NOT_CANONICAL .warrant/a1.json: not canonical 1 — run `warrant fmt`");
    expect(findingLine({ code: "ID_FORMAT", message: "bad id" })).toBe("ID_FORMAT: bad id");
  });

  it("at most 10 lines and «and N more»", () => {
    expect(findingHints(Array.from({ length: 10 }, (_, i) => error(i)))).toHaveLength(10);
    const hints = findingHints(Array.from({ length: 13 }, (_, i) => error(i)));
    expect(hints).toHaveLength(11);
    expect(hints[9]).toContain("not canonical 9");
    expect(hints[10]).toBe("and 3 more");
  });
});
