/**
 * `globalSetup` of the `e2e` project: `npm pack` of the checkout, once, before any test file starts (WS-30).
 *
 * `npm pack` runs `prepare` — the build — even with --ignore-scripts (npm 10 packs a directory through `prepare`).
 * Packed inside a test, the rebuild truncated `dist` under the forks that spawn `dist/bin/warrant.js` beside it:
 * «does not provide an export named …». Vitest awaits every global setup before it collects tests, so the rebuild
 * here races nothing. The tests read the tarball and its file list through `inject("checkoutPack")`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import spawnCjs from "cross-spawn";
import type { TestProject } from "vitest/node";

import { REPO_ROOT } from "./cli.js";

const spawn = spawnCjs as unknown as typeof import("cross-spawn");

export interface CheckoutPack {
  /** Absolute path of the tarball. */
  tarball: string;
  /** Paths inside the package, `/`-separated. */
  files: string[];
}

declare module "vitest" {
  export interface ProvidedContext {
    checkoutPack: CheckoutPack;
  }
}

export default function setup(project: TestProject): () => void {
  const out = mkdtempSync(path.join(tmpdir(), "warrant-pack-"));
  const run = spawn.sync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", out], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });
  if (run.status !== 0) throw new Error(`npm pack of the checkout failed (${run.status}): ${run.stderr}${run.stdout}`);
  const report = JSON.parse(String(run.stdout)) as { filename: string; files: { path: string }[] }[];
  const packed = report[0];
  if (packed === undefined) throw new Error(`npm pack printed no package: ${run.stdout}`);
  project.provide("checkoutPack", {
    tarball: path.join(out, packed.filename),
    files: packed.files.map((f) => f.path.split(path.sep).join("/"))
  });
  return () => rmSync(out, { recursive: true, force: true });
}
