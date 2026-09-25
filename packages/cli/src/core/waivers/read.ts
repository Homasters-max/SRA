/**
 * Reading `.warrant/waivers/*.json` (ADR-0030 п. 1: `core/waivers`, R2; A-7).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { reportPath, walkFiles } from "../fs.js";
import { isPlainObject } from "../json.js";
import { validateDocument } from "../schemas/loader.js";

/** Directory of the waiver documents, relative to the project root. */
export const WAIVERS_DIR = path.join(".warrant", "waivers");

/** One `.warrant/waivers/*.json` document that parsed to an object. */
export interface WaiverInput {
  /** Path as reported, for findings. */
  path: string;
  json: Record<string, unknown>;
}

/**
 * Every waiver document under `.warrant/waivers/` that parses to an object and
 * matches its schema, for the gate engine (design §8). A file that does not is
 * `validate`'s finding and waives nothing.
 */
export function readWaivers(root: string): WaiverInput[] {
  const out: WaiverInput[] = [];
  for (const absolute of walkFiles(path.join(root, WAIVERS_DIR))) {
    if (!absolute.toLowerCase().endsWith(".json")) continue;
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(absolute, "utf8"));
    } catch {
      continue;
    }
    if (!isPlainObject(json) || json["$schema"] !== "warrant://waiver/1" || !validateDocument(json).ok) continue;
    out.push({ path: reportPath(absolute, root), json });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
