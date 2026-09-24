// e2e: argv
/**
 * `warrant link` through the binary: `<change>`, `--amends`, `--supersedes`
 * and `--remove` of argv reach the command, and the exit code is 0 on success
 * and 3 on a refusal. The links themselves (REQ-KRN-030; SCN-KRN-118, 119,
 * 120) are tested in the test process: `test/app/commands/link.test.ts`
 * (ADR-0025, task 5.4).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCli, type CliRun } from "../helpers/cli.js";
import { PACKS, record, useSyncedProject, write } from "../helpers/synced.js";

const project = useSyncedProject();

describe("warrant link (argv)", () => {
  it("maps <change>, --amends, --supersedes and --remove; exit 0, and 3 on a refusal (SCN-KRN-118, SCN-KRN-120)", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "ARCHIVED"));
    write(root, ".warrant/changes/fix-search.json", record("fix-search", "PROPOSED"));
    const link = (...args: string[]): Promise<CliRun> => runCli(["link", "fix-search", ...args], root, { WARRANT_PACKS_DIR: PACKS });
    const amends = (): unknown =>
      (JSON.parse(readFileSync(path.join(root, ".warrant", "changes", "fix-search.json"), "utf8")) as Record<string, unknown>)["amends"];

    const added = await link("--amends", "add-search");
    expect(added.json?.errors).toEqual([]);
    expect(added.status).toBe(0);
    expect(added.json?.change).toBe("fix-search");
    expect(added.json?.data).toMatchObject({ field: "amends", target: "add-search", action: "add", changed: true });
    expect(amends()).toEqual(["add-search"]);

    const wrong = await link("--supersedes", "add-search");
    expect(wrong.json?.errors[0].code).toBe("LINK_TARGET_INVALID");
    expect(wrong.status).toBe(3);

    const both = await link("--amends", "add-search", "--supersedes", "add-search");
    expect(both.json?.errors[0].code).toBe("USAGE");
    expect(both.status).toBe(3);

    const removed = await link("--amends", "add-search", "--remove");
    expect(removed.json?.errors).toEqual([]);
    expect(removed.status).toBe(0);
    expect(removed.json?.data).toMatchObject({ action: "remove", changed: true, amends: [] });
    expect(amends()).toBeUndefined();
  }, 60_000);
});
