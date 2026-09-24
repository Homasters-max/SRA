// e2e: argv
/**
 * `warrant sync` through the binary: `sync` and `--check` of argv, the exit
 * codes 0 and 1, and a generated schema the real `openspec` accepts
 * (SCN-KRN-063). The generation itself (REQ-KRN-025, REQ-SDD-008; SCN-KRN-042,
 * 061..064, 087, 100, SCN-SDD-013, 014) is tested in the test process:
 * `test/app/commands/sync.test.ts` (ADR-0025, task 5.3).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCli } from "../helpers/cli.js";
import { openspecSync } from "../helpers/openspec.js";
import { PACKS, useSyncedProject } from "../helpers/synced.js";

const project = useSyncedProject();

describe("warrant sync (argv)", () => {
  it("syncs with exit 0 into a schema openspec accepts; --check exits 0 clean and 1 on drift (SCN-KRN-063)", async () => {
    const root = project();
    const env = { WARRANT_PACKS_DIR: PACKS };

    const run = await runCli(["sync"], root, env);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json?.data.schema).toBe("warrant-sdd");
    expect(run.json?.data.changed).toEqual([]);
    const validated = openspecSync(["schema", "validate", "warrant-sdd", "--json"], root);
    expect((validated.json as { valid?: boolean }).valid).toBe(true);

    const clean = await runCli(["sync", "--check"], root, env);
    expect(clean.status).toBe(0);
    expect(clean.json?.ok).toBe(true);

    const config = path.join(root, "openspec", "config.yaml");
    writeFileSync(config, readFileSync(config, "utf8").replace("schema: warrant-sdd", "schema: warrant-sdd # edited"), "utf8");
    const drift = await runCli(["sync", "--check"], root, env);
    expect(drift.status).toBe(1);
    expect(drift.json?.ok).toBe(false);
    expect(drift.json?.errors.map((e: { code: string }) => e.code)).toEqual(["GENERATED_DRIFT"]);
    // --check writes nothing.
    expect(readFileSync(config, "utf8")).toContain("# edited");
  }, 60_000);
});
