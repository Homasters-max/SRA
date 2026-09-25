// e2e: output
/**
 * `warrant status` through the binary: an envelope larger than a pipe buffer
 * reaches stdout whole, with the exit code (SCN-KRN-085, B4). The status itself
 * (REQ-KRN-027; SCN-KRN-067, 070..072, 102..104) is tested in the test process:
 * `test/app/commands/status.test.ts` (ADR-0025, task 5.3).
 */
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { CLI_ROOT, makeTempDir, removeDir, runCli } from "../helpers/cli.js";
import { write } from "../helpers/synced.js";

const FIXTURE_PACKS = path.join(CLI_ROOT, "test", "fixtures", "packs");
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

/** PATH key as Windows spells it, so the override replaces rather than duplicates it. */
const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";

/** The fixture packs, and an empty directory as the whole PATH: `openspec` is not installed. */
function env(): NodeJS.ProcessEnv {
  const dir = makeTempDir("warrant-no-openspec-");
  tempDirs.push(dir);
  return { WARRANT_PACKS_DIR: FIXTURE_PACKS, [PATH_KEY]: dir };
}

function record(change: string, state = "PROPOSED", extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: "warrant://change-record/1",
    change,
    change_state: state,
    transitions: [{ to: "PROPOSED", at: "2026-09-22T09:00:00Z", by: "cli:local" }],
    ...extra
  };
}

/** A project with the `policy` fixture pack, one record and one change directory. */
function project(change = "add-search"): string {
  const root = makeTempDir("warrant-status-");
  tempDirs.push(root);
  write(root, ".warrant/warrant.json", {
    $schema: "warrant://config/1",
    kernel: "0.1",
    openspec: "1.13.x",
    packs: { policy: { version: "^1.0" } }
  });
  write(root, `.warrant/changes/${change}.json`, record(change));
  write(root, `openspec/changes/${change}/proposal.md`, "# Why\n");
  return root;
}

describe("warrant status: large output through a pipe (B4)", () => {
  const COUNT = 400;

  /**
   * A project with {@link COUNT} more records, each with a classification and
   * without a change directory, next to the `add-search` of {@link project}.
   */
  function crowded(packs: Record<string, { version: string }>): string {
    const root = project();
    write(root, ".warrant/warrant.json", { $schema: "warrant://config/1", kernel: "0.1", openspec: "1.13.x", packs });
    for (let i = 0; i < COUNT; i += 1) {
      const name = `change-${String(i).padStart(4, "0")}`;
      write(
        root,
        `.warrant/changes/${name}.json`,
        record(name, "PROPOSED", {
          classification: { profiles: ["feature"], risk: { data_loss: { value: "HIGH", from: "human:kat" } } }
        })
      );
    }
    return root;
  }

  it(
    "delivers a JSON envelope larger than 64 KiB whole, with the exit code (SCN-KRN-085)",
    async () => {
      const root = crowded({ policy: { version: "^1.0" } });
      // `runCli` reads stdout through a pipe, which is the case B4 is about.
      const run = await runCli(["status"], root, env());
      expect(Buffer.byteLength(run.stdout, "utf8")).toBeGreaterThan(64 * 1024);
      expect(() => JSON.parse(run.stdout)).not.toThrow();
      expect(run.status).toBe(0);
      expect(run.json?.ok).toBe(true);
      expect((run.json?.data.changes as unknown[]).length).toBe(COUNT + 1);
    },
    60_000
  );

  it(
    "keeps a non-zero exit code after a large envelope (SCN-KRN-085)",
    async () => {
      const root = crowded({ policy: { version: "^1.0" }, "policy-conflict": { version: "^1.0" } });
      const run = await runCli(["status"], root, env());
      expect(Buffer.byteLength(run.stdout, "utf8")).toBeGreaterThan(64 * 1024);
      expect(() => JSON.parse(run.stdout)).not.toThrow();
      expect(run.status).toBe(2);
      expect(run.json?.data.controller_action).toBe("ESCALATE");
      expect((run.json?.data.changes as unknown[]).length).toBe(COUNT + 1);
      expect((run.json?.errors as unknown[]).length).toBe(COUNT);
    },
    60_000
  );
});
