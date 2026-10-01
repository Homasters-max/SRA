/**
 * Classes of error codes and the one choice of the exit code (REQ-KRN-003,
 * exit-contract D1, D2): every code has one class, the class gives its code,
 * and `exitCodeFor` takes the eldest by `3 > 1 > 4 > 2 > 0`.
 */
import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  EXIT,
  exitCodeFor,
  isErrorCode,
  isRetryable,
  type ErrorClass,
  type ErrorCode,
  type ExitCode,
  type Outcome
} from "../../src/core/errors.js";

const codesOf = (wanted: ErrorClass): string[] =>
  Object.entries(ERROR_CODES)
    .filter(([, cls]) => cls === wanted)
    .map(([code]) => code)
    .sort();

const errors = (...codes: ErrorCode[]) => codes.map((code) => ({ code }));

describe("classes of error codes (REQ-KRN-003)", () => {
  it("every code has one of the four classes", () => {
    for (const cls of Object.values(ERROR_CODES)) expect(["rule", "wait", "config", "retry"]).toContain(cls);
  });

  it("rule — the violations of a PR judged by `warrant ci`", () => {
    expect(codesOf("rule")).toEqual(
      [
        "TOPOLOGY_VIOLATION",
        "RECORD_MISMATCH",
        "REF_NOT_VERIFIED",
        "SCOPE_VIOLATION",
        "GATE_NOT_PASSED",
        "CHANGE_NOT_VERIFYING",
        "EVIDENCE_NOT_VERIFIED",
        "SPECS_NOT_ARCHIVED"
      ].sort()
    );
  });

  it("wait — GATES_NOT_PASSED, POLICY_CONFLICT; retry — BUSY, CHECK_TIMEOUT, FORGE_UNAVAILABLE", () => {
    expect(codesOf("wait")).toEqual(["GATES_NOT_PASSED", "POLICY_CONFLICT"]);
    expect(codesOf("retry")).toEqual(["BUSY", "CHECK_TIMEOUT", "FORGE_UNAVAILABLE"]);
  });

  it("the new codes FORGE_ACCESS and PACK_VERSION_RANGE, USAGE and INTERNAL are config", () => {
    for (const code of ["FORGE_ACCESS", "PACK_VERSION_RANGE", "USAGE", "INTERNAL", "NOT_CANONICAL"] as const) {
      expect(ERROR_CODES[code]).toBe("config");
    }
  });

  it("only a code of class retry is retryable", () => {
    for (const code of Object.keys(ERROR_CODES) as ErrorCode[]) expect(isRetryable(code)).toBe(ERROR_CODES[code] === "retry");
  });

  it("isErrorCode knows the catalogue and nothing of the prototype", () => {
    expect(isErrorCode("FORGE_ACCESS")).toBe(true);
    expect(isErrorCode("toString")).toBe(false);
    expect(isErrorCode("NOPE")).toBe(false);
  });
});

describe("exitCodeFor (REQ-KRN-003, exit-contract D2)", () => {
  it("one code of each class gives the code of its class", () => {
    expect(exitCodeFor(errors("TOPOLOGY_VIOLATION"))).toBe(1);
    expect(exitCodeFor(errors("GATES_NOT_PASSED"))).toBe(2);
    expect(exitCodeFor(errors("CONFIG_MISSING"))).toBe(3);
    expect(exitCodeFor(errors("BUSY"))).toBe(4);
  });

  it("outcomes: CONTINUE 0, STOP and FAIL 1, WAIT and ESCALATE 2; nothing — 0", () => {
    const table: [Outcome | undefined, ExitCode][] = [
      [undefined, 0],
      ["CONTINUE", 0],
      ["STOP", 1],
      ["FAIL", 1],
      ["WAIT", 2],
      ["ESCALATE", 2]
    ];
    for (const [outcome, code] of table) expect([outcome, exitCodeFor([], outcome)]).toEqual([outcome, code]);
  });

  it("priority 3 > 1 > 4 > 2 > 0 over every mix of classes and outcomes", () => {
    const representative: Record<ErrorClass, ErrorCode> = {
      rule: "SCOPE_VIOLATION",
      wait: "POLICY_CONFLICT",
      config: "SCHEMA_VIOLATION",
      retry: "CHECK_TIMEOUT"
    };
    const classes = Object.keys(representative) as ErrorClass[];
    const outcomes: (Outcome | undefined)[] = [undefined, "CONTINUE", "STOP", "FAIL", "WAIT", "ESCALATE"];
    const codeOf = { rule: 1, wait: 2, config: 3, retry: 4 } as const;
    const outcomeCode = { CONTINUE: 0, STOP: 1, FAIL: 1, WAIT: 2, ESCALATE: 2 } as const;
    for (let mask = 0; mask < 1 << classes.length; mask++) {
      const picked = classes.filter((_, i) => (mask & (1 << i)) !== 0);
      for (const outcome of outcomes) {
        const present = new Set<number>(picked.map((cls) => codeOf[cls]));
        if (outcome !== undefined) present.add(outcomeCode[outcome]);
        const expected = [3, 1, 4, 2].find((code) => present.has(code)) ?? 0;
        const got = exitCodeFor(
          picked.map((cls) => ({ code: representative[cls] })),
          outcome
        );
        expect({ picked, outcome, code: got }).toEqual({ picked, outcome, code: expected });
      }
    }
  });

  it("the cases of the spec", () => {
    // SCN-KRN-161: CHECK_TIMEOUT with WAIT — 4; with CHECK_NOT_CONFIGURED too — 3.
    expect(exitCodeFor(errors("CHECK_TIMEOUT"), "WAIT")).toBe(EXIT.RETRY);
    expect(exitCodeFor(errors("CHECK_TIMEOUT", "CHECK_NOT_CONFIGURED"), "WAIT")).toBe(EXIT.CONFIG);
    // A failed check under a violation of the PR or STOP — 1.
    expect(exitCodeFor(errors("BUSY", "SCOPE_VIOLATION"))).toBe(EXIT.FAIL);
    expect(exitCodeFor(errors("CHECK_TIMEOUT"), "STOP")).toBe(EXIT.FAIL);
    // The refusal of `transition` under CONTINUE is 2 by the class of GATES_NOT_PASSED.
    expect(exitCodeFor(errors("GATES_NOT_PASSED"), "CONTINUE")).toBe(EXIT.WAIT);
    // Findings of `analyze`.
    expect(exitCodeFor([], "FAIL")).toBe(EXIT.FAIL);
  });

  it("a code outside the catalogue, read from outside, counts as config", () => {
    expect(exitCodeFor([{ code: "FROM_ELSEWHERE" as ErrorCode }])).toBe(EXIT.CONFIG);
  });
});
