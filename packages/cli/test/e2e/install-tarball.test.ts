// e2e: package
/**
 * The CLI as a project under WARRANT gets it (REQ-VER-016, release-path design D4, WS-02): the tarball of `npm pack` of
 * this checkout, installed globally into an isolated prefix, answers in an empty directory outside the repository —
 * `dist` and the dependencies come only from the tarball. `--version` reads only package.json, so `validate` runs too:
 * it loads a command, its modules of `dist` and the dependencies. `npm test` builds `dist` before vitest, so the pack
 * skips scripts; the tarball goes to a temporary directory, not the checkout. The form `github:…#<tag>` needs a tag —
 * the canary holds it (`.github/workflows/canary.yml`).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import spawnCjs from "cross-spawn";
import { afterAll, describe, expect, it } from "vitest";

import { REPO_ROOT, makeTempDir, removeDir } from "../helpers/cli.js";

const spawn = spawnCjs as unknown as typeof import("cross-spawn");

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

function temp(prefix: string): string {
  const dir = makeTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

function run(command: string, args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawn.sync(command, args, { cwd, encoding: "utf8" });
  return { status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}

describe("the CLI from its tarball (REQ-VER-016)", () => {
  it("SCN-VER-126 npm pack → npm i -g --prefix → warrant --version and validate in an empty directory", () => {
    const out = temp("warrant-pack-");
    const packed = run("npm", ["pack", "--ignore-scripts", "--pack-destination", out], REPO_ROOT);
    expect(packed.status, packed.stderr + packed.stdout).toBe(0);
    const tarball = readdirSync(out).find((name) => name.endsWith(".tgz"));
    expect(tarball).toBeDefined();

    const prefix = temp("warrant-prefix-");
    const installed = run(
      "npm",
      ["i", "-g", "--prefix", prefix, "--prefer-offline", "--no-audit", "--no-fund", path.join(out, tarball as string)],
      out,
    );
    expect(installed.status, installed.stderr + installed.stdout).toBe(0);

    const bin = process.platform === "win32" ? path.join(prefix, "warrant.cmd") : path.join(prefix, "bin", "warrant");
    const empty = temp("warrant-empty-");
    const version = (JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { version: string }).version;

    const shown = run(bin, ["--version"], empty);
    expect(shown.status, shown.stderr).toBe(0);
    expect(shown.stdout.trim()).toBe(version);

    const validated = run(bin, ["validate"], empty);
    const envelope = JSON.parse(validated.stdout) as { command: string; ok: boolean; errors: { code: string }[] };
    expect(envelope.command).toBe("validate");
    expect(envelope.ok).toBe(false);
    expect(envelope.errors.map((e) => e.code)).toContain("CONFIG_MISSING");
  });
});
