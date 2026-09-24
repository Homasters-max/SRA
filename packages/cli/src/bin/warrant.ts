#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { CheckRunner } from "../adapters/check-runner.js";
import { GitCli } from "../adapters/git-cli.js";
import { OpenSpecCli } from "../adapters/openspec-cli.js";
import type { Ctx } from "../core/ctx.js";
import { EXIT, WarrantError } from "../core/errors.js";
import { systemClock } from "../core/ports/clock.js";
import { emitToProcess, failure, resultFromThrown, writeStdout, type CommandResult } from "../io/output.js";
import { CLI_VERSION } from "../version.js";
import { projectRoot, requireConfigPath } from "../commands/context.js";
import { runInitCommand } from "../commands/init.js";
import { runValidate } from "../commands/validate.js";
import { runFmt } from "../commands/fmt.js";
import { runId } from "../commands/id.js";
import { runSync } from "../commands/sync.js";
import { runResolve } from "../commands/resolve.js";
import { runStatus } from "../commands/status.js";
import { runClassify } from "../commands/classify.js";
import { runCheck } from "../commands/check.js";
import { runGate } from "../commands/gate.js";
import { runVerify } from "../commands/verify.js";
import { runTransition } from "../commands/transition.js";
import { runArchive } from "../commands/archive.js";
import { runLink } from "../commands/link.js";
import { runWaive } from "../commands/waive.js";

export type Runner = (ctx: Ctx, args: string[], opts: Record<string, unknown>) => Promise<CommandResult> | CommandResult;

/** The production `ctx` (ADR-0025 п. 2): the adapters over `openspec`, `git` and the check runner, rooted at the cwd. */
function productionCtx(): Ctx {
  const root = projectRoot();
  return {
    root,
    openspec: new OpenSpecCli(root),
    git: new GitCli(root),
    checks: new CheckRunner(),
    clock: systemClock,
    warn: (text) => void process.stderr.write(text)
  };
}

const program = new Command("warrant")
  .description("WARRANT specification governance CLI")
  .version(CLI_VERSION, "-V, --version")
  .option("--json", "print the JSON envelope (always on in phase 1)")
  .exitOverride()
  .configureOutput({
    // Commander's own help/errors are diagnostics, not the envelope: keep stdout clean.
    writeOut: (text) => process.stderr.write(text),
    writeErr: (text) => process.stderr.write(text)
  });

async function run(name: string, runner: Runner, args: string[], opts: Record<string, unknown>): Promise<void> {
  let result: CommandResult;
  try {
    result = await runner(productionCtx(), args, opts);
  } catch (thrown) {
    result = resultFromThrown(thrown);
  }
  // No `process.exit`: the exit code is set after stdout accepted the whole
  // envelope, and Node ends the process once the pipe has drained (B4).
  await emitToProcess(name, result);
}

/** Commander collector of a repeatable option. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function register(name: string, description: string, runner: Runner, configure?: (cmd: Command) => void): void {
  const cmd = program.command(name).description(description);
  configure?.(cmd);
  cmd.action(async (...actionArgs: unknown[]) => {
    const command = actionArgs[actionArgs.length - 1] as Command;
    await run(name, runner, command.args, command.opts());
  });
}

register(
  "init",
  "initialise .warrant/ or a new change",
  // `init` is the one command that must run without an existing config;
  // `init change` checks for one itself.
  (ctx, args, opts) => runInitCommand(ctx, args, { force: opts["force"] as boolean | undefined }),
  (c) => c.argument("[what]").argument("[name]").option("--force")
);
register(
  "validate",
  "validate configuration, packs, schemas, ids and generated files",
  (ctx) => {
    // CONFIG_MISSING first, exactly as for the other config-bound commands (SCN-KRN-007).
    requireConfigPath(ctx.root);
    return runValidate(ctx);
  }
);
register(
  "fmt",
  "canonicalise JSON files",
  (ctx, args, opts) => runFmt(ctx, args, { check: opts["check"] as boolean | undefined }),
  (c) => c.argument("[paths...]").option("--check")
);
register(
  "id",
  "allocate stable ids",
  (ctx, args, opts) => runId(ctx, args, { ...(typeof opts["change"] === "string" ? { change: opts["change"] as string } : {}) }),
  (c) => c.argument("[args...]").option("--change <name>")
);
register(
  "sync",
  "generate OpenSpec files and lock",
  (ctx, _args, opts) => runSync(ctx, { check: opts["check"] as boolean | undefined }),
  (c) => c.option("--check")
);
register(
  "resolve",
  "compute effective policy",
  (ctx, args, opts) =>
    runResolve(ctx, args[0] as string, {
      ...(opts["explain"] === true ? { explain: true } : {}),
      ...(typeof opts["classification"] === "string" ? { classification: opts["classification"] } : {})
    }),
  (c) => c.argument("<change>").option("--explain").option("--classification <file>")
);
register(
  "classify",
  "compute and record the classification of a change",
  (ctx, args, opts) =>
    runClassify(ctx, args[0] as string, {
      ...(typeof opts["base"] === "string" ? { base: opts["base"] } : {}),
      ...(typeof opts["paths"] === "string" ? { paths: opts["paths"] } : {}),
      ...(typeof opts["propose"] === "string" ? { propose: opts["propose"] } : {}),
      ...(Array.isArray(opts["set"]) && opts["set"].length > 0 ? { set: opts["set"] as string[] } : {}),
      ...(typeof opts["by"] === "string" ? { by: opts["by"] } : {}),
      ...(typeof opts["ref"] === "string" ? { ref: opts["ref"] } : {})
    }),
  (c) =>
    c
      .argument("<change>")
      .option("--base <ref>", "git ref to diff HEAD against (default: main)")
      .option("--paths <file>", "file with one changed path per line, instead of git")
      .option("--propose <json>", "proposer's profiles and risk values as JSON")
      .option("--set <dim=value>", "a human value: <dimension>=<value> or profile=<id> (repeatable; needs --by)", collect, [])
      .option("--by <login>", "login of the human behind --set; must be listed in roles of warrant.json")
      .option(
        "--ref <url>",
        "URL of the approval of the --set risk values; lets them go below the floor (PROPOSED/SPECIFIED only, --by in the approvers of SPECIFIED->APPROVED)"
      )
);
register(
  "link",
  "add or remove an amends/supersedes link of a change (PROPOSED or SPECIFIED only)",
  (ctx, args, opts) =>
    runLink(ctx, args[0] as string, {
      ...(typeof opts["amends"] === "string" ? { amends: opts["amends"] } : {}),
      ...(typeof opts["supersedes"] === "string" ? { supersedes: opts["supersedes"] } : {}),
      ...(opts["remove"] === true ? { remove: true } : {})
    }),
  (c) =>
    c
      .argument("<change>")
      .option("--amends <target>", "a MERGED or ARCHIVED change this one amends")
      .option("--supersedes <target>", "an ABANDONED change this one supersedes")
      .option("--remove", "remove the target from the list instead of adding it")
);
register(
  "waive",
  "propose a waiver (<change> <gate> ...), or --activate / --revoke one as a maintainer",
  (ctx, args, opts) =>
    runWaive(ctx, args, {
      ...(typeof opts["reason"] === "string" ? { reason: opts["reason"] } : {}),
      ...(typeof opts["risk"] === "string" ? { risk: opts["risk"] } : {}),
      ...(Array.isArray(opts["control"]) && opts["control"].length > 0 ? { control: opts["control"] as string[] } : {}),
      ...(typeof opts["owner"] === "string" ? { owner: opts["owner"] } : {}),
      ...(typeof opts["expires"] === "string" ? { expires: opts["expires"] } : {}),
      ...(typeof opts["activate"] === "string" ? { activate: opts["activate"] } : {}),
      ...(typeof opts["revoke"] === "string" ? { revoke: opts["revoke"] } : {}),
      ...(typeof opts["by"] === "string" ? { by: opts["by"] } : {})
    }),
  (c) =>
    c
      .argument("[change]", "change the proposed waiver applies to")
      .argument("[gate]", "waivable gate the proposed waiver applies to")
      .option("--reason <text>", "why the gate cannot be satisfied")
      .option("--risk <LOW|MEDIUM|HIGH>", "risk accepted by the waiver")
      .option("--control <text>", "a compensating control (repeatable, at least one)", collect, [])
      .option("--owner <human:login>", "the person accountable for the accepted risk")
      .option("--expires <YYYY-MM-DD>", "last day of the waiver (not before today, UTC)")
      .option("--activate <WAV>", "PROPOSED -> ACTIVE; needs --by of a maintainer")
      .option("--revoke <WAV>", "PROPOSED or ACTIVE -> REVOKED; needs --by of a maintainer")
      .option("--by <login>", "the maintainer activating or revoking the waiver")
);
register(
  "status",
  "show change status",
  (ctx, args) => runStatus(ctx, args[0] as string | undefined),
  (c) => c.argument("[change]")
);
register(
  "check",
  "run checks of a change and record evidence",
  (ctx, args, opts) =>
    runCheck(ctx, args[0] as string, args.slice(1), {
      ...(typeof opts["paths"] === "string" ? { paths: opts["paths"] } : {}),
      ...(typeof opts["base"] === "string" ? { base: opts["base"] } : {})
    }),
  (c) =>
    c
      .argument("<change>")
      .argument("[ids...]")
      .option("--paths <a,b>", "run run.scoped_command over these comma-separated paths")
      .option("--base <ref>", "base commit of the evidence (default: merge-base of HEAD and main)")
);

register(
  "gate",
  "evaluate the gates of a transition and the controller",
  (ctx, args, opts) =>
    runGate(ctx, args[0] as string, args.slice(1), {
      ...(typeof opts["transition"] === "string" ? { transition: opts["transition"] } : {}),
      ...(typeof opts["base"] === "string" ? { base: opts["base"] } : {})
    }),
  (c) =>
    c
      .argument("<change>")
      .argument("[ids...]")
      .option("--transition <FROM->TO>", "transition to evaluate (default: the next forward one)")
      .option("--base <ref>", "base commit of the diff (default: merge-base of HEAD and main)")
);
register(
  "verify",
  "run the checks of a transition, then its gates and the controller",
  (ctx, args, opts) =>
    runVerify(ctx, args[0] as string, {
      ...(typeof opts["transition"] === "string" ? { transition: opts["transition"] } : {}),
      ...(typeof opts["base"] === "string" ? { base: opts["base"] } : {}),
      ...(typeof opts["paths"] === "string" ? { paths: opts["paths"] } : {})
    }),
  (c) =>
    c
      .argument("<change>")
      .option("--transition <FROM->TO>", "transition to verify (default: the next forward one)")
      .option("--base <ref>", "base commit of the evidence and the diff (default: merge-base of HEAD and main)")
      .option("--paths <a,b>", "run run.scoped_command of the checks over these comma-separated paths")
);

register(
  "transition",
  "record a transition of a change, if 04 section 2 and its gates allow it",
  (ctx, args, opts) =>
    runTransition(ctx, args[0] as string, args[1] as string, {
      ...(typeof opts["ref"] === "string" ? { ref: opts["ref"] } : {}),
      ...(typeof opts["by"] === "string" ? { by: opts["by"] } : {}),
      ...(typeof opts["commit"] === "string" ? { commit: opts["commit"] } : {})
    }),
  (c) =>
    c
      .argument("<change>")
      .argument("<state>")
      .option("--ref <url>", "URL of the act on the forge (review, CI run); required for APPROVED and MERGED")
      .option("--by <login>", "the approving human, when the transition has gate human-approval")
      .option("--commit <sha>", "MERGED: the commit of the evidence (default: that of the freshest record)")
);
register(
  "archive",
  "validate, gate and archive a MERGED change, then record ARCHIVED",
  (ctx, args) => runArchive(ctx, args[0] as string),
  (c) => c.argument("<change>")
);

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (thrown) {
    if (thrown instanceof CommanderError) {
      // --version and --help exit through here with code 0; their text already went to stderr.
      // Same path as every command (design D-15): write, then set the code.
      if (thrown.exitCode === 0) {
        if (thrown.code === "commander.version") await writeStdout(CLI_VERSION + "\n");
        process.exitCode = EXIT.OK;
        return;
      }
      const command = process.argv[2] ?? "";
      await emitToProcess(command, failure(new WarrantError("USAGE", thrown.message.trim())));
      return;
    }
    await emitToProcess(process.argv[2] ?? "", resultFromThrown(thrown));
  }
}

void main();
