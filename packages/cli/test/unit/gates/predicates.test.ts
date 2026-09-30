/**
 * The predicates of the verdict algorithm shared by the gate engine,
 * `evidence-complete` and the judge of `warrant ci` (design D2, D5 of
 * agent-merge, A-39, A-40): `appliesTo`, `countingWaiver`, `requiresHuman`.
 */
import { describe, expect, it } from "vitest";

import { appliesTo, appliesWhenPaths, countingWaiver } from "../../../src/core/gates/predicates.js";
import { requiresHuman } from "../../../src/core/roles.js";
import type { WaiverInput } from "../../../src/core/waivers/read.js";

const GATED = { id: "docs-built", applies_when: { changed_paths: ["docs/**"] }, waivable: true };
const DEFINITIONS = new Map<string, Record<string, unknown>>([
  ["docs-built", GATED],
  ["tests-passed", { id: "tests-passed", waivable: true }],
  ["scope-valid", { id: "scope-valid", waivable: false }]
]);
const CTX = { today: "2026-10-01", approvers: new Set(["kat"]) };

function waiver(id: string, gate: string, extra: Record<string, unknown> = {}): WaiverInput {
  return {
    path: `.warrant/waivers/${id}.json`,
    json: { id, change: "add-search", gate, approved_by: "human:kat", expires_at: "2026-12-31", waiver_state: "ACTIVE", ...extra }
  };
}

describe("appliesTo", () => {
  it("a gate without applies_when applies to any diff; with it — only to a diff touching its paths, either side of a rename", () => {
    expect(appliesWhenPaths(DEFINITIONS.get("tests-passed"))).toEqual([]);
    expect(appliesTo(DEFINITIONS.get("tests-passed"), [])).toBe(true);
    expect(appliesTo(GATED, [{ status: "M", path: "src/a.ts" }])).toBe(false);
    expect(appliesTo(GATED, [{ status: "M", path: "docs/a.md" }])).toBe(true);
    expect(appliesTo(GATED, [{ status: "R", path: "notes/a.md", from: "docs/a.md" }])).toBe(true);
    expect(appliesTo(undefined, [])).toBe(true);
  });
});

describe("countingWaiver", () => {
  it("the first waiver by id of the gate and Change that counts; those before it that do not, with the reason", () => {
    const waivers = [
      waiver("WAV-2026-003", "tests-passed"),
      waiver("WAV-2026-001", "tests-passed", { waiver_state: "REVOKED" }),
      waiver("WAV-2026-002", "tests-passed", { expires_at: "2026-09-30" }),
      waiver("WAV-2026-004", "tests-passed", { change: "fix-login" })
    ];
    const judged = countingWaiver("tests-passed", "add-search", waivers, DEFINITIONS, CTX);
    expect(judged.counting?.json["id"]).toBe("WAV-2026-003");
    expect(judged.ignored.map((i) => [i.waiver.json["id"], i.reason])).toEqual([
      ["WAV-2026-001", "state"],
      ["WAV-2026-002", "expired"]
    ]);
  });

  it("no waiver counts: an approver outside roles, a gate not waivable, another Change", () => {
    expect(countingWaiver("tests-passed", "add-search", [waiver("WAV-2026-001", "tests-passed", { approved_by: "human:mallory" })], DEFINITIONS, CTX)).toEqual({
      counting: undefined,
      ignored: [{ waiver: expect.anything(), reason: "approver" }]
    });
    expect(countingWaiver("scope-valid", "add-search", [waiver("WAV-2026-001", "scope-valid")], DEFINITIONS, CTX).counting).toBeUndefined();
    expect(countingWaiver("tests-passed", "fix-login", [waiver("WAV-2026-001", "tests-passed")], DEFINITIONS, CTX)).toEqual({ counting: undefined, ignored: [] });
  });
});

describe("requiresHuman", () => {
  it("gate human-approval on the transition, and only there", () => {
    const policy = { gates: { "SPECIFIED->APPROVED": ["human-approval"], "VERIFYING->MERGED": ["tests-passed"] } };
    expect(requiresHuman(policy, "SPECIFIED->APPROVED")).toBe(true);
    expect(requiresHuman(policy, "VERIFYING->MERGED")).toBe(false);
    expect(requiresHuman(policy, "APPROVED->IMPLEMENTING")).toBe(false);
  });
});
