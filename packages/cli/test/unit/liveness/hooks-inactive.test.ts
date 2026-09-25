/**
 * `core/liveness`: `FRONTEND_HOOKS_INACTIVE` as a pure function of the diff
 * paths, the Runs of the Change and `paths.*` of `warrant.json` (REQ-VER-009,
 * SCN-VER-053…055): only paths under `paths.src` ∪ `paths.tests`, only `post`
 * events, at most 10 paths in diff order and `more` for the rest, nothing
 * without `paths.src` and `paths.tests`.
 */
import { describe, expect, it } from "vitest";

import type { WarrantConfig } from "../../../src/core/config.js";
import { hooksInactive } from "../../../src/core/liveness/index.js";
import type { GuardEventRecord } from "../../../src/core/run/types.js";

function configWith(paths: WarrantConfig["paths"]): WarrantConfig {
  return { kernel: "0.5", openspec: "1.13.x", packs: [], defaults: { checkTimeoutS: undefined }, paths, roles: new Map(), frontends: [] };
}

const CODE = configWith({ src: "src", tests: "tests" });

function event(phase: GuardEventRecord["phase"], paths: string[]): GuardEventRecord {
  return { at: "2026-09-25T10:00:00Z", phase, action: "edit", paths, decision: "allow", findings: [], rules_shown: [] };
}

describe("hooksInactive", () => {
  it("names a path under paths.src without a post event (SCN-VER-053)", () => {
    const finding = hooksInactive(["docs/notes.md", "src/app.py"], [], CODE);
    expect(finding).toMatchObject({ code: "FRONTEND_HOOKS_INACTIVE", paths: ["src/app.py"], more: 0 });
    expect(finding?.message).toContain("src/app.py");
  });

  it("is absent when every code path has a post event in some Run; other paths do not count (SCN-VER-054)", () => {
    const runs = [{ guard_events: [event("post", ["src/app.py"])] }, { guard_events: [event("post", ["tests/test_app.py"])] }];
    expect(hooksInactive(["docs/notes.md", "src/app.py", "tests/test_app.py"], runs, CODE)).toBeUndefined();
  });

  it("counts only post events: a pre event of the path is not enough", () => {
    const runs = [{ guard_events: [event("pre", ["src/app.py"]), event("post", ["src/other.py"])] }];
    expect(hooksInactive(["src/app.py", "src/other.py"], runs, CODE)).toMatchObject({ paths: ["src/app.py"], more: 0 });
  });

  it("names 10 paths in diff order and counts the rest in more (SCN-VER-055)", () => {
    const diff = Array.from({ length: 13 }, (_, i) => `src/m${String(i).padStart(2, "0")}.py`);
    const finding = hooksInactive(diff, [], CODE);
    expect(finding?.paths).toEqual(diff.slice(0, 10));
    expect(finding?.more).toBe(3);
    expect(finding?.message).toMatch(/ and 3 more$/);
  });

  it("is not computed without paths.src and paths.tests; one of them is enough", () => {
    expect(hooksInactive(["src/app.py"], [], configWith({}))).toBeUndefined();
    expect(hooksInactive(["tests/a.py", "src/app.py"], [], configWith({ tests: "./tests/" }))).toMatchObject({ paths: ["tests/a.py"] });
  });
});
