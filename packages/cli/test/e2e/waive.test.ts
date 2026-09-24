// e2e: argv
/**
 * `warrant waive` through the binary: the options of argv reach the command —
 * `<change> <gate>`, a repeated `--control`, `--activate`/`--revoke` with
 * `--by` — and the exit codes 0 and 3. The behaviour of the command
 * (REQ-KRN-031, SCN-KRN-121, 122, 123, 124) is tested in the test process:
 * `test/app/commands/waive.test.ts` (ADR-0025, task 5.1).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCli } from "../helpers/cli.js";
import { PACKS, record, useSyncedProject, write } from "../helpers/synced.js";

const project = useSyncedProject();

const YEAR = new Date().getUTCFullYear();
const EXPIRES = `${YEAR}-12-31`;

describe("warrant waive (argv)", () => {
  it("maps argv to a proposal, --activate and --revoke; exit 0 on success, 3 on an error", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "VERIFYING", { classification: { profiles: ["feature"] } }));
    const env = { WARRANT_PACKS_DIR: PACKS, GITHUB_ACTIONS: "" };
    const waive = (...args: string[]): ReturnType<typeof runCli> => runCli(["waive", ...args], root, env);

    const proposed = await waive(
      "add-search",
      "analyze-clean",
      "--reason",
      "no analyze yet",
      "--risk",
      "HIGH",
      "--control",
      "maintainer review",
      "--control",
      "second pair of eyes",
      "--owner",
      "human:kat",
      "--expires",
      EXPIRES
    );
    expect(proposed.json?.errors).toEqual([]);
    expect(proposed.status).toBe(0);
    const id = proposed.json.data.waiver.id as string;
    expect(id).toMatch(new RegExp(`^WAV-${YEAR}-\\d{3}$`));
    const file = path.join(root, ".warrant", "waivers", `${id}.json`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      change: "add-search",
      gate: "analyze-clean",
      reason: "no analyze yet",
      risk: "HIGH",
      compensating_controls: ["maintainer review", "second pair of eyes"],
      owner: "human:kat",
      expires_at: EXPIRES,
      waiver_state: "PROPOSED"
    });

    const bob = await waive("--activate", id, "--by", "bob");
    expect(bob.json?.errors[0].code).toBe("ROLE_REQUIRED");
    expect(bob.status).toBe(3);

    const activated = await waive("--activate", id, "--by", "kat");
    expect(activated.json?.errors).toEqual([]);
    expect(activated.status).toBe(0);
    expect(activated.json.data.waiver).toMatchObject({ id, waiver_state: "ACTIVE", approved_by: "human:kat" });

    const revoked = await waive("--revoke", id, "--by", "kat");
    expect(revoked.status).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ waiver_state: "REVOKED" });
  }, 60_000);
});
