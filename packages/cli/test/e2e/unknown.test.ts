// e2e: argv
/**
 * `warrant unknown add | resolve` through the binary: `<change>`, `<UNK>`,
 * `--area`, `--text`, `--blocking`, `--as`, `--ref`, `--replace` and
 * `--dry-run` of argv reach the command, the envelope names the subcommand,
 * and the exit code is 0 on success and 3 on a refusal. The UNKNOWNs
 * themselves (REQ-KRN-035; SCN-KRN-148…153) are tested in the test process:
 * `test/app/commands/unknown.test.ts` (ADR-0025).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCli, type CliRun } from "../helpers/cli.js";
import { PACKS, recordDoc, useSyncedProject, write } from "../helpers/synced.js";

const project = useSyncedProject();

describe("warrant unknown (argv)", () => {
  it("maps add and resolve with their flags; exit 0, and 3 on a refusal (SCN-KRN-148, SCN-KRN-149, SCN-KRN-150)", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", recordDoc("add-search", "PROPOSED"));
    const cli = (...args: string[]): Promise<CliRun> => runCli(["unknown", ...args], root, { WARRANT_PACKS_DIR: PACKS });
    const unknowns = (): unknown =>
      (JSON.parse(readFileSync(path.join(root, ".warrant", "changes", "add-search.json"), "utf8")) as Record<string, unknown>)["unknowns"];

    const dry = await cli("add", "add-search", "--area", "SRC", "--text", "Clock backwards?", "--blocking", "--dry-run");
    expect(dry.status).toBe(0);
    expect(dry.json?.command).toBe("unknown add");
    expect(dry.json?.data).toMatchObject({ dry_run: true, unknown: { id: "UNK-SRC-001", blocking: true } });
    expect(unknowns()).toBeUndefined();

    const added = await cli("add", "add-search", "--area", "SRC", "--text", "Clock backwards?", "--blocking");
    expect(added.json?.errors).toEqual([]);
    expect(added.status).toBe(0);
    expect(added.json?.change).toBe("add-search");
    expect(added.json?.data).toEqual({
      change: "add-search",
      unknown: { id: "UNK-SRC-001", text: "Clock backwards?", blocking: true },
      open_blocking: ["UNK-SRC-001"]
    });

    const withoutRef = await cli("resolve", "add-search", "UNK-SRC-001", "--as", "decision", "--text", "Shift");
    expect(withoutRef.json?.command).toBe("unknown resolve");
    expect(withoutRef.json?.errors[0].code).toBe("USAGE");
    expect(withoutRef.status).toBe(3);

    const ref = "https://github.com/o/r/pull/7#issuecomment-11";
    const resolved = await cli("resolve", "add-search", "UNK-SRC-001", "--as", "decision", "--text", "Shift", "--ref", ref);
    expect(resolved.status).toBe(0);
    expect(resolved.json?.data["open_blocking"]).toEqual([]);

    const replaced = await cli("resolve", "add-search", "UNK-SRC-001", "--as", "decision", "--text", "Hold", "--ref", ref, "--replace");
    expect(replaced.status).toBe(0);
    expect(unknowns()).toEqual([
      { id: "UNK-SRC-001", text: "Clock backwards?", blocking: true, resolution: "Hold", resolved_as: "decision", ref }
    ]);

    const noFlag = await cli("add", "add-search", "--no-such-flag");
    expect(noFlag.status).toBe(3);
    expect(noFlag.json?.errors[0].code).toBe("USAGE");
    expect(noFlag.json?.errors[0].hint).toMatch(/warrant unknown add --help/);
  });
});
