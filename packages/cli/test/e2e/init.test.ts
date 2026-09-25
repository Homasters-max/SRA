// e2e: argv
/**
 * `warrant init` through the binary with the REAL `openspec`: `init`,
 * `--force`, `change <name>` and an unknown sub-command of argv reach the
 * command, and the exit code is 0 on success and 3 on a refusal. The command
 * itself (REQ-KRN-023; SCN-KRN-042, 052..055) is tested in the test process:
 * `test/app/commands/init.test.ts` (ADR-0025, task 5.4); the chain `openspec
 * init` → `init` → `init change` → `validate` on the real `openspec` is
 * `e2e/exit-criterion.test.ts`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { makeTempDir, removeDir, runCli } from "../helpers/cli.js";
import { openspecSync } from "../helpers/openspec.js";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

describe("warrant init (argv)", () => {
  it("maps init, --force, change <name> and an unknown sub-command; exit 0, and 3 on a refusal (SCN-KRN-053, SCN-KRN-054)", async () => {
    const root = makeTempDir("warrant-init-");
    tempDirs.push(root);
    expect(openspecSync(["init", "--tools", "none"], root).ok).toBe(true);

    const first = await runCli(["init"], root);
    expect(first.json?.errors).toEqual([]);
    expect(first.status).toBe(0);
    expect(first.json?.data.created).toContain(".warrant/warrant.json");

    const configAbs = path.join(root, ".warrant", "warrant.json");
    const config = readFileSync(configAbs, "utf8");
    const second = await runCli(["init"], root);
    expect(second.json?.errors[0].code).toBe("ALREADY_INITIALIZED");
    expect(second.status).toBe(3);

    writeFileSync(configAbs, '{\n  "$schema": "warrant://config/1"\n}\n', "utf8");
    const forced = await runCli(["init", "--force"], root);
    expect(forced.json?.errors).toEqual([]);
    expect(forced.status).toBe(0);
    expect(readFileSync(configAbs, "utf8")).toBe(config);

    const change = await runCli(["init", "change", "add-search"], root);
    expect(change.json?.errors).toEqual([]);
    expect(change.status).toBe(0);
    expect(change.json?.change).toBe("add-search");
    expect(existsSync(path.join(root, "openspec", "changes", "add-search", ".openspec.yaml"))).toBe(true);

    const unknown = await runCli(["init", "foo"], root);
    expect(unknown.json?.errors[0].code).toBe("USAGE");
    expect(unknown.status).toBe(3);
  }, 120_000);

  it("maps --frontend: claude is recorded and synced, an unknown name is USAGE with hint, exit 3 (REQ-KRN-033)", async () => {
    const root = makeTempDir("warrant-init-frontend-");
    tempDirs.push(root);
    expect(openspecSync(["init", "--tools", "none"], root).ok).toBe(true);

    const unknown = await runCli(["init", "--frontend", "codex"], root);
    expect(unknown.json?.errors[0]).toMatchObject({ code: "USAGE", hint: "pass one of: --frontend claude" });
    expect(unknown.status).toBe(3);
    expect(existsSync(path.join(root, ".warrant", "warrant.json"))).toBe(false);

    const run = await runCli(["init", "--frontend", "claude"], root);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(root, ".warrant", "warrant.json"), "utf8")).frontends).toEqual(["claude"]);
    expect(existsSync(path.join(root, ".claude", "settings.json"))).toBe(true);

    const help = await runCli(["init", "--help"], root);
    expect(help.status).toBe(0);
    expect(help.stderr).toContain("--frontend <name>");
    expect(help.stderr.split("Examples:\n")[1]?.split("\n")).toContain("  $ warrant init --frontend claude");
  }, 120_000);
});
