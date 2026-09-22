#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { EXIT, WarrantError } from "../core/errors.js";
import { emit, failure, resultFromThrown, type CommandResult } from "../io/output.js";
import { CLI_VERSION } from "../version.js";
import { requireConfigPath } from "../commands/context.js";
import { runInitCommand } from "../commands/init.js";
import { runValidate } from "../commands/validate.js";
import { runFmt } from "../commands/fmt.js";
import { runId } from "../commands/id.js";
import { runSync } from "../commands/sync.js";
import { runResolve } from "../commands/resolve.js";
import { runStatus } from "../commands/status.js";
import { runClassify } from "../commands/classify.js";

export type Runner = (args: string[], opts: Record<string, unknown>) => Promise<CommandResult> | CommandResult;

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

async function run(name: string, runner: Runner, args: string[], opts: Record<string, unknown>): Promise<never> {
  let result: CommandResult;
  try {
    result = await runner(args, opts);
  } catch (thrown) {
    result = resultFromThrown(thrown);
  }
  process.exit(emit(name, result));
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
  (args, opts) => runInitCommand(args, { force: opts["force"] as boolean | undefined }),
  (c) => c.argument("[what]").argument("[name]").option("--force")
);
register(
  "validate",
  "validate configuration, packs, schemas, ids and generated files",
  () => {
    // CONFIG_MISSING first, exactly as for the other config-bound commands (SCN-KRN-007).
    requireConfigPath();
    return runValidate();
  }
);
register(
  "fmt",
  "canonicalise JSON files",
  (args, opts) => runFmt(args, { check: opts["check"] as boolean | undefined }),
  (c) => c.argument("[paths...]").option("--check")
);
register(
  "id",
  "allocate stable ids",
  (args, opts) => runId(args, { ...(typeof opts["change"] === "string" ? { change: opts["change"] as string } : {}) }),
  (c) => c.argument("[args...]").option("--change <name>")
);
register(
  "sync",
  "generate OpenSpec files and lock",
  (_args, opts) => runSync({ check: opts["check"] as boolean | undefined }),
  (c) => c.option("--check")
);
register(
  "resolve",
  "compute effective policy",
  (args, opts) =>
    runResolve(args[0] as string, {
      ...(opts["explain"] === true ? { explain: true } : {}),
      ...(typeof opts["classification"] === "string" ? { classification: opts["classification"] } : {})
    }),
  (c) => c.argument("<change>").option("--explain").option("--classification <file>")
);
register(
  "classify",
  "compute and record the classification of a change",
  (args, opts) =>
    runClassify(args[0] as string, {
      ...(typeof opts["base"] === "string" ? { base: opts["base"] } : {}),
      ...(typeof opts["paths"] === "string" ? { paths: opts["paths"] } : {}),
      ...(typeof opts["propose"] === "string" ? { propose: opts["propose"] } : {})
    }),
  (c) =>
    c
      .argument("<change>")
      .option("--base <ref>", "git ref to diff HEAD against (default: main)")
      .option("--paths <file>", "file with one changed path per line, instead of git")
      .option("--propose <json>", "proposer's profiles and risk values as JSON")
);
register(
  "status",
  "show change status",
  (args) => runStatus(args[0] as string | undefined),
  (c) => c.argument("[change]")
);

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (thrown) {
    if (thrown instanceof CommanderError) {
      // --version and --help exit through here with code 0; their text already went to stderr.
      if (thrown.exitCode === 0) {
        if (thrown.code === "commander.version") process.stdout.write(CLI_VERSION + "\n");
        process.exit(EXIT.OK);
      }
      const command = process.argv[2] ?? "";
      process.exit(emit(command, failure(new WarrantError("USAGE", thrown.message.trim()))));
    }
    process.exit(emit(process.argv[2] ?? "", resultFromThrown(thrown)));
  }
}

void main();
