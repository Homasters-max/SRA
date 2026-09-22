/**
 * Check (6) of `validate`: nothing under `.warrant/**` or `.claude/**` looks
 * like a credential (REQ-KRN-021, ADR-0010, design D-8).
 *
 * The finding names the file, the pattern and the line. It NEVER carries the
 * matched text: reporting a leaked token would copy it into logs, CI output and
 * the JSON envelope (SCN-KRN-048).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { CliError } from "./errors.js";

/** The seven patterns of design D-8, each with the name used in the message. */
export const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  // Token prefixes are anchored on the left so a longer word that merely ends
  // in the prefix (`risk-assessment-…`, `laugh_…`) is not mistaken for one.
  { name: "github-personal-token", pattern: /(?<![A-Za-z0-9_])ghp_[A-Za-z0-9]{36}/ },
  { name: "github-token", pattern: /(?<![A-Za-z0-9_])gh[ousr]_[A-Za-z0-9]{36}/ },
  { name: "github-fine-grained-token", pattern: /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{22,}/ },
  { name: "api-secret-key", pattern: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/ },
  { name: "aws-access-key-id", pattern: /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}/ },
  { name: "jwt", pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/ },
  { name: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ }
];

/** Directories scanned by check (6). */
export const SECRET_SCAN_DIRS = [".warrant", ".claude"] as const;

/** Heuristic: a NUL byte in the first 8 KiB means the file is binary and is skipped. */
function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8192);
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** Scans the text of one file. `reported` is the path printed in the finding. */
export function scanText(text: string, reported: string): CliError[] {
  const errors: CliError[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        errors.push({
          code: "SECRET_LIKE",
          message: `line ${index + 1} matches the secret pattern "${name}"; the matched text is deliberately not reported`,
          path: reported
        });
      }
    }
  });
  return errors;
}

/**
 * Scans `.warrant/**` and `.claude/**` of a project.
 * `walk` is injected so the loader's own file walker (which already skips
 * `node_modules` and `.git`) is the single implementation.
 */
export function scanSecrets(
  projectRoot: string,
  walk: (dir: string) => string[],
  reportPath: (absolute: string) => string
): CliError[] {
  const errors: CliError[] = [];
  for (const dirName of SECRET_SCAN_DIRS) {
    const dir = path.join(projectRoot, dirName);
    if (!existsSync(dir)) continue;
    for (const absolute of walk(dir)) {
      let buffer: Buffer;
      try {
        buffer = readFileSync(absolute);
      } catch {
        continue;
      }
      if (looksBinary(buffer)) continue;
      errors.push(...scanText(buffer.toString("utf8"), reportPath(absolute)));
    }
  }
  return errors;
}
