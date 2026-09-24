/**
 * Phase-1 exit criterion (task 10.1), as a script.
 *
 * In one throwaway directory, with the REAL `openspec` binary:
 *
 *   openspec init --tools none
 *   warrant init
 *   warrant init change demo
 *   warrant validate      -> ok, no errors
 *   warrant status demo   -> PROPOSED, proposal ready, nothing stale
 *   warrant fmt --check   -> clean
 *   warrant sync --check  -> clean
 *
 * `openspec` 1.13.1 on PATH is required by the `globalSetup` of `e2e` (ADR-0025 п. 5).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openspecSync } from "../helpers/openspec.js";
import { makeTempDir, removeDir, runCli } from "../helpers/cli.js";

// `openspec` is slow to start, especially on Windows; the other e2e files use 120s.
const TIMEOUT = 180_000;

let root: string;

describe("phase-1 exit criterion", () => {
  beforeAll(() => {
    root = makeTempDir("warrant-exit-");
  }, TIMEOUT);

  afterAll(() => {
    if (root) removeDir(root);
  });

  it(
    "openspec init --tools none",
    async () => {
      expect(openspecSync(["init", "--tools", "none"], root).ok).toBe(true);
    },
    TIMEOUT
  );

  it(
    "warrant init",
    async () => {
      const run = await runCli(["init"], root);
      expect(run.json?.errors).toEqual([]);
      expect(run.status).toBe(0);
    },
    TIMEOUT
  );

  it(
    "warrant init change demo",
    async () => {
      const run = await runCli(["init", "change", "demo"], root);
      expect(run.json?.errors).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.json?.change).toBe("demo");
    },
    TIMEOUT
  );

  it(
    "warrant validate",
    async () => {
      const run = await runCli(["validate"], root);
      expect(run.json?.errors).toEqual([]);
      expect(run.json?.ok).toBe(true);
      expect(run.status).toBe(0);
    },
    TIMEOUT
  );

  it(
    "warrant status demo",
    async () => {
      const run = await runCli(["status", "demo"], root);
      expect(run.json?.errors).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.json?.data.stale).toEqual([]);
      expect(run.json?.data.change_state).toBe("PROPOSED");
      expect((run.json?.data.artifacts as Record<string, string>).proposal).toBe("ready");
    },
    TIMEOUT
  );

  it(
    "warrant fmt --check and warrant sync --check are clean after init",
    async () => {
      expect((await runCli(["fmt", "--check"], root)).status).toBe(0);
      expect((await runCli(["sync", "--check"], root)).status).toBe(0);
    },
    TIMEOUT
  );
});
