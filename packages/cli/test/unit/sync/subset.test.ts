/**
 * Managed subsets of the `sync` plan (design phase-4a §8): `drift` is derived
 * from `own`, a line target keeps every other line and the file's line ending,
 * and `merge` of its own output drifts no more.
 */
import { describe, expect, it } from "vitest";

import { claudeSettingsTarget } from "../../../src/core/sync/claude.js";
import { driftPath, linesTarget } from "../../../src/core/sync/subset.js";

const target = linesTarget(".gitignore", [".warrant/runs/current"]);

function merged(current: string | undefined): string {
  const result = target.merge(current === undefined ? undefined : Buffer.from(current, "utf8"));
  if ("error" in result) throw new Error(result.error.message);
  return result.bytes.toString("utf8");
}

describe("linesTarget", () => {
  it("creates the file, appends after a last line without newline, keeps CRLF", () => {
    expect(merged(undefined)).toBe(".warrant/runs/current\n");
    expect(merged("dist/")).toBe("dist/\n.warrant/runs/current\n");
    expect(merged("dist/\r\n")).toBe("dist/\r\n.warrant/runs/current\r\n");
  });

  it("drifts only without the line; a line with CR or spaces around counts as present", () => {
    expect(target.drift(undefined)).toEqual([""]);
    expect(target.drift(Buffer.from("a\r\n  .warrant/runs/current  \r\n"))).toEqual([]);
    expect(target.drift(Buffer.from(merged("a\n")))).toEqual([]);
  });
});

describe("claude settings target", () => {
  it("drifts at every own pointer without the file, and not after its own merge", () => {
    expect(claudeSettingsTarget.drift(undefined)).toEqual(["/permissions/deny", "/hooks/PreToolUse", "/hooks/PostToolUse"]);
    const result = claudeSettingsTarget.merge(undefined);
    if ("error" in result) throw new Error(result.error.message);
    expect(claudeSettingsTarget.drift(result.bytes)).toEqual([]);
  });

  it("does not merge JSON that is not an object, nor a hooks event that is not an array", () => {
    expect(claudeSettingsTarget.drift(Buffer.from("not json"))).toEqual([""]);
    expect(claudeSettingsTarget.merge(Buffer.from("not json"))).toMatchObject({ error: { code: "CONFIG_INVALID" } });
    expect(claudeSettingsTarget.merge(Buffer.from('{"hooks":{"PreToolUse":{}}}'))).toMatchObject({
      error: { code: "CONFIG_INVALID", path: ".claude/settings.json#/hooks/PreToolUse" }
    });
  });
});

describe("driftPath", () => {
  it("is the file for a line and file#pointer inside JSON", () => {
    expect(driftPath(".gitignore", "")).toBe(".gitignore");
    expect(driftPath(".claude/settings.json", "/permissions/deny")).toBe(".claude/settings.json#/permissions/deny");
  });
});
