// e2e: argv
/**
 * `warrant validate` through the binary: stdout is the envelope and nothing
 * else, the exit codes 0 and 3, and the removed flag `--no-generated` is a
 * USAGE error of argv. The checks (1)–(13) of REQ-KRN-021 are tested in the
 * test process: `test/app/commands/validate.test.ts`,
 * `validate-ids-head.test.ts` and `validate-verification.test.ts` (ADR-0025,
 * task 5.2).
 */
import { describe, expect, it } from "vitest";

import { runCli } from "../helpers/cli.js";
import { PACKS, useSyncedProject, validateCli, write } from "../helpers/synced.js";

const project = useSyncedProject();

describe("warrant validate (argv)", () => {
  it("prints only the envelope, exits 0 clean and 3 on a finding; --no-generated is USAGE (SCN-KRN-005, SCN-KRN-082)", async () => {
    const root = project();
    const clean = await validateCli(root);
    expect(clean.json?.errors).toEqual([]);
    expect(clean.status).toBe(0);
    expect(clean.json?.command).toBe("validate");
    expect(clean.json?.data.skipped).toEqual([]);

    write(root, ".warrant/local/gates/x.json", { $schema: "warrant://gate/1", id: "x", version: "1.0.0" });
    const run = await validateCli(root);
    expect(run.status).toBe(3);
    expect(run.json?.ok).toBe(false);
    const violation = run.json?.errors.find((e: { code: string }) => e.code === "SCHEMA_VIOLATION");
    expect(violation.path).toContain(".warrant/local/gates/x.json");
    // stdout is exactly one JSON object and nothing else.
    expect(run.stdout.trim().startsWith("{")).toBe(true);
    expect(run.stdout.trim().endsWith("}")).toBe(true);

    const flag = await runCli(["validate", "--no-generated"], root, { WARRANT_PACKS_DIR: PACKS });
    expect(flag.status).toBe(3);
    expect(flag.json?.errors[0].code).toBe("USAGE");
    // `generated` is not a skip any run can report any more.
    expect(flag.json?.data?.skipped ?? []).not.toContain("generated");
  }, 60_000);
});
