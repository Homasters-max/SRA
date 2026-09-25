// e2e: argv
/**
 * `warrant guard --frontend <name>` through the binary (REQ-ENF-005, task
 * 8.1): the table of adapters of `bin` — an unknown name is `USAGE` with the
 * hint naming the known ones, exit 3; a known one prints the native answer
 * instead of the envelope and its exit code — nothing for an `allow` without
 * hints, exit 2 with the reason on stderr for stdin that is not JSON
 * (SCN-ENF-021); `--help` names the option with an example. The decisions are
 * tested in the test process: `test/app/commands/guard-frontend.test.ts`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { makeTempDir, removeDir, runCli } from "../helpers/cli.js";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

describe("warrant guard --frontend (argv)", () => {
  it("maps --frontend: unknown is USAGE with hint, exit 3; claude answers natively — allow empty, not JSON exit 2 (SCN-ENF-021)", async () => {
    const root = makeTempDir("warrant-guard-frontend-");
    tempDirs.push(root);
    mkdirSync(path.join(root, ".warrant"));
    writeFileSync(path.join(root, ".warrant", "warrant.json"), "{}\n");

    const unknown = await runCli(["guard", "--frontend", "codex"], root, {}, "{}");
    expect(unknown.status).toBe(3);
    expect(unknown.json).toMatchObject({ command: "guard", ok: false, errors: [{ code: "USAGE", hint: "pass one of: --frontend claude" }] });

    const read = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "a.txt" }, cwd: root });
    const allowed = await runCli(["guard", "--frontend", "claude"], root, {}, read);
    expect({ status: allowed.status, stdout: allowed.stdout }).toEqual({ status: 0, stdout: "" });

    const broken = await runCli(["guard", "--frontend", "claude"], root, {}, "not json");
    expect({ status: broken.status, stdout: broken.stdout }).toEqual({ status: 2, stdout: "" });
    expect(broken.stderr).toContain("warrant guard --frontend claude: stdin is not JSON");

    const help = await runCli(["guard", "--help"], root);
    expect(help.status).toBe(0);
    expect(help.stderr).toContain("--frontend <name>");
    expect(help.stderr.split("Examples:\n")[1]?.split("\n")).toContain("  $ warrant guard --frontend claude < hook-input.json");
  }, 120_000);
});
