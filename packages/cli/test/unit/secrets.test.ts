import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { scanSecrets, scanText, SECRET_PATTERNS } from "../../src/core/secrets.js";
import { reportPath, walkFiles } from "../../src/core/packs/loader.js";
import { CLI_ROOT, makeTempDir, removeDir } from "../helpers/cli.js";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

// Built at runtime so the literal token never appears in the repository.
const FAKE_TOKEN = "ghp_" + "a1b2c3d4e5".repeat(3) + "f6g7h8";

describe("scanText", () => {
  it("names the pattern and the line but never the matched text (SCN-KRN-048)", () => {
    const errors = scanText(`{\n  "token": "${FAKE_TOKEN}"\n}`, ".claude/settings.json");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("SECRET_LIKE");
    expect(errors[0]?.path).toBe(".claude/settings.json");
    expect(errors[0]?.message).toContain("github-personal-token");
    expect(errors[0]?.message).toContain("line 2");
    expect(errors[0]?.message).not.toContain(FAKE_TOKEN);
  });

  it("carries all seven patterns of design D-8", () => {
    expect(SECRET_PATTERNS.map((p) => p.name)).toEqual([
      "github-personal-token",
      "github-token",
      "github-fine-grained-token",
      "api-secret-key",
      "aws-access-key-id",
      "jwt",
      "private-key-block"
    ]);
  });

  it("does not fire on ordinary WARRANT content", () => {
    const sample = [
      '{"$schema": "warrant://gate/1", "id": "tests-passed", "waivable": false}',
      "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "REQ-KRN-001 / SCN-KRN-048 / EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3"
    ].join("\n");
    expect(scanText(sample, "x.json")).toEqual([]);
  });

  it("does not fire on words that merely end in a token prefix", () => {
    const sample = [
      "risk-assessment-framework-overview-and-checklist",
      "task-tracking-improvements-v2-for-the-kernel",
      "laugh_" + "a1b2c3d4e5".repeat(3) + "f6g7h8",
      "MAKIA" + "0123456789ABCDEF"
    ].join("\n");
    expect(scanText(sample, "x.md")).toEqual([]);
  });

  it("still fires on a token at a word boundary", () => {
    const key = "sk-" + "abcdefghij".repeat(3);
    expect(scanText(`key: ${key}`, "x.md").map((e) => e.message)).toEqual(
      expect.arrayContaining([expect.stringContaining("api-secret-key")])
    );
  });

  it("does not fire on any fixture shipped with this repository", () => {
    const dir = path.join(CLI_ROOT, "test", "fixtures");
    const findings = walkFiles(dir).flatMap((absolute) =>
      scanText(readFileSync(absolute, "utf8"), absolute)
    );
    expect(findings).toEqual([]);
  });
});

describe("scanSecrets", () => {
  it("scans .warrant/** and .claude/** only", () => {
    const root = makeTempDir("warrant-secrets-");
    tempDirs.push(root);
    mkdirSync(path.join(root, ".claude"), { recursive: true });
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, ".claude", "settings.json"), `{"token":"${FAKE_TOKEN}"}`);
    writeFileSync(path.join(root, "src", "ignored.txt"), FAKE_TOKEN);

    const errors = scanSecrets(root, walkFiles, (absolute) => reportPath(absolute, root));
    expect(errors.map((e) => e.path)).toEqual([".claude/settings.json"]);
  });
});
