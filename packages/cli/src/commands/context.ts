import { existsSync } from "node:fs";
import path from "node:path";
import { WarrantError } from "../core/errors.js";

export const WARRANT_DIR = ".warrant";
export const CONFIG_FILE = "warrant.json";

/** Project root = current working directory; the CLI never walks upward, so output paths stay relative to it. */
export function projectRoot(): string {
  return process.cwd();
}

/** Throws CONFIG_MISSING when `.warrant/warrant.json` is absent (SCN-KRN-007). */
export function requireConfigPath(root: string = projectRoot()): string {
  const configPath = path.join(root, WARRANT_DIR, CONFIG_FILE);
  if (!existsSync(configPath)) {
    throw new WarrantError("CONFIG_MISSING", `${WARRANT_DIR}/${CONFIG_FILE} not found in ${root}`, {
      path: `${WARRANT_DIR}/${CONFIG_FILE}`
    });
  }
  return configPath;
}
