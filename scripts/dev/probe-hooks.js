/**
 * Probe of the hooks of Claude Code (ADR-0034 п. 2, design phase-4a §7, task 8.2; phase-4b task 6.2): records the
 * native stdin of the hooks `PreToolUse` / `PostToolUse` for the contract of the adapter `claude` and answers Q1–Q3
 * and, for the hook in the frontmatter of a subagent, A1–A3 of probe-hooks-lib.js.
 * Run it again whenever Claude Code is updated; it never starts `claude` itself except for `claude --version`.
 *
 *   node scripts/dev/probe-hooks.js setup [--dir <path>]
 *       a probe project (a new temp directory, or <path> — absent or without .claude/settings.json): the recorder
 *       .probe/recorder.mjs as hook on Edit|Write|NotebookEdit|Bash, test entries of permissions.deny, nb.ipynb,
 *       the subagent .claude/agents/probe-agent.md with the recorder as its own PreToolUse hook on Bash;
 *       prints what to run and the prompt to paste into Claude Code
 *   node scripts/dev/probe-hooks.js collect --dir <path> [--version <x.y.z>] [--dry-run]
 *       after the scenario: rewrites packages/cli/test/contract/fixtures/claude/<version>/*.json (pre and post of
 *       Edit, Write, NotebookEdit, Bash; agent-*.json — the subagent's Bash, those recorded), prints the version
 *       (`claude --version` unless --version) and the answers
 *
 * Logic — probe-hooks-lib.js (pure). Exit 0 — done; 1 — records of the scenario missing, nothing written; 2 — usage
 * or IO failure.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT_FILE,
  AGENT_FIXTURES,
  AGENT_NAME,
  agentAnswers,
  agentFile,
  FIXTURES,
  formatReport,
  newProbe,
  NOTEBOOK_FILE,
  notebook,
  parseVersion,
  pickAgentFixtures,
  pickFixtures,
  PROBE_DIR,
  probeAnswers,
  probeSettings,
  recorderSource,
  scenarioPrompt
} from "./probe-hooks-lib.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const USAGE = "usage: node scripts/dev/probe-hooks.js setup [--dir <path>] | collect --dir <path> [--version <x.y.z>] [--dry-run]";

function fail(message, code = 2) {
  console.error(`probe-hooks: ${message}`);
  process.exit(code);
}

function option(args, name) {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) fail(`${name} needs a value\n${USAGE}`);
  return value;
}

const slash = (p) => p.split(path.sep).join("/");

function setup(args) {
  const given = option(args, "--dir");
  const root = given === undefined ? mkdtempSync(path.join(os.tmpdir(), "warrant-probe-")) : path.resolve(given);
  if (existsSync(path.join(root, ".claude", "settings.json"))) fail(`${root} already has .claude/settings.json — pass an empty --dir`);
  const probeDir = path.join(root, PROBE_DIR);
  rmSync(probeDir, { recursive: true, force: true });
  mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });
  mkdirSync(probeDir, { recursive: true });

  const probe = newProbe(Math.random);
  const recorder = path.join(probeDir, "recorder.mjs");
  writeFileSync(path.join(probeDir, "probe.json"), `${JSON.stringify(probe, null, 2)}\n`);
  writeFileSync(recorder, recorderSource(probe));
  writeFileSync(path.join(root, ".claude", "settings.json"), `${JSON.stringify(probeSettings(slash(recorder)), null, 2)}\n`);
  writeFileSync(path.join(root, NOTEBOOK_FILE), `${JSON.stringify(notebook(), null, 1)}\n`);
  writeFileSync(path.join(root, ...AGENT_FILE.split("/")), agentFile(slash(recorder)));

  process.stdout.write(
    [
      `probe project: ${slash(root)}`,
      "",
      "1. In a terminal, start Claude Code there (edits accepted without asking, permissions.deny still acts):",
      `     cd "${slash(root)}" && claude --permission-mode acceptEdits`,
      "   Trust the folder if asked. Note any warning shown at start about the permission rules (Write(…)); run",
      `   /permissions and note whether it marks any rule; run /agents and note whether ${AGENT_NAME} is listed.`,
      "2. Paste this prompt and let the model finish; approve a prompt if one appears:",
      "",
      scenarioPrompt(),
      "",
      "3. Keep the model's answer (steps 5, 6 and 7), leave Claude Code, then:",
      `     node scripts/dev/probe-hooks.js collect --dir "${slash(root)}"`,
      ""
    ].join("\n")
  );
}

function claudeVersion() {
  const run = spawnSync("claude", ["--version"], { encoding: "utf8", windowsHide: true, shell: process.platform === "win32" });
  const version = run.status === 0 ? parseVersion(run.stdout) : undefined;
  if (version === undefined) fail("`claude --version` gave no version — pass --version <x.y.z>");
  return version;
}

function collect(args) {
  const given = option(args, "--dir");
  if (given === undefined) fail(`collect needs --dir\n${USAGE}`);
  const root = path.resolve(given);
  const probeDir = path.join(root, PROBE_DIR);
  if (!existsSync(path.join(probeDir, "probe.json"))) fail(`${root} is not a probe project (run setup first)`);
  const probe = JSON.parse(readFileSync(path.join(probeDir, "probe.json"), "utf8"));
  const recordsDir = path.join(probeDir, "records");
  const records = existsSync(recordsDir)
    ? readdirSync(recordsDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => ({ name, text: readFileSync(path.join(recordsDir, name), "utf8") }))
    : [];

  const flagged = option(args, "--version");
  const version = flagged === undefined ? claudeVersion() : parseVersion(flagged);
  if (version === undefined) fail(`--version ${flagged} is not x.y.z`);
  const fixtureDir = path.join(REPO_ROOT, "packages", "cli", "test", "contract", "fixtures", "claude", version);
  const { fixtures, missing } = pickFixtures(records, os.homedir());
  const exists = (rel) => existsSync(path.join(root, ...rel.split("/")));
  const answers = probeAnswers(records, exists, probe);
  const agent = pickAgentFixtures(records, os.homedir());

  const dryRun = args.includes("--dry-run");
  const write = missing.length === 0 && !dryRun;
  if (write) {
    mkdirSync(fixtureDir, { recursive: true });
    for (const f of [...FIXTURES, ...AGENT_FIXTURES]) rmSync(path.join(fixtureDir, f.file), { force: true });
    for (const f of [...fixtures, ...agent.fixtures]) writeFileSync(path.join(fixtureDir, f.file), f.text);
  }
  process.stdout.write(
    formatReport({
      version,
      fixtureDir: slash(path.relative(REPO_ROOT, fixtureDir)),
      written: write ? [...fixtures, ...agent.fixtures].map((f) => f.file) : [],
      missing,
      answers,
      agent: { absent: agent.absent, answers: agentAnswers(records, exists) },
      denyWord: probe.denyWord
    })
  );
  if (dryRun && missing.length === 0) process.stdout.write(`--dry-run: nothing written (would write ${fixtures.length + agent.fixtures.length} fixtures)\n`);
  if (missing.length > 0) process.exit(1);
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "setup") setup(args);
  else if (command === "collect") collect(args);
  else fail(USAGE);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
