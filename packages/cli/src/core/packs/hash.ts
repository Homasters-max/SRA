/**
 * Content hash of a pack and the lock check of `validate` (REQ-KRN-005,
 * REQ-KRN-021 check 2).
 *
 * `packContentHash` is the one function that decides what a pack's hash is;
 * `sync` (group 7) writes the lock with the very same function, so a lock
 * written by `sync` always satisfies the check below.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { bytesHash, canonicalHash } from "../canon/hash.js";
import type { WarrantConfig } from "../config.js";
import { cliError, SYNC_HINT, type CliError } from "../errors.js";
import { reportPath, walkFiles } from "../fs.js";
import { isPlainObject } from "../json.js";
import { validateFile } from "../schemas/semantic.js";
import { versionSatisfies } from "../version-range.js";
import { CLI_VERSION, KERNEL_VERSION } from "../../version.js";

import { bundledPacksDir } from "./loader.js";
import type { LoadedPack } from "./types.js";

export const LOCK_REL = ".warrant/warrant.lock.json";

/**
 * Root of what ships with the CLI: the directory holding the bundled `packs/`
 * (the repository, or the installed package). `lock.skills.*.path` with
 * `source: "bundled"` is relative to it (I-52).
 */
export function bundleRoot(): string {
  return path.dirname(bundledPacksDir());
}

/**
 * Каталог фикстур pack'а, не входящий в его содержимое (решение I-59).
 *
 * `golden/` — мини-проекты, которыми pack проверяет сам себя. Каждый из них
 * хранит собственный `warrant.lock.json`, а лок записывает хэш содержимого
 * pack'а. Если бы `golden/` попадал в этот хэш, запись лока меняла бы хэш,
 * который она только что записала, — неподвижной точки не существует. Фикстуры
 * не перечислены в `provides`, loader их не читает, и на effective policy они не
 * влияют, поэтому исключение ничего не ослабляет.
 */
export const PACK_FIXTURES_DIR = "golden";

/**
 * Hash of a pack directory: the byte hash of every file under it, keyed by its
 * POSIX path relative to the pack root, run through RFC 8785. Sorting comes
 * from the canonical JSON form, so the result does not depend on the order the
 * file system returned. `golden/` is left out (see {@link PACK_FIXTURES_DIR}).
 */
export function packContentHash(dir: string): string {
  const files: Record<string, string> = {};
  for (const absolute of walkFiles(dir)) {
    const rel = path.relative(dir, absolute).split(path.sep).join("/");
    if (rel === PACK_FIXTURES_DIR || rel.startsWith(`${PACK_FIXTURES_DIR}/`)) continue;
    files[rel] = bytesHash(readFileSync(absolute));
  }
  return canonicalHash({ files });
}

export interface LockCheckInput {
  projectRoot: string;
  config: WarrantConfig;
  packs: LoadedPack[];
}

/**
 * Check (2) of `validate`: the lock exists, validates, and agrees with the
 * packs actually loaded and with the bytes of every generated file and skill
 * it lists. A missing lock is LOCK_MISMATCH rather than CONFIG_MISSING: the
 * project is configured, it just has never been synced.
 */
export function checkLock(input: LockCheckInput): CliError[] {
  const { projectRoot, config, packs } = input;
  const absolute = path.join(projectRoot, ".warrant", "warrant.lock.json");
  const errors: CliError[] = [];

  if (!existsSync(absolute)) {
    return [cliError("LOCK_MISMATCH", "lock file is missing", { path: LOCK_REL, hint: SYNC_HINT })];
  }

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (cause) {
    return [cliError("LOCK_MISMATCH", `lock file is not valid JSON: ${(cause as Error).message}`, { path: LOCK_REL })];
  }

  const validation = validateFile(json, LOCK_REL);
  if (!validation.ok) return validation.errors;

  const lock = json as Record<string, unknown>;

  const lockKernel = typeof lock["kernel"] === "string" ? lock["kernel"] : "";
  if (lockKernel.split(".").slice(0, 2).join(".") !== KERNEL_VERSION) {
    errors.push(
      cliError(
        "LOCK_MISMATCH",
        `lock was written by kernel ${lockKernel || "(absent)"}, this CLI is ${CLI_VERSION}`,
        { path: `${LOCK_REL}#/kernel`, hint: SYNC_HINT }
      )
    );
  }

  const lockPacks = isPlainObject(lock["packs"]) ? lock["packs"] : {};
  for (const pack of packs) {
    const entry = lockPacks[pack.id];
    if (!isPlainObject(entry)) {
      errors.push(
        cliError(
          "LOCK_MISMATCH",
          `pack ${pack.id} is enabled but absent from the lock`,
          { path: `${LOCK_REL}#/packs/${pack.id}`, hint: SYNC_HINT }
        )
      );
      continue;
    }
    if (entry["version"] !== pack.version) {
      errors.push(
        cliError(
          "LOCK_MISMATCH",
          `lock records ${pack.id} ${String(entry["version"])}, the pack on disk is ${pack.version}`,
          { path: `${LOCK_REL}#/packs/${pack.id}/version` }
        )
      );
    }
    const actual = packContentHash(pack.dir);
    if (entry["hash"] !== actual) {
      errors.push(
        cliError(
          "LOCK_MISMATCH",
          `content of pack ${pack.id} does not match the hash in the lock`,
          { path: `${LOCK_REL}#/packs/${pack.id}/hash`, hint: SYNC_HINT }
        )
      );
    }
    // Version range the pack was configured with, or `*` when the config says nothing.
    const range = config.packs.find((entry) => entry.id === pack.id)?.range ?? "*";
    const lockVersion = typeof entry["version"] === "string" ? entry["version"] : "";
    if (lockVersion !== "" && range !== "*" && !versionSatisfies(lockVersion, range)) {
      errors.push(
        cliError(
          "LOCK_MISMATCH",
          `lock records ${pack.id} ${lockVersion}, which does not satisfy the configured range "${range}"`,
          { path: `${LOCK_REL}#/packs/${pack.id}/version` }
        )
      );
    }
  }

  // B3: a pack removed from `warrant.json` but still in the lock is a stale
  // lock, not a harmless leftover — `sync --check` already sees it (SCN-KRN-094).
  const configured = new Set(config.packs.map((entry) => entry.id));
  for (const id of Object.keys(lockPacks).sort()) {
    if (id === "$comment" || configured.has(id)) continue;
    errors.push(
      cliError(
        "LOCK_MISMATCH",
        `lock records pack ${id}, which .warrant/warrant.json does not enable`,
        { path: `${LOCK_REL}#/packs/${id}`, hint: SYNC_HINT }
      )
    );
  }

  const generated = isPlainObject(lock["generated"]) ? lock["generated"] : {};
  for (const [rel, hash] of Object.entries(generated)) {
    if (rel === "$comment") continue;
    const target = path.join(projectRoot, rel);
    if (!existsSync(target)) {
      errors.push(cliError("LOCK_MISMATCH", `generated file listed in the lock is missing`, { path: rel }));
      continue;
    }
    if (bytesHash(readFileSync(target)) !== hash) {
      errors.push(
        cliError(
          "LOCK_MISMATCH",
          "generated file differs from the hash in the lock",
          { path: `${LOCK_REL}#/generated/${rel}`, hint: SYNC_HINT }
        )
      );
    }
  }

  const skills = isPlainObject(lock["skills"]) ? lock["skills"] : {};
  for (const [name, entry] of Object.entries(skills)) {
    if (name === "$comment" || !isPlainObject(entry)) continue;
    const rel = typeof entry["path"] === "string" ? entry["path"] : "";
    const bundled = entry["source"] === "bundled";
    const target = path.join(bundled ? bundleRoot() : projectRoot, rel);
    if (rel === "" || !existsSync(target)) {
      errors.push(
        cliError(
          "LOCK_MISMATCH",
          `skill ${name} listed in the lock is missing`,
          { path: `${LOCK_REL}#/skills/${name}/path` }
        )
      );
      continue;
    }
    const actual = statSync(target).isDirectory() ? packContentHash(target) : bytesHash(readFileSync(target));
    if (entry["hash"] !== actual) {
      // The path reported is the skill itself: that is the file to look at,
      // and `warrant sync` is what reconciles the lock with it (SCN-SDD-014).
      errors.push(
        cliError(
          "LOCK_MISMATCH",
          `content of skill ${name} does not match the hash in the lock`,
          { path: bundled ? reportPath(target, projectRoot) : rel, hint: SYNC_HINT }
        )
      );
    }
  }

  return errors;
}
