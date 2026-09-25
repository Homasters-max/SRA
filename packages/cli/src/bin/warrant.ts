#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { CheckRunner } from "../adapters/check-runner.js";
import { GitCli } from "../adapters/git-cli.js";
import { OpenSpecCli } from "../adapters/openspec-cli.js";
import { processSignals } from "../adapters/signals.js";
import type { Ctx } from "../core/ctx.js";
import { EXIT, WarrantError } from "../core/errors.js";
import { systemClock } from "../core/ports/clock.js";
import { createWrites } from "../core/writes.js";
import { emitNative, emitToProcess, failure, resultFromThrown, writeStdout, type CommandResult } from "../io/output.js";
import { CLI_VERSION } from "../version.js";
import { projectRoot, requireConfigPath } from "../commands/context.js";
import { initFrontends, runInitCommand } from "../commands/init.js";
import { runValidate } from "../commands/validate.js";
import { runFmt } from "../commands/fmt.js";
import { runId } from "../commands/id.js";
import { runSync } from "../commands/sync.js";
import { runResolve } from "../commands/resolve.js";
import { runStatus } from "../commands/status.js";
import { runClassify } from "../commands/classify.js";
import { runCheck } from "../commands/check.js";
import { runGate } from "../commands/gate.js";
import { runAnalyze } from "../commands/analyze.js";
import { runVerify } from "../commands/verify.js";
import { runTransition } from "../commands/transition.js";
import { runArchive } from "../commands/archive.js";
import { runLink } from "../commands/link.js";
import { runWaive } from "../commands/waive.js";
import { runFinish, runStart } from "../commands/run.js";
import { runGuard, runGuardFrontend } from "../commands/guard.js";
import { readStdin } from "../io/stdin.js";
import { UNREADABLE_EXIT, type FrontendAdapter } from "../core/ports/frontend.js";
import { claudeFrontend } from "../adapters/frontend/claude.js";

/** Adapters of `warrant guard --frontend <name>` (REQ-ENF-005): the one place of `bin` that names a frontend (design §9). */
const FRONTENDS: readonly FrontendAdapter[] = [claudeFrontend];

export type Runner = (ctx: Ctx, args: string[], opts: Record<string, unknown>) => Promise<CommandResult> | CommandResult;

/**
 * The production `ctx` (ADR-0025 п. 2): the adapters over `openspec`, `git` and
 * the check runner, rooted at the cwd; `--dry-run` makes `writes` collect instead of write.
 */
function productionCtx(dryRun: boolean): Ctx {
  const root = projectRoot();
  return {
    root,
    openspec: new OpenSpecCli(root),
    git: new GitCli(root),
    checks: new CheckRunner(),
    clock: systemClock,
    signals: processSignals,
    writes: createWrites(dryRun),
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
    result = await runner(productionCtx(opts["dryRun"] === true), args, opts);
  } catch (thrown) {
    result = resultFromThrown(thrown);
  }
  // No `process.exit`: the exit code is set after stdout accepted the whole
  // envelope, and Node ends the process once the pipe has drained (B4).
  await emitToProcess(name, result);
}

/** `--dry-run` of the commands that change state (REQ-KRN-034). */
const DRY_RUN = "run every check and print the same JSON with data.dry_run and data.would_write[]; write nothing";

/** The `Examples:` section of `--help` (lens `cli-contract`): one command per line. */
function examples(lines: string[]): string {
  return `\nExamples:\n${lines.map((line) => `  $ ${line}\n`).join("")}`;
}

/** Commander collector of a repeatable option. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** A command of `program`, or a subcommand of `parent` named `<parent> <name>` in the envelope (`run start`). */
function register(
  name: string,
  description: string,
  runner: Runner,
  configure?: (cmd: Command) => void,
  parent: Command = program
): void {
  const cmd = parent.command(name).description(description);
  configure?.(cmd);
  const envelopeName = parent === program ? name : `${parent.name()} ${name}`;
  cmd.action(async (...actionArgs: unknown[]) => {
    const command = actionArgs[actionArgs.length - 1] as Command;
    await run(envelopeName, runner, command.args, command.opts());
  });
}

register(
  "init",
  "initialise .warrant/ or a new change",
  // `init` is the one command that must run without an existing config;
  // `init change` checks for one itself.
  (ctx, args, opts) =>
    runInitCommand(ctx, args, {
      force: opts["force"] as boolean | undefined,
      frontend: opts["frontend"] as string | undefined
    }),
  (c) =>
    c
      .argument("[what]")
      .argument("[name]")
      .option("--force", "rewrite the files init owns")
      .option(
        "--frontend <name>",
        `record frontends: [<name>] in the new warrant.json, so sync generates its files (one of: ${initFrontends().join(", ")})`
      )
      .addHelpText(
        "after",
        examples([
          "warrant init",
          ...initFrontends().map((name) => `warrant init --frontend ${name}`),
          "warrant init change add-search"
        ])
      )
);
register(
  "validate",
  "validate configuration, packs, schemas, ids and generated files",
  (ctx, _args, opts) => {
    // CONFIG_MISSING first, exactly as for the other config-bound commands (SCN-KRN-007).
    requireConfigPath(ctx.root);
    return runValidate(ctx, { ...(typeof opts["files"] === "string" ? { files: opts["files"] } : {}) });
  },
  (c) =>
    c
      .option(
        "--files <a,b>",
        "only the checks of one file over these comma-separated paths (no lock, hash, generated files or openspec)"
      )
      .addHelpText(
        "after",
        examples(["warrant validate", "warrant validate --files .warrant/local/areas.json,openspec/specs/search/spec.md"])
      )
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
      .option("--activate <WAV>", "PROPOSED -> ACTIVE; needs --by of a maintainer (a human act)")
      .option("--revoke <WAV>", "PROPOSED or ACTIVE -> REVOKED; needs --by of a maintainer (a human act)")
      .option("--by <login>", "the maintainer activating or revoking the waiver (a human)")
      .option("--dry-run", DRY_RUN)
      .addHelpText(
        "after",
        examples([
          'warrant waive add-search spec-approved --reason "clarified in I-12" --risk LOW --control "review of the spec diff" --owner human:kat --expires 2026-12-31 --dry-run',
          "warrant waive --activate WAV-2026-001 --by kat"
        ])
      )
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
  "analyze",
  "check delta specs, tasks.md and tests of a change against each other by ids (UNSATISFIED, CONFLICT, ORPHAN); writes nothing",
  (ctx, args, opts) => runAnalyze(ctx, args[0] as string, typeof opts["base"] === "string" ? { base: opts["base"] } : {}),
  (c) =>
    c
      .argument("<change>")
      .option("--base <ref>", "base commit of the diff whose test files ORPHAN reads (default: merge-base of HEAD and main)")
      .addHelpText("after", examples(["warrant analyze add-search", "warrant analyze add-search --base origin/main"]))
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
      .option("--by <login>", "the approving human, when the transition has gate human-approval (a human act)")
      .option("--commit <sha>", "MERGED: the commit of the evidence (default: that of the freshest record)")
      .option("--dry-run", DRY_RUN)
      .addHelpText(
        "after",
        examples([
          "warrant transition add-search SPECIFIED --dry-run",
          "warrant transition add-search APPROVED --ref https://github.com/o/r/pull/7 --by kat"
        ])
      )
);
register(
  "archive",
  "validate, gate and archive a MERGED change, then record ARCHIVED",
  (ctx, args) => runArchive(ctx, args[0] as string),
  (c) =>
    c
      .argument("<change>")
      .option("--dry-run", `${DRY_RUN}; openspec archive is not called`)
      .addHelpText("after", examples(["warrant archive add-search --dry-run", "warrant archive add-search"]))
);

const runGroup = program
  .command("run")
  .description("start or finish a Run: one attempt of an agent at an operation of a change (write_scope, Context Pack)");
register(
  "start",
  "create a RUNNING Run of a change and print its Context Pack; one active Run per worktree",
  (ctx, args, opts) =>
    runStart(ctx, args[0], {
      ...(typeof opts["operation"] === "string" ? { operation: opts["operation"] } : {}),
      ...(typeof opts["scope"] === "string" ? { scope: opts["scope"] } : {}),
      ...(typeof opts["task"] === "string" ? { task: opts["task"] } : {})
    }),
  (c) =>
    c
      .argument("[change]", "the change the Run works on")
      .option("--operation <specify|implement>", "specify: the artifacts of a PROPOSED change; implement: paths.src, paths.tests and tasks.md of an IMPLEMENTING one")
      .option("--scope <globs>", "comma-separated globs that narrow write_scope: a path must match both")
      .option("--task <label>", "label of the task, kept in the Run unchecked")
      .option("--dry-run", DRY_RUN)
      .addHelpText(
        "after",
        examples([
          "warrant run start add-search --operation specify --dry-run",
          "warrant run start add-search --operation implement --scope src/search/** --task 2.1"
        ])
      ),
  runGroup
);
register(
  "finish",
  "end the active Run with a state and remove <state>/runs/current",
  (ctx, _args, opts) => runFinish(ctx, { ...(typeof opts["state"] === "string" ? { state: opts["state"] } : {}) }),
  (c) =>
    c
      .option("--state <SUCCEEDED|FAILED|CANCELLED>", "the state the Run ends in (default: SUCCEEDED)")
      .option("--dry-run", DRY_RUN)
      .addHelpText("after", examples(["warrant run finish --dry-run", "warrant run finish --state FAILED"])),
  runGroup
);

/**
 * `warrant guard --frontend <name>` (REQ-ENF-005): the native answer of the
 * adapter instead of the envelope; an unknown name is `USAGE` (exit 3) naming
 * the known ones, before stdin is read. What throws past guard is a failure of
 * the hook: the reason on stderr, the exit of an input that does not read.
 */
async function guardFrontend(name: string): Promise<void> {
  const adapter = FRONTENDS.find((a) => a.name === name);
  if (adapter === undefined) {
    const known = FRONTENDS.map((a) => `--frontend ${a.name}`).join(", ");
    await emitToProcess("guard", failure(new WarrantError("USAGE", `unknown frontend ${JSON.stringify(name)}`, { hint: `pass one of: ${known}` })));
    return;
  }
  try {
    await emitNative(await runGuardFrontend(productionCtx(false), adapter, await readStdin()));
  } catch (thrown) {
    process.stderr.write(`warrant guard --frontend ${adapter.name}: ${thrown instanceof Error ? thrown.message : String(thrown)}\n`);
    process.exitCode = UNREADABLE_EXIT;
  }
}

// Not `register`: with `--frontend` the answer is the adapter's, not the envelope.
program
  .command("guard")
  .description("decide on one action of an agent: a normalised event on stdin, data{decision, reason?, hints[]} on stdout, exit 0")
  .option(
    "--frontend <name>",
    `read the native hook input of the agent and print its native answer instead of the envelope (one of: ${FRONTENDS.map((a) => a.name).join(", ")})`
  )
  .addHelpText(
    "after",
    '\nstdin: {"phase": "pre"|"post", "action": "edit"|"shell"|"other", "paths": [...], "argv"?: [...], "cwd": "<dir>"}\n' +
      `stdin with --frontend <name>: the hook input of that agent; one that does not read — exit ${UNREADABLE_EXIT}, the reason on stderr\n` +
      examples([
        `echo '{"phase":"pre","action":"edit","paths":["src/app.py"],"cwd":"."}' | warrant guard`,
        `echo '{"phase":"pre","action":"shell","paths":[],"argv":["pytest","tests/"],"cwd":"."}' | warrant guard`,
        ...FRONTENDS.map((a) => `warrant guard --frontend ${a.name} < hook-input.json`)
      ])
  )
  .action(async (opts: Record<string, unknown>) => {
    if (typeof opts["frontend"] === "string") return guardFrontend(opts["frontend"]);
    await run("guard", async (ctx) => runGuard(ctx, await readStdin()), [], opts);
  });

/** `hint` of a usage error Commander reports, for the commands born with hints (REQ-KRN-002). */
function usageHint(command: string): string | undefined {
  if (command === "run") return "see `warrant run start --help` or `warrant run finish --help`";
  return command === "guard" ? "see `warrant guard --help`" : undefined;
}

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
      const hint = usageHint(command);
      await emitToProcess(command, failure(new WarrantError("USAGE", thrown.message.trim(), hint === undefined ? {} : { hint })));
      return;
    }
    await emitToProcess(process.argv[2] ?? "", resultFromThrown(thrown));
  }
}

void main();
