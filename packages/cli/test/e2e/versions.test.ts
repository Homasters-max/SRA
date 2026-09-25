// e2e: package
/**
 * Дисциплина версий (review of phase 3, R-14): `scripts/versions-lib.js`, общий
 * с `npm run versions:check`. Первый блок проверяет сам репозиторий против
 * последнего tag `v*`; в CI tags обязаны быть (checkout с полной историей), иначе
 * проверка молча ничего бы не сравнивала. Второй — правила на временном репозитории.
 */
// @ts-expect-error — общий helper со скриптом: plain Node ESM без типов (как golden-lib.js).
import { checkVersions } from "../../../../scripts/versions-lib.js";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { REPO_ROOT, makeTempDir, removeDir } from "../helpers/cli.js";
import { git } from "../helpers/git.js";

interface VersionError {
  component: string;
  message: string;
}
interface VersionCheck {
  tag: string | null;
  errors: VersionError[];
}
const check = checkVersions as (root: string) => VersionCheck;

const hasGit = spawnSync("git", ["--version"]).status === 0;

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

function put(root: string, file: string, content: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}

function pkg(version: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name: "warrant", version, dependencies: { ajv: "^8" }, ...extra }, null, 2);
}

function packJson(version: string): string {
  return JSON.stringify({ $schema: "warrant://pack/1", id: "p", version }, null, 2);
}

function skill(version: string, body = "body"): string {
  return `---\nname: s\nversion: ${version}\n---\n\n${body}\n`;
}

/** A released repository: CLI 1.0.0, pack p 0.1.0, skill c/s 0.1.0, tag v1.0.0. */
function released(): string {
  const root = makeTempDir("warrant-versions-");
  tempDirs.push(root);
  git(root, "-c", "init.defaultBranch=main", "init", "--quiet");
  git(root, "config", "user.name", "warrant-test");
  git(root, "config", "user.email", "test@example.invalid");
  put(root, "package.json", pkg("1.0.0"));
  put(root, "packages/cli/src/a.ts", "export const a = 1;\n");
  put(root, "packs/p/pack.json", packJson("0.1.0"));
  put(root, "packs/p/gates/g.json", "{}\n");
  put(root, "packs/p/golden/x/expected.json", "{}\n");
  put(root, "sra/skills/c/s/SKILL.md", skill("0.1.0"));
  put(root, "docs/readme.md", "# docs\n");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "release");
  git(root, "tag", "v1.0.0");
  return root;
}

const components = (result: VersionCheck): string[] => result.errors.map((e) => e.component).sort();

describe.skipIf(!hasGit)("version discipline (R-14)", () => {
  it("this repository: every component changed since the last release tag carries a new version", () => {
    const result = check(REPO_ROOT);
    if (result.tag === null) {
      // A checkout without tags compares nothing; in CI that is a broken checkout, not a pass.
      expect(process.env["GITHUB_ACTIONS"], "CI checkout must fetch tags (fetch-depth: 0)").not.toBe("true");
      return;
    }
    expect(result.errors).toEqual([]);
  });

  it("no release tag: nothing to compare with", () => {
    const root = makeTempDir("warrant-versions-");
    tempDirs.push(root);
    git(root, "init", "--quiet");
    expect(check(root)).toMatchObject({ tag: null, errors: [] });
  });

  // SCN-SDD-021: pack `p` stands for core-sdd — files outside golden/ changed, pack.json at the version of the tag →
  // the error names the pack; `npm run versions:check` (scripts/versions-check.js) runs the same checkVersions.
  it("a component changed without a bump is an error; docs, golden, scripts and devDependencies are not", () => {
    const root = released();
    expect(check(root)).toMatchObject({ tag: "v1.0.0", errors: [] });

    // Not shipped or not part of any component's content.
    put(root, "docs/readme.md", "# docs, edited\n");
    put(root, "packs/p/golden/x/expected.json", '{"changed":true}\n');
    put(root, "package.json", pkg("1.0.0", { scripts: { test: "vitest" }, devDependencies: { vitest: "^3" } }));
    expect(check(root).errors).toEqual([]);

    put(root, "packs/p/gates/g.json", '{"accepts_attestation":["ci"]}\n');
    put(root, "packages/cli/src/b.ts", "export const b = 1;\n"); // untracked counts too
    put(root, "sra/skills/c/s/SKILL.md", skill("0.1.0", "sharper body"));
    const result = check(root);
    expect(components(result)).toEqual(["cli", "pack p", "skill c/s"]);
    expect(result.errors.find((e) => e.component === "pack p")?.message).toContain("packs/p/pack.json still says 0.1.0");

    put(root, "package.json", pkg("1.0.1", { scripts: { test: "vitest" } }));
    put(root, "packs/p/pack.json", packJson("0.1.1"));
    put(root, "sra/skills/c/s/SKILL.md", skill("0.1.1", "sharper body"));
    expect(check(root).errors).toEqual([]);
  });

  it("a shipped field of package.json counts as a CLI change; a version lower than the release is an error", () => {
    const root = released();
    put(root, "package.json", pkg("1.0.0", { dependencies: { ajv: "^9" } }));
    expect(components(check(root))).toEqual(["cli"]);

    put(root, "package.json", pkg("0.9.0"));
    put(root, "packs/p/pack.json", packJson("0.0.9"));
    const lower = check(root);
    expect(components(lower)).toEqual(["cli", "pack p"]);
    expect(lower.errors[0]?.message).toContain("lower than");
  });

  it("a component new since the release needs no bump", () => {
    const root = released();
    put(root, "packs/q/pack.json", JSON.stringify({ id: "q", version: "0.1.0" }));
    put(root, "packs/q/gates/g.json", "{}\n");
    expect(check(root).errors).toEqual([]);
  });
});
