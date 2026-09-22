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

function read(root: string, rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

/** A minimal project: config plus the AREA registry. `id` needs no packs and no lock. */
function project(): string {
  const root = makeTempDir("warrant-id-e2e-");
  tempDirs.push(root);
  write(root, ".warrant/warrant.json", {
    $schema: "warrant://config/1",
    kernel: "0.1",
    openspec: "1.13.x",
    packs: {},
    paths: { tests: "tests" }
  });
  write(root, ".warrant/local/areas.json", { $schema: "warrant://areas/1", KRN: { capability: "kernel" } });
  return root;
}

describe("warrant id", () => {
  it("allocates the next number counting archive (SCN-KRN-056)", async () => {
    const root = project();
    write(root, "openspec/specs/kernel/spec.md", "### Requirement: A\n<!-- id: REQ-KRN-007 -->\n\nSHALL a.\n");
    write(
      root,
      "openspec/changes/archive/2026-01-01-old/specs/kernel/spec.md",
      "### Requirement: B\n<!-- id: REQ-KRN-012 -->\n\nSHALL b.\n"
    );
    const run = await runCli(["id", "REQ", "KRN"], root);
    expect(run.status).toBe(0);
    expect(run.json?.command).toBe("id");
    expect(run.json?.ok).toBe(true);
    expect(run.json?.data.id).toBe("REQ-KRN-013");
    expect(run.json?.errors).toEqual([]);
  });

  it("reports AREA_UNKNOWN with exit code 3 (SCN-KRN-057)", async () => {
    const run = await runCli(["id", "REQ", "ZZZ"], project());
    expect(run.status).toBe(3);
    expect(run.json?.ok).toBe(false);
    expect(run.json?.errors[0].code).toBe("AREA_UNKNOWN");
  });

  it("gives two distinct Crockford ULIDs for EVID (SCN-KRN-058)", async () => {
    const root = project();
    const first = await runCli(["id", "EVID"], root);
    const second = await runCli(["id", "EVID"], root);
    expect(first.json?.data.id).toMatch(/^EVID-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(second.json?.data.id).toMatch(/^EVID-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(first.json?.data.id).not.toBe(second.json?.data.id);
    expect((await runCli(["id", "RUN"], root)).json?.data.id).toMatch(/^RUN-[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("gives WAV-<year>-NNN", async () => {
    const root = project();
    const run = await runCli(["id", "WAV"], root);
    expect(run.status).toBe(0);
    expect(run.json?.data.id).toMatch(/^WAV-\d{4}-001$/);
  });

  it("renumbers inside the change only (SCN-KRN-059)", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", {
      $schema: "warrant://change-record/1",
      change: "add-search",
      change_state: "SPECIFIED"
    });
    write(root, "openspec/changes/add-search/tasks.md", "- REQ-KRN-007 and REQ-KRN-0071\n");
    write(root, "tests/search.test.ts", "// REQ-KRN-007\n");
    write(root, "docs/other.md", "REQ-KRN-007\n");

    const run = await runCli(["id", "renumber", "REQ-KRN-007", "REQ-KRN-013", "--change", "add-search"], root);
    expect(run.status).toBe(0);
    expect(run.json?.change).toBe("add-search");
    expect(run.json?.data.old).toBe("REQ-KRN-007");
    expect(run.json?.data.new).toBe("REQ-KRN-013");
    expect(run.json?.data.rewritten).toEqual(["openspec/changes/add-search/tasks.md", "tests/search.test.ts"]);
    expect(read(root, "openspec/changes/add-search/tasks.md")).toBe("- REQ-KRN-013 and REQ-KRN-0071\n");
    expect(read(root, "docs/other.md")).toBe("REQ-KRN-007\n");
  });

  it("refuses to renumber a MERGED change (SCN-KRN-060)", async () => {
    const root = project();
    write(root, ".warrant/changes/add-search.json", {
      $schema: "warrant://change-record/1",
      change: "add-search",
      change_state: "MERGED"
    });
    write(root, "openspec/changes/add-search/tasks.md", "REQ-KRN-007\n");
    const run = await runCli(["id", "renumber", "REQ-KRN-007", "REQ-KRN-013", "--change", "add-search"], root);
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("ID_IMMUTABLE");
    expect(read(root, "openspec/changes/add-search/tasks.md")).toBe("REQ-KRN-007\n");
  });

  it("reports CONFIG_MISSING without .warrant/ (SCN-KRN-007)", async () => {
    const root = makeTempDir("warrant-id-bare-");
    tempDirs.push(root);
    const run = await runCli(["id", "REQ", "KRN"], root);
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("CONFIG_MISSING");
  });

  it("reports USAGE for an unknown kind", async () => {
    const run = await runCli(["id", "FOO"], project());
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("USAGE");
  });
});
