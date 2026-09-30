/**
 * The class of paths with human acceptance (ADR-0051 п. 2–4) lives in two places: `.github/CODEOWNERS` prevents
 * (the forge will not let the bot merge a PR touching them) and `.warrant/local/profiles/human-acceptance.json`
 * detects (the judge refuses ref `MERGED` from the bot). Both must name the same paths (R-46) and the forge owner
 * must be the maintainer the judge accepts (`roles.maintainer` in `.warrant/warrant.json`).
 * CODEOWNERS notation → profile glob: `/dir/` → `dir/**`, `/file` → `file`, a pattern without `/` matches at any
 * depth → `**\/pattern`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CLI_ROOT } from "../../helpers/cli.js";

const REPO_ROOT = path.resolve(CLI_ROOT, "..", "..");

function read(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

interface Rule {
  pattern: string;
  owners: string[];
}

function codeowners(): Rule[] {
  return read(".github/CODEOWNERS")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [pattern, ...owners] = line.split(/\s+/);
      return { pattern: pattern!, owners };
    });
}

function toGlob(pattern: string): string {
  if (!pattern.startsWith("/")) return pattern.includes("/") ? pattern : `**/${pattern}`;
  const anchored = pattern.slice(1);
  return anchored.endsWith("/") ? `${anchored}**` : anchored;
}

describe("CODEOWNERS ↔ human-acceptance profile (ADR-0051 п. 2–4, R-46)", () => {
  const rules = codeowners();
  const profile = JSON.parse(read(".warrant/local/profiles/human-acceptance.json")) as {
    match: { paths: string[] };
    gates: Record<string, string[]>;
  };
  const config = JSON.parse(read(".warrant/warrant.json")) as { roles: { maintainer: string[] } };

  it("name the same paths", () => {
    expect(rules.map((r) => toGlob(r.pattern)).sort()).toEqual([...profile.match.paths].sort());
  });

  it("every path is owned only by the maintainers the judge accepts", () => {
    const maintainers = config.roles.maintainer.map((login) => `@${login}`);
    for (const rule of rules) {
      expect(rule.owners, rule.pattern).not.toHaveLength(0);
      for (const owner of rule.owners) expect(maintainers, `${rule.pattern}: ${owner}`).toContain(owner);
    }
  });

  it("the profile requires human-approval on VERIFYING->MERGED", () => {
    expect(profile.gates["VERIFYING->MERGED"]).toContain("human-approval");
  });

  it.each([
    ["/packages/cli/src/", "packages/cli/src/**"],
    ["/package.json", "package.json"],
    ["tsconfig*.json", "**/tsconfig*.json"],
    ["/scripts/dev/*-hook.js", "scripts/dev/*-hook.js"],
  ])("notation %s → %s", (pattern, glob) => {
    expect(toGlob(pattern)).toBe(glob);
  });
});
