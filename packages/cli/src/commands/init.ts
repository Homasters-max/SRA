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
import { WarrantError } from "../core/errors.js";
import {
  DEFAULT_PACK,
  KEPT_DIRS,
  areasDocument,
  bundledPackVersion,
  changeNameConflict,
  changeRecord,
  configDocument,
  isChangeName,
  rulesDocument,
  schemaFromConfigYaml
} from "../core/init/scaffold.js";
import { runOpenspec } from "../core/openspec/cli.js";
import { openspecVersion } from "../core/openspec/version.js";
import { KERNEL_VERSION } from "../version.js";
import { runSync } from "./sync.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { CONFIG_FILE, WARRANT_DIR, projectRoot as defaultRoot, requireConfigPath } from "./context.js";

export interface InitOptions {
  /** `--force`: rewrite the files `init` owns instead of keeping what is there. */
  force?: boolean | undefined;
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
export function runInit(opts: InitOptions = {}, root: string = defaultRoot()): CommandResult {
  const force = opts.force === true;
  const configAbs = path.join(root, WARRANT_DIR, CONFIG_FILE);

  // Checked first, and without touching `openspec`: a second `init` must fail
  // the same way whether or not the binary is installed (SCN-KRN-053).
  if (existsSync(configAbs) && !force) {
    throw new WarrantError("ALREADY_INITIALIZED", `${CONFIG_REL} already exists; rerun with --force to rewrite it`, {
      path: CONFIG_REL
    });
  }

  // The config records the OpenSpec version, so a missing binary is refused
  // before anything is written (decision I-16).
  const version = openspecVersion(root);
  if (version === null) {
    throw new WarrantError(
      "OPENSPEC_FAILED",
      "`openspec` is required but was not found on PATH; install it and rerun `warrant init`",
      { path: CONFIG_REL }
    );
  }
  const packVersion = bundledPackVersion(DEFAULT_PACK);

  const created: string[] = [];
  const write = makeWriter(root, force, created);

  write.json(CONFIG_REL, configDocument(KERNEL_VERSION, version, packVersion));
  write.json(`${WARRANT_DIR}/local/areas.json`, areasDocument());
  write.json(`${WARRANT_DIR}/local/openspec/rules.json`, rulesDocument());
  for (const dir of KEPT_DIRS) write.text(`${WARRANT_DIR}/${dir}/.gitkeep`, "");

  // Schema copies, the OpenSpec files and the lock are `sync`'s files.
  const synced = runSync({}, root);
  const data: Record<string, unknown> = {
    created: [...created, ...((synced.data["changed"] as string[] | undefined) ?? [])],
    sync: synced.data
  };
  if (!synced.ok) return failures(synced.errors, synced.exitCode, data);
  return success(data);
}

/** `warrant init change <name>` — reserve the name, then create the Change. */
export function runInitChange(name: string | undefined, root: string = defaultRoot()): CommandResult {
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
    throw new WarrantError("CONFIG_INVALID", "openspec/config.yaml not found; run `warrant sync` first", {
      path: "openspec/config.yaml"
    });
  }
  const schema = schemaFromConfigYaml(readFileSync(configYaml, "utf8"));
  if (schema === null) {
    throw new WarrantError("CONFIG_INVALID", "openspec/config.yaml declares no `schema`", {
      path: "openspec/config.yaml"
    });
  }

  const run = runOpenspec(["new", "change", name, "--schema", schema, "--json"], root);
  if (!run.ok) {
    throw new WarrantError("OPENSPEC_FAILED", `openspec new change failed: ${(run.stderr || run.stdout).trim()}`, {
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
export function runInitCommand(args: string[], opts: InitOptions = {}, root: string = defaultRoot()): CommandResult {
  const what = args[0];
  if (what === undefined) return runInit(opts, root);
  if (what === "change") return runInitChange(args[1], root);
  throw new WarrantError("USAGE", `unknown argument "${what}"; usage: warrant init [change <name>] [--force]`);
}
