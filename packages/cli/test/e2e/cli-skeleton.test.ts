import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempDir, removeDir, runCli } from "../helpers/cli.js";

let dir: string;
beforeAll(() => {
  dir = makeTempDir();
});
afterAll(() => removeDir(dir));

describe("cli skeleton", () => {
  it("unknown command → exit 3 and USAGE (SCN-KRN-006)", async () => {
    const r = await runCli(["nosuchcommand"], dir);
    expect(r.status).toBe(3);
    expect(r.json.ok).toBe(false);
    expect(r.json.errors[0].code).toBe("USAGE");
    expect(r.stdout.trim().startsWith("{")).toBe(true);
  });

  it("validate without .warrant/ → CONFIG_MISSING, exit 3 (SCN-KRN-007)", async () => {
    const r = await runCli(["validate"], dir);
    expect(r.status).toBe(3);
    expect(r.json.command).toBe("validate");
    expect(r.json.errors[0].code).toBe("CONFIG_MISSING");
  });

  it("--version prints a semver", async () => {
    const r = await runCli(["--version"], dir);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
