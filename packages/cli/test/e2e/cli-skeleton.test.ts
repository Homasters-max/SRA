// e2e: argv
/**
 * The binary itself: an unknown command of argv (SCN-KRN-006), a command run
 * outside a project (SCN-KRN-007), `--version`, `--help` and `--dry-run` of
 * the commands that change state (REQ-KRN-034) — the parse of argv, the
 * exit code and stdout of the process, which no command of the test process
 * sees (ADR-0025, task 5.4: the file stays in e2e whole).
 */
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

  it("--help of transition, archive, waive, run start and run finish names --dry-run and gives an example with it (lens cli-contract)", async () => {
    for (const command of ["transition", "archive", "waive", "run start", "run finish"]) {
      const r = await runCli([...command.split(" "), "--help"], dir);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("--dry-run");
      const examples = r.stderr.split("Examples:\n")[1]?.split("\n") ?? [];
      expect(examples.some((line) => line.startsWith(`  $ warrant ${command} `) && line.endsWith(" --dry-run"))).toBe(true);
    }
  });

  it("--help of validate names --files and gives an example with it (REQ-KRN-032, lens cli-contract)", async () => {
    const r = await runCli(["validate", "--help"], dir);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("--files <a,b>");
    const examples = r.stderr.split("Examples:\n")[1]?.split("\n") ?? [];
    expect(examples.some((line) => line.startsWith("  $ warrant validate --files "))).toBe(true);
  });

  it("--dry-run reaches the command: a refusal carries data.dry_run (REQ-KRN-034)", async () => {
    const r = await runCli(["transition", "add-search", "SPECIFIED", "--dry-run"], dir);
    expect(r.status).toBe(3);
    expect(r.json.errors[0].code).toBe("CONFIG_MISSING");
    expect(r.json.data).toEqual({ dry_run: true, would_write: [] });
  });

  it("run start and run finish answer in the envelope of their own name, every error with a hint (REQ-ENF-002, REQ-KRN-002)", async () => {
    const start = await runCli(["run", "start", "add-search", "--operation", "specify", "--dry-run"], dir);
    expect(start.status).toBe(3);
    expect(start.json.command).toBe("run start");
    expect(start.json.errors[0].code).toBe("CONFIG_MISSING");
    expect(start.json.errors[0].hint).toMatch(/warrant init/);
    expect(start.json.data).toEqual({ dry_run: true, would_write: [] });

    const finish = await runCli(["run", "finish"], dir);
    expect(finish.status).toBe(3);
    expect(finish.json.command).toBe("run finish");
    expect(finish.json.errors[0].hint).toBeDefined();

    const unknown = await runCli(["run", "start", "add-search", "--no-such-flag"], dir);
    expect(unknown.status).toBe(3);
    expect(unknown.json.errors[0].code).toBe("USAGE");
    expect(unknown.json.errors[0].hint).toMatch(/warrant run start --help/);
  });
});
