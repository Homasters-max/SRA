/**
 * What `npm i -g` installs (review of phase 3, R-15): the file list of
 * `npm pack` holds everything the installed CLI reads at run time — the bin,
 * the kernel schemas, every file of every bundled pack except `golden/`, and the
 * `SKILL.md` of every skill a bundled pack provides (`provides.skills`, found
 * next to `packs/` by `sync`). A path missing from `files` of package.json used
 * to surface only on an installed CLI (debt `files`: skill `adversarial-review`).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import spawnCjs from "cross-spawn";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../helpers/cli.js";

const spawn = spawnCjs as unknown as typeof import("cross-spawn");

function packedFiles(): Set<string> {
  const run = spawn.sync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`npm pack --dry-run failed: ${run.stderr}`);
  const report = JSON.parse(run.stdout) as { files: { path: string }[] }[];
  return new Set((report[0]?.files ?? []).map((f) => f.path.split(path.sep).join("/")));
}

function filesUnder(rel: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(path.join(REPO_ROOT, dir))) {
      const child = `${dir}/${name}`;
      if (statSync(path.join(REPO_ROOT, child)).isDirectory()) walk(child);
      else out.push(child);
    }
  };
  walk(rel);
  return out.sort();
}

describe("package contents (R-15)", () => {
  const packed = packedFiles();
  const missing = (files: string[]): string[] => files.filter((f) => !packed.has(f));

  it("ships the bin and every kernel schema", () => {
    expect(missing(["packages/cli/dist/bin/warrant.js", ...filesUnder("packages/cli/schemas")])).toEqual([]);
  });

  it("ships every bundled pack without its golden fixtures", () => {
    for (const id of readdirSync(path.join(REPO_ROOT, "packs"))) {
      const files = filesUnder(`packs/${id}`);
      expect(missing(files.filter((f) => !f.startsWith(`packs/${id}/golden/`))), id).toEqual([]);
      expect([...packed].filter((f) => f.startsWith(`packs/${id}/golden/`)), id).toEqual([]);
    }
  });

  it("ships the SKILL.md of every skill a bundled pack provides", () => {
    const skills: string[] = [];
    for (const id of readdirSync(path.join(REPO_ROOT, "packs"))) {
      const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, "packs", id, "pack.json"), "utf8")) as {
        provides?: { skills?: string[] };
      };
      for (const entry of manifest.provides?.skills ?? []) skills.push(`sra/skills/${entry.split("@")[0]}/SKILL.md`);
    }
    expect(skills.length).toBeGreaterThan(0);
    expect(missing(skills)).toEqual([]);
  });
});
