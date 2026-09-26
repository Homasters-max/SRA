/**
 * Reading a JSON file in a test (A-30): one helper for every level instead of a
 * `readJson` per file. `ProjectBuilder.json(rel)` reads through it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** The parsed JSON of the file `path.join(...segments)`: an absolute path, or a root and a POSIX path under it. */
export function readJsonFile(...segments: string[]): any {
  return JSON.parse(readFileSync(path.join(...segments), "utf8"));
}
