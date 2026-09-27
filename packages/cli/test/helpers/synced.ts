/**
 * One synced core-sdd project per test file (`openspec init` + `warrant sync`,
 * built once in `beforeAll`), copied fresh for every case, so that a clean
 * `validate` is `ok: true` and each test sees only the findings it provokes.
 */
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";

import { canonicalText } from "../../src/core/canon/format-json.js";
import { packContentHash } from "../../src/core/packs/hash.js";
import { openspecSync } from "./openspec.js";
import { CLI_VERSION } from "../../src/version.js";
import { CORE_SDD_RANGE, CORE_SDD_VERSION, REPO_ROOT, makeTempDir, removeDir, runCli, type CliRun } from "./cli.js";

export const PACKS = path.join(REPO_ROOT, "packs");

/** Writes a file; objects in canonical form, so check (7) stays quiet. */
export function write(root: string, rel: string, content: string | object): void {
  const absolute = path.join(root, rel);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, typeof content === "string" ? content : canonicalText(content).text, "utf8");
}

/** A change record `warrant://change-record/1` of `change` in `state` (A-26: one owner). */
export function recordDoc(change: string, state: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: "warrant://change-record/1",
    change,
    change_state: state,
    transitions: [{ to: "PROPOSED", at: "2026-09-22T09:00:00Z", by: "cli:local" }],
    ...extra
  };
}

/** `warrant validate` through the binary (e2e); at level `app` — `validate` of `app/helpers/validate.ts`. */
export function validateCli(root: string): Promise<CliRun> {
  return runCli(["validate"], root, { WARRANT_PACKS_DIR: PACKS });
}

/** Codes of `errors[]` of a run; none when it printed no JSON. */
export function codes(run: CliRun): string[] {
  return ((run.json?.errors ?? []) as { code: string }[]).map((e) => e.code);
}

export function findError(run: CliRun, code: string): { code: string; message: string; path: string } | undefined {
  return (run.json?.errors as { code: string; message: string; path: string }[]).find((e) => e.code === code);
}

/**
 * Registers the hooks and returns `project()`, which copies the synced base.
 * `openspec` 1.13.1 on PATH is guaranteed by the `globalSetup` of `e2e` (ADR-0025 п. 5).
 */
export function useSyncedProject(): () => string {
  const tempDirs: string[] = [];
  let base = "";

  beforeAll(async () => {
    base = makeTempDir("warrant-e2e-synced-base-");
    tempDirs.push(base);
    write(base, ".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { "core-sdd": { version: CORE_SDD_RANGE } },
      roles: { maintainer: ["kat"] }
    });
    write(base, ".warrant/local/areas.json", {
      $schema: "warrant://areas/1",
      KRN: { capability: "kernel" },
      SRC: { capability: "search" }
    });
    write(base, ".warrant/warrant.lock.json", {
      $schema: "warrant://lock/1",
      kernel: CLI_VERSION,
      openspec: "1.13.1",
      packs: { "core-sdd": { version: CORE_SDD_VERSION, source: "bundled", hash: packContentHash(path.join(PACKS, "core-sdd")) } }
    });
    if (!openspecSync(["init", "--tools", "none"], base).ok) throw new Error("openspec init failed");
    const sync = await runCli(["sync"], base, { WARRANT_PACKS_DIR: PACKS });
    if (sync.status !== 0) throw new Error(`warrant sync failed: ${sync.stdout}${sync.stderr}`);
  }, 120_000);

  afterAll(() => {
    for (const dir of tempDirs) removeDir(dir);
  });

  return () => {
    const root = makeTempDir("warrant-e2e-synced-");
    tempDirs.push(root);
    cpSync(base, root, { recursive: true });
    return root;
  };
}
