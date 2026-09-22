import { describe, expect, it } from "vitest";

import { orderKeys } from "../../../src/core/canon/order-keys.js";
import { getSchema } from "../../../src/core/schemas/loader.js";

function keys(value: unknown): string[] {
  return Object.keys(value as Record<string, unknown>);
}

describe("orderKeys", () => {
  it("puts $schema first and $comment right after it", () => {
    const ordered = orderKeys({ b: 1, $comment: "note", a: 2, $schema: "warrant://config/1" });
    expect(keys(ordered)).toEqual(["$schema", "$comment", "a", "b"]);
  });

  it("orders by the schema's properties, not alphabetically", () => {
    const config = getSchema("config");
    const ordered = orderKeys(
      { paths: { tests: "t" }, packs: {}, openspec: "1.13.x", kernel: "0.1", $schema: "warrant://config/1" },
      config
    );
    // config declares kernel, openspec, packs, paths in that order.
    expect(keys(ordered)).toEqual(["$schema", "kernel", "openspec", "packs", "paths"]);
  });

  it("follows patternProperties into dictionary entries", () => {
    const config = getSchema("config");
    const ordered = orderKeys(
      {
        $schema: "warrant://config/1",
        kernel: "0.1",
        openspec: "1.13.x",
        packs: { zeta: { params: {}, version: "^1.0" }, alpha: { version: "^1.0" } }
      },
      config
    ) as Record<string, Record<string, unknown>>;
    // Dictionary keys are alphabetical; inside an entry the schema order wins.
    expect(keys(ordered["packs"])).toEqual(["alpha", "zeta"]);
    expect(keys(ordered["packs"]!["zeta"])).toEqual(["version", "params"]);
  });

  it("dereferences warrant://common/1 through a nested $ref", () => {
    const profile = getSchema("profile");
    const ordered = orderKeys(
      {
        id: "feature",
        $schema: "warrant://profile/1",
        version: "1.0.0",
        artifacts: { forbidden: ["x"], recommended: ["y"], required: ["z"] }
      },
      profile
    ) as Record<string, Record<string, unknown>>;
    expect(keys(ordered).slice(0, 3)).toEqual(["$schema", "id", "version"]);
    // common/1#/$defs/policy_body declares required, recommended, forbidden.
    expect(keys(ordered["artifacts"])).toEqual(["required", "recommended", "forbidden"]);
  });

  it("orders a top-level dictionary schema alphabetically after $schema (areas)", () => {
    const areas = getSchema("areas");
    const ordered = orderKeys(
      { ZZZ: { capability: "z" }, KRN: { capability: "kernel" }, $schema: "warrant://areas/1" },
      areas
    );
    expect(keys(ordered)).toEqual(["$schema", "KRN", "ZZZ"]);
  });

  it("falls back to alphabetical order without a schema", () => {
    const ordered = orderKeys({ c: 1, a: { z: 1, y: 2 }, b: 3 });
    expect(keys(ordered)).toEqual(["a", "b", "c"]);
    expect(keys((ordered as Record<string, unknown>)["a"])).toEqual(["y", "z"]);
  });

  it("preserves array element order and orders elements recursively", () => {
    const ordered = orderKeys({ list: [{ b: 1, a: 2 }, { d: 1, c: 2 }] }) as Record<string, unknown[]>;
    expect(keys(ordered["list"]![0])).toEqual(["a", "b"]);
    expect(keys(ordered["list"]![1])).toEqual(["c", "d"]);
    expect(ordered["list"]).toHaveLength(2);
  });

  it("leaves values untouched", () => {
    const input = { b: [1, "two", null, true], a: { n: 1.5 } };
    expect(orderKeys(input)).toEqual(input);
  });

  it("does not mutate its input", () => {
    const input = { b: 1, a: 2 };
    orderKeys(input);
    expect(Object.keys(input)).toEqual(["b", "a"]);
  });
});
