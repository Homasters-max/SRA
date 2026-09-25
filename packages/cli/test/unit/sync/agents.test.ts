/**
 * `AGENTS.md` of `sync` (REQ-KRN-033, ADR-0022 п. 5): which rules it holds, its
 * bytes and the 16 KiB limit with `GENERATED_TOO_LARGE` and `hint` (design §10).
 */
import { describe, expect, it } from "vitest";

import type { LoadedRule } from "../../../src/core/packs/types.js";
import { AGENTS_MD_LIMIT, AGENTS_MD_MARKER, agentsMd, generalRules } from "../../../src/core/sync/agents.js";

function rule(id: string, paths: string[], text = `Rule ${id}.`): LoadedRule {
  return { id, pack: "local", path: `.warrant/local/rules/${id}.json`, paths, text, enforcedBy: undefined };
}

/** Text length that makes the file exactly `size` bytes with one rule. */
function sized(size: number): string {
  return "x".repeat(size - Buffer.byteLength(`${AGENTS_MD_MARKER}\n\n\n`));
}

describe("AGENTS.md", () => {
  it("takes only rules whose paths are exactly [\"**\"], in id order", () => {
    const rules = [rule("b", ["**"]), rule("a", ["**"]), rule("c", ["src/**"]), rule("d", ["**", "docs/**"])];
    expect(generalRules(rules).map((r) => r.id)).toEqual(["a", "b"]);
    expect(agentsMd(rules)).toEqual({ bytes: Buffer.from(`${AGENTS_MD_MARKER}\n\nRule a.\n\nRule b.\n`, "utf8") });
  });

  it("is not generated without such rules", () => {
    expect(agentsMd([rule("c", ["src/**"])])).toBeUndefined();
  });

  it("accepts exactly 16 KiB and refuses one byte more with GENERATED_TOO_LARGE and hint (SCN-KRN-133)", () => {
    const fits = agentsMd([rule("a", ["**"], sized(AGENTS_MD_LIMIT))]);
    expect(fits !== undefined && "bytes" in fits && fits.bytes.length).toBe(AGENTS_MD_LIMIT);

    const over = agentsMd([rule("a", ["**"], sized(AGENTS_MD_LIMIT + 1))]);
    expect(over !== undefined && "error" in over && over.error).toMatchObject({ code: "GENERATED_TOO_LARGE", path: "AGENTS.md" });
    expect(over !== undefined && "error" in over && over.error.hint).toBeTruthy();
  });
});
