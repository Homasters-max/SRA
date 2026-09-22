/** `warrant status` end to end (REQ-KRN-027, SCN-KRN-070..072, 102..104). */
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { canonicalText } from "../../src/core/canon/format-json.js";
import { CLI_ROOT, makeTempDir, removeDir, runCli } from "../helpers/cli.js";

const FIXTURE_PACKS = path.join(CLI_ROOT, "test", "fixtures", "packs");
const STATUS_FIXTURES = path.join(CLI_ROOT, "test", "fixtures", "openspec");
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

/** PATH key as Windows spells it, so the override replaces rather than duplicates it. */
const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";

/**
 * A fake `openspec` on PATH that answers `--version` and replies to every
 * `status --json` with a saved OpenSpec 1.13.1 body. It keeps these tests off
 * the real binary, which task 10.1 exercises instead.
 */
function fakeOpenspec(fixture: string): string {
  const dir = makeTempDir("warrant-fake-openspec-");
  tempDirs.push(dir);
  const shim = path.join(dir, "shim.cjs");
  writeFileSync(
    shim,
    `const fs = require("fs");
const args = process.argv.slice(2);
if (args.includes("--version")) { process.stdout.write("1.13.1\\n"); process.exit(0); }
process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(STATUS_FIXTURES, `${fixture}.json`))}, "utf8"));
`,
    "utf8"
  );
  // The fake PATH holds nothing else, so `node` is spelled out absolutely.
  const node = process.execPath;
  writeFileSync(path.join(dir, "openspec.cmd"), `@"${node}" "%~dp0shim.cjs" %*\r\n`, "utf8");
  writeFileSync(path.join(dir, "openspec"), `#!/bin/sh\nexec "${node}" "$(dirname "$0")/shim.cjs" "$@"\n`, "utf8");
  try {
    chmodSync(path.join(dir, "openspec"), 0o755);
  } catch {
    // Permissions do not exist on Windows; the .cmd is used there.
  }
  return dir;
}

function env(fixture: string | null): NodeJS.ProcessEnv {
  const base = { WARRANT_PACKS_DIR: FIXTURE_PACKS };
  // An empty directory as the whole PATH means: `openspec` is not installed.
  const dir = fixture === null ? makeTempDir("warrant-no-openspec-") : fakeOpenspec(fixture);
  if (fixture === null) tempDirs.push(dir);
  return { ...base, [PATH_KEY]: dir };
}

function write(root: string, rel: string, content: string | object): void {
  const absolute = path.join(root, rel);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, typeof content === "string" ? content : canonicalText(content).text, "utf8");
}

function record(change: string, state = "PROPOSED", extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: "warrant://change-record/1",
    change,
    change_state: state,
    transitions: [{ to: "PROPOSED", at: "2026-09-22T09:00:00Z", by: "cli:local" }],
    ...extra
  };
}

/** A project with the `policy` fixture pack, one record and one change directory. */
function project(change = "add-search"): string {
  const root = makeTempDir("warrant-status-");
  tempDirs.push(root);
  write(root, ".warrant/warrant.json", {
    $schema: "warrant://config/1",
    kernel: "0.1",
    openspec: "1.13.x",
    packs: { policy: { version: "^1.0" } }
  });
  write(root, `.warrant/changes/${change}.json`, record(change));
  write(root, `openspec/changes/${change}/proposal.md`, "# Why\n");
  return root;
}

describe("warrant status <change>", () => {
  it("reports a fresh change with no stale signals (SCN-KRN-070)", async () => {
    const root = project();
    const run = await runCli(["status", "add-search"], root, env("status-fresh"));
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json?.change).toBe("add-search");
    expect(run.json?.data.change_state).toBe("PROPOSED");
    expect((run.json?.data.artifacts as Record<string, string>).proposal).toBe("ready");
    expect(run.json?.data.stale).toEqual([]);
    // No classification in the record: the key is present and null.
    expect(run.json?.data.classification).toBeNull();
    expect(run.json?.data.effective_policy.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Array.isArray(run.json?.data.effective_policy.sources)).toBe(true);
  });

  it("carries the verification of the next transition last (REQ-KRN-027)", async () => {
    const root = project();
    const run = await runCli(["status", "add-search"], root, env("status-fresh"));
    expect(Object.keys(run.json?.data)).toEqual([
      "change",
      "change_state",
      "classification",
      "effective_policy",
      "artifacts",
      "stale",
      "amended_by",
      "superseded_by",
      "verification"
    ]);
    expect(Object.keys(run.json?.data.verification)).toEqual(["transition", "gates", "findings", "controller_action", "rule"]);
    expect(run.json?.data.verification.transition).toBe("PROPOSED->SPECIFIED");
    // `rules` belongs to the form without an argument only (SCN-KRN-104).
    expect(run.json?.data.rules).toBeUndefined();
  });

  it("reports the risk level of the effective policy (REQ-KRN-027)", async () => {
    const root = project();
    const run = await runCli(["status", "add-search"], root, env("status-fresh"));
    // No classification: every dimension is UNKNOWN, which the policy fixture levels as MEDIUM.
    expect(run.json?.data.effective_policy.risk_level).toBe("MEDIUM");
  });

  it("flags an ABANDONED record whose change directory still exists (SCN-KRN-102)", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", record("add-search", "ABANDONED"));
    const present = await runCli(["status", "add-search"], root, env("status-fresh"));
    expect(present.status).toBe(0);
    expect(present.json?.data.stale).toEqual([
      {
        code: "ABANDONED_DIR_PRESENT",
        message: expect.stringContaining("add-search") as unknown as string,
        path: "openspec/changes/add-search"
      }
    ]);

    // Without the directory an ABANDONED record is the expected end state, not CHANGE_DIR_MISSING.
    rmSync(path.join(root, "openspec", "changes", "add-search"), { recursive: true, force: true });
    const gone = await runCli(["status", "add-search"], root, env("status-fresh"));
    expect(gone.status).toBe(0);
    expect(gone.json?.data.stale).toEqual([]);
  });

  it("computes amended_by and superseded_by without writing them into the record (SCN-KRN-103)", async () => {
    const root = project();
    write(root, ".warrant/changes/fix-search.json", record("fix-search", "PROPOSED", { amends: ["add-search"] }));
    write(root, ".warrant/changes/new-search.json", record("new-search", "PROPOSED", { supersedes: ["add-search"] }));
    const before = readFileSync(path.join(root, ".warrant", "changes", "add-search.json"), "utf8");

    const run = await runCli(["status", "add-search"], root, env("status-fresh"));
    expect(run.status).toBe(0);
    expect(run.json?.data.amended_by).toEqual(["fix-search"]);
    expect(run.json?.data.superseded_by).toEqual(["new-search"]);
    const after = readFileSync(path.join(root, ".warrant", "changes", "add-search.json"), "utf8");
    expect(after).toBe(before);
    expect(JSON.parse(after)).not.toHaveProperty("amended_by");

    const other = await runCli(["status", "fix-search"], root, env("status-fresh"));
    expect(other.json?.data.amended_by).toEqual([]);
    expect(other.json?.data.superseded_by).toEqual([]);
  });

  it("flags an archived directory whose record is not ARCHIVED (SCN-KRN-071)", async () => {
    const root = project();
    cpSync(
      path.join(root, "openspec", "changes", "add-search"),
      path.join(root, "openspec", "changes", "archive", "2026-09-22-add-search"),
      { recursive: true }
    );
    rmSync(path.join(root, "openspec", "changes", "add-search"), { recursive: true, force: true });
    write(
      root,
      ".warrant/changes/add-search.json",
      record("add-search", "MERGED", {
        transitions: [
          { to: "PROPOSED", at: "2026-09-22T09:00:00Z", by: "cli:local" },
          { to: "APPROVED", at: "2026-09-22T11:00:00Z", by: "ci:run/8812" },
          { to: "MERGED", at: "2026-09-22T12:00:00Z", by: "ci:run/8812" }
        ]
      })
    );

    const run = await runCli(["status", "add-search"], root, env("status-fresh"));
    expect(run.status).toBe(0);
    expect(run.json?.errors).toEqual([]);
    const stale = run.json?.data.stale as { code: string; path: string }[];
    expect(stale.map((s) => s.code)).toContain("ARCHIVED_WITHOUT_TRANSITION");
    expect(stale[0]?.path).toBe("openspec/changes/archive/2026-09-22-add-search");
    // OpenSpec no longer owns the directory, so no artifacts are reported.
    expect(run.json?.data.artifacts).toEqual({});
  });

  it("stays quiet about an archived directory once the record is ARCHIVED", async () => {
    const root = project();
    cpSync(
      path.join(root, "openspec", "changes", "add-search"),
      path.join(root, "openspec", "changes", "archive", "2026-09-22-add-search"),
      { recursive: true }
    );
    rmSync(path.join(root, "openspec", "changes", "add-search"), { recursive: true, force: true });
    write(root, ".warrant/changes/add-search.json", record("add-search", "ARCHIVED"));
    const run = await runCli(["status", "add-search"], root, env("status-fresh"));
    expect(run.status).toBe(0);
    expect(run.json?.data.stale).toEqual([]);
  });

  it("flags a record whose change directory is gone", async () => {
    const root = project();
    rmSync(path.join(root, "openspec", "changes", "add-search"), { recursive: true, force: true });
    const run = await runCli(["status", "add-search"], root, env("status-fresh"));
    expect(run.status).toBe(0);
    const stale = run.json?.data.stale as { code: string; path: string }[];
    expect(stale).toEqual([
      {
        code: "CHANGE_DIR_MISSING",
        message: expect.stringContaining("add-search") as unknown as string,
        path: "openspec/changes/add-search"
      }
    ]);
    expect(run.json?.data.artifacts).toEqual({});
  });

  it("rejects a change without a record (SCN-KRN-072)", async () => {
    const root = project();
    const run = await runCli(["status", "nosuch"], root, env("status-fresh"));
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("CHANGE_NOT_FOUND");
    expect(run.json?.errors[0].path).toBe(".warrant/changes/nosuch.json");
  });

  it("reports the record without artifacts when openspec is not on PATH", async () => {
    const root = project();
    const run = await runCli(["status", "add-search"], root, env(null));
    expect(run.status).toBe(0);
    expect(run.json?.data.artifacts).toEqual({});
    expect(run.stderr).toContain("`openspec` is not on PATH");
    expect(run.json?.data.change_state).toBe("PROPOSED");
  });

  it("escalates a policy conflict instead of hiding it (SCN-KRN-067)", async () => {
    const root = project();
    write(root, ".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { policy: { version: "^1.0" }, "policy-conflict": { version: "^1.0" } }
    });
    write(
      root,
      ".warrant/changes/add-search.json",
      record("add-search", "PROPOSED", {
        classification: { profiles: ["feature"], risk: { data_loss: { value: "HIGH", from: "human:kat" } } }
      })
    );
    const run = await runCli(["status", "add-search"], root, env("status-fresh"));
    expect(run.status).toBe(2);
    expect(run.json?.errors[0].code).toBe("POLICY_CONFLICT");
    expect(run.json?.data.controller_action).toBe("ESCALATE");
    // The derived signals are still reported.
    expect(run.json?.data.effective_policy).toBeNull();
    expect(run.json?.data.stale).toEqual([]);
  });
});

describe("warrant status", () => {
  it("reports every record, sorted by name (task 9.3)", async () => {
    const root = project("add-search");
    write(root, ".warrant/changes/zz-cleanup.json", record("zz-cleanup", "SPECIFIED"));
    write(root, ".warrant/changes/aa-rename.json", record("aa-rename"));

    const run = await runCli(["status"], root, env("status-fresh"));
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json?.change).toBeUndefined();
    const changes = run.json?.data.changes as { change: string; stale: unknown[] }[];
    expect(changes.map((c) => c.change)).toEqual(["aa-rename", "add-search", "zz-cleanup"]);
    // Only `add-search` has a directory; the other two are stale.
    expect(changes[1]?.stale).toEqual([]);
    expect((changes[0]?.stale[0] as { code: string }).code).toBe("CHANGE_DIR_MISSING");
  });

  it("reports an empty list for a project without records", async () => {
    const root = project();
    rmSync(path.join(root, ".warrant", "changes"), { recursive: true, force: true });
    const run = await runCli(["status"], root, env("status-fresh"));
    expect(run.status).toBe(0);
    expect(run.json?.data).toEqual({ changes: [], rules: { total: 0, unenforced: 0 } });
  });

  it("counts path rules of packs and .warrant/local/rules/, and those without enforced_by (SCN-KRN-104)", async () => {
    const root = project();
    write(root, ".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { policy: { version: "^1.0" }, rules: { version: "^1.0" } }
    });
    write(root, ".warrant/local/rules/ids-allocated-by-cli.json", {
      $schema: "warrant://rule/1",
      id: "ids-allocated-by-cli",
      paths: ["**"],
      text: "Stable ids are allocated by warrant id, never by hand.",
      enforced_by: "ids-valid"
    });
    const run = await runCli(["status"], root, env("status-fresh"));
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json?.data.rules).toEqual({ total: 3, unenforced: 1 });
  });
});

describe("warrant status: large output through a pipe (B4)", () => {
  const COUNT = 400;

  /**
   * A project with {@link COUNT} more records, each with a classification and
   * without a change directory, next to the `add-search` of {@link project}.
   */
  function crowded(packs: Record<string, { version: string }>): string {
    const root = project();
    write(root, ".warrant/warrant.json", { $schema: "warrant://config/1", kernel: "0.1", openspec: "1.13.x", packs });
    for (let i = 0; i < COUNT; i += 1) {
      const name = `change-${String(i).padStart(4, "0")}`;
      write(
        root,
        `.warrant/changes/${name}.json`,
        record(name, "PROPOSED", {
          classification: { profiles: ["feature"], risk: { data_loss: { value: "HIGH", from: "human:kat" } } }
        })
      );
    }
    return root;
  }

  it(
    "delivers a JSON envelope larger than 64 KiB whole, with the exit code (SCN-KRN-085)",
    async () => {
      const root = crowded({ policy: { version: "^1.0" } });
      // `runCli` reads stdout through a pipe, which is the case B4 is about.
      const run = await runCli(["status"], root, env(null));
      expect(Buffer.byteLength(run.stdout, "utf8")).toBeGreaterThan(64 * 1024);
      expect(() => JSON.parse(run.stdout)).not.toThrow();
      expect(run.status).toBe(0);
      expect(run.json?.ok).toBe(true);
      expect((run.json?.data.changes as unknown[]).length).toBe(COUNT + 1);
    },
    60_000
  );

  it(
    "keeps a non-zero exit code after a large envelope (SCN-KRN-085)",
    async () => {
      const root = crowded({ policy: { version: "^1.0" }, "policy-conflict": { version: "^1.0" } });
      const run = await runCli(["status"], root, env(null));
      expect(Buffer.byteLength(run.stdout, "utf8")).toBeGreaterThan(64 * 1024);
      expect(() => JSON.parse(run.stdout)).not.toThrow();
      expect(run.status).toBe(2);
      expect(run.json?.data.controller_action).toBe("ESCALATE");
      expect((run.json?.data.changes as unknown[]).length).toBe(COUNT + 1);
      expect((run.json?.errors as unknown[]).length).toBe(COUNT);
    },
    60_000
  );
});
