/**
 * Paths and file-system walking shared by every module (ADR-0030 point 1, A-3):
 * the one owner of `posix`, `reportPath`, `walkFiles` and `readJson`. A local
 * copy of any of them is an error of `test/unit/meta/architecture.test.ts`
 * (`helper` rule).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { CliError } from "./errors.js";

/** A platform path with POSIX separators. */
export function posix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Path as it appears in `errors[].path`: relative to the project root, POSIX separators. */
export function reportPath(absolute: string, projectRoot: string): string {
  const rel = path.relative(projectRoot, absolute);
  const chosen = rel.startsWith("..") || path.isAbsolute(rel) ? absolute : rel;
  return posix(chosen);
}

/** Every file under `dir`, recursively, as absolute paths sorted by POSIX relative path. */
export function walkFiles(dir: string, skip: (abs: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const visit = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      const abs = path.join(current, name);
      if (skip(abs)) continue;
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (name === "node_modules" || name === ".git") continue;
        visit(abs);
      } else if (stat.isFile()) {
        out.push(abs);
      }
    }
  };
  visit(dir);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Reads and parses a JSON file, pushing a CONFIG_INVALID on unreadable or malformed content. */
export function readJson(absolute: string, reported: string, errors: CliError[]): unknown | undefined {
  let text: string;
  try {
    text = readFileSync(absolute, "utf8");
  } catch (cause) {
    errors.push({ code: "CONFIG_INVALID", message: `cannot read file: ${(cause as Error).message}`, path: reported });
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    errors.push({ code: "CONFIG_INVALID", message: `invalid JSON: ${(cause as Error).message}`, path: reported });
    return undefined;
  }
}
