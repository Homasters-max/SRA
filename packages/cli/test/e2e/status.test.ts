/** `warrant status` end to end (REQ-KRN-027, SCN-KRN-070..072). */
import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  it("reports a fresh change with no stale signals (SCN-KRN-070)", () => {
    const root = project();
    const run = runCli(["status", "add-search"], root, env("status-fresh"));
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

  it("omits verdicts and next entirely (REQ-KRN-027)", () => {
    const root = project();
    const run = runCli(["status", "add-search"], root, env("status-fresh"));
    expect(Object.keys(run.json?.data)).toEqual([
      "change",
      "change_state",
      "classification",
      "effective_policy",
      "artifacts",
      "stale"
    ]);
  });

  it("flags an archived directory whose record is not ARCHIVED (SCN-KRN-071)", () => {
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

    const run = runCli(["status", "add-search"], root, env("status-fresh"));
    expect(run.status).toBe(0);
    expect(run.json?.errors).toEqual([]);
    const stale = run.json?.data.stale as { code: string; path: string }[];
    expect(stale.map((s) => s.code)).toContain("ARCHIVED_WITHOUT_TRANSITION");
    expect(stale[0]?.path).toBe("openspec/changes/archive/2026-09-22-add-search");
    // OpenSpec no longer owns the directory, so no artifacts are reported.
    expect(run.json?.data.artifacts).toEqual({});
  });

  it("stays quiet about an archived directory once the record is ARCHIVED", () => {
    const root = project();
    cpSync(
      path.join(root, "openspec", "changes", "add-search"),
      path.join(root, "openspec", "changes", "archive", "2026-09-22-add-search"),
      { recursive: true }
    );
    rmSync(path.join(root, "openspec", "changes", "add-search"), { recursive: true, force: true });
    write(root, ".warrant/changes/add-search.json", record("add-search", "ARCHIVED"));
    const run = runCli(["status", "add-search"], root, env("status-fresh"));
    expect(run.status).toBe(0);
    expect(run.json?.data.stale).toEqual([]);
  });

  it("flags a record whose change directory is gone", () => {
    const root = project();
    rmSync(path.join(root, "openspec", "changes", "add-search"), { recursive: true, force: true });
    const run = runCli(["status", "add-search"], root, env("status-fresh"));
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

  it("rejects a change without a record (SCN-KRN-072)", () => {
    const root = project();
    const run = runCli(["status", "nosuch"], root, env("status-fresh"));
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("CHANGE_NOT_FOUND");
    expect(run.json?.errors[0].path).toBe(".warrant/changes/nosuch.json");
  });

  it("reports the record without artifacts when openspec is not on PATH", () => {
    const root = project();
    const run = runCli(["status", "add-search"], root, env(null));
    expect(run.status).toBe(0);
    expect(run.json?.data.artifacts).toEqual({});
    expect(run.stderr).toContain("`openspec` is not on PATH");
    expect(run.json?.data.change_state).toBe("PROPOSED");
  });

  it("escalates a policy conflict instead of hiding it (SCN-KRN-067)", () => {
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
    const run = runCli(["status", "add-search"], root, env("status-fresh"));
    expect(run.status).toBe(2);
    expect(run.json?.errors[0].code).toBe("POLICY_CONFLICT");
    expect(run.json?.data.controller_action).toBe("ESCALATE");
    // The derived signals are still reported.
    expect(run.json?.data.effective_policy).toBeNull();
    expect(run.json?.data.stale).toEqual([]);
  });
});

describe("warrant status", () => {
  it("reports every record, sorted by name (task 9.3)", () => {
    const root = project("add-search");
    write(root, ".warrant/changes/zz-cleanup.json", record("zz-cleanup", "SPECIFIED"));
    write(root, ".warrant/changes/aa-rename.json", record("aa-rename"));

    const run = runCli(["status"], root, env("status-fresh"));
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json?.change).toBeUndefined();
    const changes = run.json?.data.changes as { change: string; stale: unknown[] }[];
    expect(changes.map((c) => c.change)).toEqual(["aa-rename", "add-search", "zz-cleanup"]);
    // Only `add-search` has a directory; the other two are stale.
    expect(changes[1]?.stale).toEqual([]);
    expect((changes[0]?.stale[0] as { code: string }).code).toBe("CHANGE_DIR_MISSING");
  });

  it("reports an empty list for a project without records", () => {
    const root = project();
    rmSync(path.join(root, ".warrant", "changes"), { recursive: true, force: true });
    const run = runCli(["status"], root, env("status-fresh"));
    expect(run.status).toBe(0);
    expect(run.json?.data).toEqual({ changes: [] });
  });
});
