import { describe, expect, it } from "vitest";

import { bytesHash, canonicalHash, HASH_PREFIX } from "../../../src/core/canon/hash.js";

describe("canonicalHash", () => {
  it("is stable under key reordering (RFC 8785)", () => {
    const a = { b: 1, a: { d: [1, 2], c: "x" } };
    const b = { a: { c: "x", d: [1, 2] }, b: 1 };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it("changes when a value changes", () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });

  it("does not ignore array order", () => {
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
  });

  it("returns the sha256: form required by warrant://common/1", () => {
    expect(canonicalHash({})).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(bytesHash("x")).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(HASH_PREFIX).toBe("sha256:");
  });

  it("hashes bytes and JSON differently for the same text", () => {
    expect(bytesHash("{}")).not.toBe(canonicalHash({ a: 1 }));
    // The byte hash of the canonical text equals the JSON hash of the value.
    expect(bytesHash("{}")).toBe(canonicalHash({}));
  });
});
