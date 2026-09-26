/**
 * `warrant analyze <change> [--base <ref>]` (REQ-VER-010, N19, N20, ADR-0036
 * п. 2): the consistency of the delta specs, `tasks.md` and the tests of an
 * active Change by ids and references — the function gate `analyze-clean`
 * judges by, printed as a report. Reads, never writes: no `--dry-run`.
 *
 * `data{ change, findings[], counts{ UNSATISFIED, CONFLICT, ORPHAN }, skipped[] }`;
 * exit 1 with a finding, else 0; an unknown Change is `CHANGE_NOT_FOUND`, exit 3.
 * The diff is `base...HEAD` as gate `scope-valid` reads it: without it
 * (no git, no base) `ORPHAN` is skipped, the rest is computed.
 */
import { analyze, countFindings } from "../core/analyze/index.js";
import { readAnalyzeInput } from "../core/analyze/input.js";
import { loadConfig } from "../core/config.js";
import type { Ctx } from "../core/ctx.js";
import { EXIT, WarrantError } from "../core/errors.js";
import { changedPaths, readGitFacts } from "../core/git/facts.js";
import { workingTreeFiles } from "../core/git/files.js";
import { findChangeDir } from "../core/openspec/changes.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { requireConfigPath } from "./context.js";

export interface AnalyzeOptions {
  /** `--base <ref>`; default `merge-base(HEAD, main)`. */
  base?: string | undefined;
}

export async function runAnalyze(ctx: Ctx, change: string, opts: AnalyzeOptions = {}): Promise<CommandResult> {
  requireConfigPath(ctx.root);
  const config = loadConfig(ctx.root);
  if (findChangeDir(ctx.root, change)?.where !== "active") {
    throw new WarrantError("CHANGE_NOT_FOUND", `openspec/changes/${change}/ is not an active change directory`, {
      path: `openspec/changes/${change}`,
      hint: "check the name of the Change: `warrant status` lists them; an archived Change is not analyzed"
    });
  }
  const git = await readGitFacts(ctx, opts.base);
  const diff = await changedPaths(ctx, git);
  const { findings, skipped } = analyze(readAnalyzeInput(workingTreeFiles(ctx.root), change, config, diff));
  const data = { change, findings, counts: countFindings(findings), skipped };
  return findings.length === 0 ? success(data, change) : failures([], EXIT.FAIL, data, change);
}
