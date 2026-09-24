// e2e: argv
/**
 * `warrant id` through the binary: `<kind> <area>`, `<kind>` and `renumber
 * <old> <new> --change <name>` of argv reach the command, and the exit code is
 * 0 on success and 3 on a refusal. Allocation and renumbering themselves
 * (REQ-KRN-024; SCN-KRN-056..060, 007) are tested in the test process:
 * `test/app/commands/id.test.ts` (ADR-0025, task 5.4).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { makeTempDir, removeDir, runCli } from "../helpers/cli.js";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

function write(root: string, rel: string, content: string | object): void {
  const absolute = path.join(root, rel);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
}

describe("warrant id (argv)", () => {
  it("maps <kind> <area>, <kind> and renumber --change; exit 0, and 3 on a refusal (SCN-KRN-056, SCN-KRN-059)", async () => {
    const root = makeTempDir("warrant-id-e2e-");
    tempDirs.push(root);
    write(root, ".warrant/warrant.json", { $schema: "warrant://config/1", kernel: "0.1", openspec: "1.13.x", packs: {}, paths: { tests: "tests" } });
    write(root, ".warrant/local/areas.json", { $schema: "warrant://areas/1", KRN: { capability: "kernel" } });
    write(root, "openspec/specs/kernel/spec.md", "### Requirement: A\n<!-- id: REQ-KRN-007 -->\n\nSHALL a.\n");
    write(root, ".warrant/changes/add-search.json", { $schema: "warrant://change-record/1", change: "add-search", change_state: "SPECIFIED" });
    write(root, "openspec/changes/add-search/tasks.md", "- REQ-KRN-007\n");

    const allocated = await runCli(["id", "REQ", "KRN"], root);
    expect(allocated.status).toBe(0);
    expect(allocated.json?.command).toBe("id");
    expect(allocated.json?.data.id).toBe("REQ-KRN-008");

    const ulid = await runCli(["id", "EVID"], root);
    expect(ulid.status).toBe(0);
    expect(ulid.json?.data.id).toMatch(/^EVID-[0-9A-HJKMNP-TV-Z]{26}$/);

    const renumbered = await runCli(["id", "renumber", "REQ-KRN-007", "REQ-KRN-013", "--change", "add-search"], root);
    expect(renumbered.json?.errors).toEqual([]);
    expect(renumbered.status).toBe(0);
    expect(renumbered.json?.change).toBe("add-search");
    expect(readFileSync(path.join(root, "openspec/changes/add-search/tasks.md"), "utf8")).toBe("- REQ-KRN-013\n");

    const unknown = await runCli(["id", "FOO"], root);
    expect(unknown.json?.errors[0].code).toBe("USAGE");
    expect(unknown.status).toBe(3);
  }, 60_000);
});
