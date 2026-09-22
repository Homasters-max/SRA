/**
 * `warrant resolve <change>` (REQ-KRN-026): the effective policy of a Change.
 *
 * The command only gathers inputs — the record, an optional `--classification`
 * document and the pack set — and hands them to the pure resolver, so the same
 * inputs always produce the same `hash` (SCN-KRN-065).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { EXIT, WarrantError, type CliError } from "../core/errors.js";
import { loadPacks } from "../core/packs/loader.js";
import { resolveForProject, type Classification } from "../core/resolve/index.js";
import { validateFile } from "../core/schemas/semantic.js";
import { success, failures, type CommandResult } from "../io/output.js";
import { projectRoot, requireConfigPath } from "./context.js";

export interface ResolveOptions {
  explain?: boolean;
  classification?: string;
}

function posix(p: string): string {
  return p.split(path.sep).join("/");
}

function readJsonFile(absolute: string, reported: string): unknown {
  let text: string;
  try {
    text = readFileSync(absolute, "utf8");
  } catch (cause) {
    throw new WarrantError("CONFIG_INVALID", `cannot read file: ${(cause as Error).message}`, { path: reported });
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new WarrantError("CONFIG_INVALID", `invalid JSON: ${(cause as Error).message}`, { path: reported });
  }
}

/** The record of the Change, validated against `warrant://change-record/1`. */
function readRecord(root: string, change: string): Record<string, unknown> {
  const rel = posix(path.join(".warrant", "changes", `${change}.json`));
  const absolute = path.join(root, ".warrant", "changes", `${change}.json`);
  if (!existsSync(absolute)) {
    throw new WarrantError("CHANGE_NOT_FOUND", `no record for change "${change}" in .warrant/changes/`, {
      path: rel
    });
  }
  const json = readJsonFile(absolute, rel);
  const result = validateFile(json, rel);
  if (!result.ok) {
    const first = result.errors[0] as CliError;
    throw new WarrantError(first.code, first.message, { path: first.path ?? rel });
  }
  return json as Record<string, unknown>;
}

/**
 * A stand-alone classification document. It has no schema of its own, so it is
 * validated as the `classification` member of a minimal change record; the
 * wrapper carries no file name, otherwise the `change` semantic rule would
 * complain about the classification file's own name.
 */
function readClassificationFile(root: string, change: string, file: string): Classification {
  const absolute = path.isAbsolute(file) ? file : path.join(root, file);
  const reported = posix(path.relative(root, absolute).startsWith("..") ? absolute : path.relative(root, absolute));
  if (!existsSync(absolute)) {
    throw new WarrantError("CONFIG_MISSING", `classification file not found: ${reported}`, { path: reported });
  }
  const json = readJsonFile(absolute, reported);
  const wrapper = {
    $schema: "warrant://change-record/1",
    change,
    change_state: "PROPOSED",
    classification: json
  };
  const result = validateFile(wrapper);
  if (!result.ok) {
    const first = result.errors[0] as CliError;
    // Pointers are relative to the wrapper; strip the `classification` prefix.
    const pointer = (first.path ?? "").replace(/^#?\/classification/, "");
    throw new WarrantError(first.code, first.message, {
      path: pointer === "" ? reported : `${reported}#${pointer}`
    });
  }
  return json as Classification;
}

export function runResolve(
  change: string,
  opts: ResolveOptions = {},
  root: string = projectRoot()
): CommandResult {
  requireConfigPath(root);

  const record = readRecord(root, change);
  const classification =
    opts.classification !== undefined && opts.classification !== ""
      ? readClassificationFile(root, change, opts.classification)
      : (record["classification"] as Classification | undefined);

  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) return failures(loaded.errors, EXIT.CONFIG, {}, change);

  const { result, errors } = resolveForProject(loaded, classification);
  if (errors.length > 0) return failures(errors, EXIT.CONFIG, {}, change);

  if (!result.ok) {
    // A policy conflict is not a configuration error: the controller escalates
    // it to a human, so the exit code is WAIT (SCN-KRN-067).
    return failures(
      [{ code: "POLICY_CONFLICT", message: result.conflict.message }],
      EXIT.WAIT,
      { controller_action: "ESCALATE", conflicts: result.conflict.items },
      change
    );
  }

  const { explain, ...policy } = result.policy;
  return success(opts.explain === true ? { ...policy, explain } : { ...policy }, change);
}
