/**
 * `projectPath` — the one owner of "absolute path → project path or outside"
 * (A-20, design §4), and `reportPath` built on it.
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { projectPath, reportPath } from "../../src/core/fs.js";

describe("projectPath (A-20)", () => {
  const root = path.resolve("/work/project");

  it("a file inside: POSIX path relative to the root", () => {
    expect(projectPath(root, path.join(root, "openspec", "specs", "a.md"))).toBe("openspec/specs/a.md");
  });

  it("the root itself: empty string", () => {
    expect(projectPath(root, root)).toBe("");
  });

  it("a directory named `..cache` is inside: `..` only as a whole segment is outside", () => {
    expect(projectPath(root, path.join(root, "..cache", "x.json"))).toBe("..cache/x.json");
    expect(projectPath(root, path.join(root, "..", "other", "x.json"))).toBeUndefined();
    expect(projectPath(root, path.dirname(root))).toBeUndefined();
  });

  it("another drive is outside (win32 rules on every platform)", () => {
    expect(projectPath("C:\\work\\project", "D:\\work\\project\\a.json", path.win32)).toBeUndefined();
    expect(projectPath("C:\\work\\project", "C:\\work\\project\\..cache\\a.json", path.win32)).toBe("..cache/a.json");
    expect(projectPath("C:\\work\\project", "C:\\work\\other\\a.json", path.win32)).toBeUndefined();
  });

  it("posix rules on every platform", () => {
    expect(projectPath("/work/project", "/work/project/src/a.ts", path.posix)).toBe("src/a.ts");
    expect(projectPath("/work/project", "/work/projectile/a.ts", path.posix)).toBeUndefined();
  });

  it("reportPath: the project path inside, the absolute POSIX path outside", () => {
    expect(reportPath(path.join(root, "..cache", "x.json"), root)).toBe("..cache/x.json");
    const outside = path.resolve("/elsewhere/x.json");
    expect(reportPath(outside, root)).toBe(outside.split(path.sep).join("/"));
  });
});
