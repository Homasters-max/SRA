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
import type { CliError } from "../errors.js";
import { validateFile } from "../schemas/semantic.js";
import { CLI_VERSION, KERNEL_VERSION } from "../../version.js";
import semver from "semver";

import { walkFiles } from "./loader.js";
import type { LoadedPack } from "./types.js";

export const LOCK_REL = ".warrant/warrant.lock.json";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function err(code: CliError["code"], message: string, p: string): CliError {
  return { code, message, path: p };
}

/**
 * Hash of a pack directory: the byte hash of every file under it, keyed by its
 * POSIX path relative to the pack root, run through RFC 8785. Sorting comes
 * from the canonical JSON form, so the result does not depend on the order the
 * file system returned.
 */
export function packContentHash(dir: string): string {
  const files: Record<string, string> = {};
  for (const absolute of walkFiles(dir)) {
    const rel = path.relative(dir, absolute).split(path.sep).join("/");
    files[rel] = bytesHash(readFileSync(absolute));
  }
  return canonicalHash({ files });
}

/** Version range a pack was configured with, or `*` when the config says nothing. */
function configuredRange(config: Record<string, unknown>, id: string): string {
  const packs = config["packs"];
  if (!isPlainObject(packs)) return "*";
  const entry = packs[id];
  return isPlainObject(entry) && typeof entry["version"] === "string" ? entry["version"] : "*";
}

export interface LockCheckInput {
  projectRoot: string;
  config: Record<string, unknown>;
  packs: LoadedPack[];
  /**
   * `--no-generated` (I-43): skip the hash check of lock entries under
   * `openspec/` — the files check (4) would compare. Schema copies under
   * `.warrant/schemas/` are always checked.
   */
  skipOpenspecGenerated?: boolean | undefined;
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
    return [err("LOCK_MISMATCH", "lock file is missing; run `warrant sync`", LOCK_REL)];
  }

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (cause) {
    return [err("LOCK_MISMATCH", `lock file is not valid JSON: ${(cause as Error).message}`, LOCK_REL)];
  }

  const validation = validateFile(json, LOCK_REL);
  if (!validation.ok) return validation.errors;

  const lock = json as Record<string, unknown>;

  const lockKernel = typeof lock["kernel"] === "string" ? lock["kernel"] : "";
  if (lockKernel.split(".").slice(0, 2).join(".") !== KERNEL_VERSION) {
    errors.push(
      err(
        "LOCK_MISMATCH",
        `lock was written by kernel ${lockKernel || "(absent)"}, this CLI is ${CLI_VERSION}; run \`warrant sync\``,
        `${LOCK_REL}#/kernel`
      )
    );
  }

  const lockPacks = isPlainObject(lock["packs"]) ? lock["packs"] : {};
  for (const pack of packs) {
    const entry = lockPacks[pack.id];
    if (!isPlainObject(entry)) {
      errors.push(
        err("LOCK_MISMATCH", `pack ${pack.id} is enabled but absent from the lock; run \`warrant sync\``, `${LOCK_REL}#/packs/${pack.id}`)
      );
      continue;
    }
    if (entry["version"] !== pack.version) {
      errors.push(
        err(
          "LOCK_MISMATCH",
          `lock records ${pack.id} ${String(entry["version"])}, the pack on disk is ${pack.version}`,
          `${LOCK_REL}#/packs/${pack.id}/version`
        )
      );
    }
    const actual = packContentHash(pack.dir);
    if (entry["hash"] !== actual) {
      errors.push(
        err(
          "LOCK_MISMATCH",
          `content of pack ${pack.id} does not match the hash in the lock; run \`warrant sync\``,
          `${LOCK_REL}#/packs/${pack.id}/hash`
        )
      );
    }
    const range = configuredRange(config, pack.id);
    const lockVersion = typeof entry["version"] === "string" ? entry["version"] : "";
    if (lockVersion !== "" && range !== "*" && !semver.satisfies(lockVersion, range, { includePrerelease: true })) {
      errors.push(
        err(
          "LOCK_MISMATCH",
          `lock records ${pack.id} ${lockVersion}, which does not satisfy the configured range "${range}"`,
          `${LOCK_REL}#/packs/${pack.id}/version`
        )
      );
    }
  }

  const generated = isPlainObject(lock["generated"]) ? lock["generated"] : {};
  for (const [rel, hash] of Object.entries(generated)) {
    if (rel === "$comment") continue;
    if (input.skipOpenspecGenerated === true && rel.startsWith("openspec/")) continue;
    const target = path.join(projectRoot, rel);
    if (!existsSync(target)) {
      errors.push(err("LOCK_MISMATCH", `generated file listed in the lock is missing`, rel));
      continue;
    }
    if (bytesHash(readFileSync(target)) !== hash) {
      errors.push(
        err("LOCK_MISMATCH", `generated file differs from the hash in the lock; run \`warrant sync\``, `${LOCK_REL}#/generated/${rel}`)
      );
    }
  }

  const skills = isPlainObject(lock["skills"]) ? lock["skills"] : {};
  for (const [name, entry] of Object.entries(skills)) {
    if (name === "$comment" || !isPlainObject(entry)) continue;
    const rel = typeof entry["path"] === "string" ? entry["path"] : "";
    const target = path.join(projectRoot, rel);
    if (rel === "" || !existsSync(target)) {
      errors.push(err("LOCK_MISMATCH", `skill ${name} listed in the lock is missing`, `${LOCK_REL}#/skills/${name}/path`));
      continue;
    }
    const actual = statSync(target).isDirectory() ? packContentHash(target) : bytesHash(readFileSync(target));
    if (entry["hash"] !== actual) {
      // The path reported is the skill itself: that is the file to look at,
      // and `warrant sync` is what reconciles the lock with it (SCN-SDD-014).
      errors.push(
        err("LOCK_MISMATCH", `content of skill ${name} does not match the hash in the lock; run \`warrant sync\``, rel)
      );
    }
  }

  return errors;
}
