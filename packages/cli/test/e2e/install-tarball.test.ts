// e2e: package
/**
 * The CLI as a project under WARRANT gets it (REQ-VER-016, release-path design D4, WS-02): the tarball of `npm pack` of
 * this checkout, installed globally into an isolated prefix, answers in an empty directory outside the repository —
 * `dist` and the dependencies come only from the tarball. `--version` reads only package.json, so `validate` runs too:
 * it loads a command, its modules of `dist` and the dependencies. The tarball comes from the one `npm pack` of the e2e global setup
 * (`helpers/pack-checkout.ts`): packed here, its `prepare` rebuilt `dist` under the forks beside (WS-30); it lies in a
 * temporary directory, not the checkout. The form `github:…#<tag>` needs a tag —
 * the canary holds it (`.github/workflows/canary.yml`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import spawnCjs from "cross-spawn";
import { afterAll, describe, expect, inject, it } from "vitest";

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
    const { tarball } = inject("checkoutPack");

    const prefix = temp("warrant-prefix-");
    const installed = run(
      "npm",
      ["i", "-g", "--prefix", prefix, "--prefer-offline", "--no-audit", "--no-fund", tarball],
      path.dirname(tarball),
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
