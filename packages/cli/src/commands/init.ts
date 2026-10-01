/**
 * `warrant init [change <name>] [--force]` — bootstrap a project or a Change
 * (REQ-KRN-023).
 *
 * `warrant init` owns a fixed, small set of files: the config, the two empty
 * project-local documents and the four kept directories. Everything else a
 * project needs — the OpenSpec files, the schema copies and the lock — is
 * produced by `warrant sync`, which `init` calls last so the two can never
 * disagree (decision I-17).
 *
 * `warrant init change <name>` refuses a taken name BEFORE calling `openspec`,
 * so a rejected name leaves no half-created change directory (SCN-KRN-055).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { writeJsonFile } from "../core/canon/format-json.js";
import { knownFrontends } from "../core/config.js";
import type { Ctx } from "../core/ctx.js";
import { WarrantError } from "../core/errors.js";
import {
  DEFAULT_PACK,
  KEPT_DIRS,
  areasDocument,
  bundledPackVersion,
  changeNameConflict,
  changeRecord,
  configDocument,
  gitignoreWithRawEvidence,
  isChangeName,
  rulesDocument,
  schemaFromConfigYaml
} from "../core/init/scaffold.js";
import { applySync } from "../core/sync/apply.js";
import { KERNEL_VERSION } from "../version.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { CONFIG_FILE, WARRANT_DIR, requireConfigPath } from "./context.js";

export interface InitOptions {
  /** `--force`: rewrite the files `init` owns instead of keeping what is there. */
  force?: boolean | undefined;
  /** `--frontend <name>`: record `frontends: [name]` in the new config (REQ-KRN-033). */
  frontend?: string | undefined;
}

/** Values `--frontend` accepts, for `--help` of `init`: the enum of `config/1`, not a list of the kernel. */
export function initFrontends(): string[] {
  return knownFrontends();
}

/** `--frontend` as the `frontends[]` of the config; an unknown name is `USAGE` naming the known ones. */
function frontendsOf(frontend: string | undefined): string[] {
  if (frontend === undefined) return [];
  const known = knownFrontends();
  if (!known.includes(frontend)) {
    throw new WarrantError("USAGE", `unknown frontend ${JSON.stringify(frontend)}`, {
      hint: `pass one of: ${known.map((name) => `--frontend ${name}`).join(", ")}`
    });
  }
  return [frontend];
}

const CONFIG_REL = `${WARRANT_DIR}/${CONFIG_FILE}`;

/** Writer that records what it actually created and never silently overwrites. */
function makeWriter(root: string, force: boolean, created: string[]) {
  return {
    json(rel: string, value: Record<string, unknown>): void {
      const absolute = path.join(root, ...rel.split("/"));
      if (existsSync(absolute) && !force) return;
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeJsonFile(absolute, value);
      created.push(rel);
    },
    text(rel: string, content: string): void {
      const absolute = path.join(root, ...rel.split("/"));
      if (existsSync(absolute) && !force) return;
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, content, "utf8");
      created.push(rel);
    }
  };
}

/** `warrant init` — create the project skeleton, then sync. */
export async function runInit(ctx: Ctx, opts: InitOptions = {}): Promise<CommandResult> {
  const { root } = ctx;
  const force = opts.force === true;
  const frontends = frontendsOf(opts.frontend);
  const configAbs = path.join(root, WARRANT_DIR, CONFIG_FILE);

  // Checked first, and without touching `openspec`: a second `init` must fail
  // the same way whether or not the binary is installed (SCN-KRN-053).
  if (existsSync(configAbs) && !force) {
    throw new WarrantError("ALREADY_INITIALIZED", `${CONFIG_REL} already exists`, {
      path: CONFIG_REL,
      hint: "rerun with --force to rewrite it"
    });
  }

  // The config records the OpenSpec version, so a missing binary is refused
  // before anything is written (decision I-16).
  const version = await ctx.openspec.version();
  if (version === null) {
    throw new WarrantError(
      "OPENSPEC_FAILED",
      "`openspec` is required but was not found on PATH",
      { path: CONFIG_REL, hint: "install it and rerun `warrant init`" }
    );
  }
  const packVersion = bundledPackVersion(DEFAULT_PACK);

  const created: string[] = [];
  const write = makeWriter(root, force, created);

  write.json(CONFIG_REL, configDocument(KERNEL_VERSION, version, packVersion, frontends));
  write.json(`${WARRANT_DIR}/local/areas.json`, areasDocument());
  write.json(`${WARRANT_DIR}/local/openspec/rules.json`, rulesDocument());
  for (const dir of KEPT_DIRS) write.text(`${WARRANT_DIR}/${dir}/.gitkeep`, "");

  // Raw check output stays out of git (REQ-VER-001); an existing `.gitignore`
  // only gets the line appended, never rewritten.
  const gitignore = path.join(root, ".gitignore");
  const ignored = gitignoreWithRawEvidence(existsSync(gitignore) ? readFileSync(gitignore, "utf8") : null);
  if (ignored !== null) {
    writeFileSync(gitignore, ignored, "utf8");
    created.push(".gitignore");
  }

  // Schema copies, the OpenSpec files and the lock are `sync`'s files.
  requireConfigPath(root);
  const synced = await applySync(ctx, false);
  // `.gitignore` can be both `init`'s file and one `sync` merged a line into.
  const data: Record<string, unknown> = {
    created: [...new Set([...created, ...((synced.data["changed"] as string[] | undefined) ?? [])])],
    sync: synced.data
  };
  if (!synced.ok) return failures(synced.errors, data);
  return success(data);
}

/** `warrant init change <name>` — reserve the name, then create the Change. */
export async function runInitChange(ctx: Ctx, name: string | undefined): Promise<CommandResult> {
  const { root } = ctx;
  requireConfigPath(root);
  if (name === undefined || !isChangeName(name)) {
    throw new WarrantError("USAGE", "usage: warrant init change <name>, where <name> is kebab-case");
  }

  const conflict = changeNameConflict(root, name);
  if (conflict !== null) {
    throw new WarrantError("CHANGE_NAME_TAKEN", `the change name "${name}" is already used by ${conflict}`, {
      path: conflict
    });
  }

  const configYaml = path.join(root, "openspec", "config.yaml");
  if (!existsSync(configYaml)) {
    throw new WarrantError("CONFIG_INVALID", "openspec/config.yaml not found", {
      path: "openspec/config.yaml",
      hint: "run `warrant sync` first"
    });
  }
  const schema = schemaFromConfigYaml(readFileSync(configYaml, "utf8"));
  if (schema === null) {
    throw new WarrantError("CONFIG_INVALID", "openspec/config.yaml declares no `schema`", {
      path: "openspec/config.yaml"
    });
  }

  const run = await ctx.openspec.newChange(name, schema);
  if (!run.ok) {
    throw new WarrantError("OPENSPEC_FAILED", `openspec new change failed: ${run.output.trim()}`, {
      path: `openspec/changes/${name}`
    });
  }

  const recordRel = `${WARRANT_DIR}/changes/${name}.json`;
  const recordAbs = path.join(root, WARRANT_DIR, "changes", `${name}.json`);
  mkdirSync(path.dirname(recordAbs), { recursive: true });
  writeJsonFile(recordAbs, changeRecord(name));

  return success({ change: name, record: recordRel, openspec_dir: `openspec/changes/${name}` }, name);
}

/** Dispatcher for the `init` command: `warrant init` and `warrant init change <name>`. */
export async function runInitCommand(ctx: Ctx, args: string[], opts: InitOptions = {}): Promise<CommandResult> {
  const what = args[0];
  if (what === undefined) return runInit(ctx, opts);
  if (what === "change") {
    if (opts.frontend !== undefined) {
      throw new WarrantError("USAGE", "--frontend applies to `warrant init` of a project, not to `init change`", {
        hint: "run `warrant init change <name>` without --frontend"
      });
    }
    return runInitChange(ctx, args[1]);
  }
  throw new WarrantError("USAGE", `unknown argument "${what}"; usage: warrant init [change <name>] [--force] [--frontend <name>]`);
}
