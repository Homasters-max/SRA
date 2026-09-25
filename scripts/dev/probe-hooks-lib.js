/**
 * Probe of the hooks of Claude Code (ADR-0034 п. 2, design phase-4a §7, task 8.2) — pure logic of probe-hooks.js:
 * the probe project (a recording hook `PreToolUse` / `PostToolUse` on `Edit|Write|NotebookEdit|Bash`, test entries of
 * `permissions.deny`, a notebook), the scenario the maintainer gives the model, the fixtures of the adapter contract
 * picked from the records, and the answers to three questions the documentation does not settle:
 *
 *   Q1 does `additionalContext` of `PreToolUse` on allow (no `permissionDecision`) reach the model;
 *   Q2 how Claude Code anchors the paths of `permissions.deny` (`Edit(/…)` — from the project root?);
 *   Q3 does a path entry `Write(/…)` act, or is it ignored (Edit(…) covers Write and NotebookEdit, I-162).
 *
 * Q1: the recorder answers the `Bash` call of `echo probe-context` with a code word in `additionalContext` of
 * `PreToolUse` and another in `PostToolUse` (the latter is known to reach the model, graft-audit §4); the model is
 * asked to quote the words it received. Q2, Q3: the model tries to create each file of `DENY_TARGETS` once with Write;
 * a file that exists after the scenario was not denied.
 */

/** Matcher of both recording hooks: the tools the adapter `claude` translates (F19). */
export const MATCHER = "Edit|Write|NotebookEdit|Bash";

/** A `Bash` command with this word gets the code words of Q1. */
export const CONTEXT_TRIGGER = "probe-context";

/** Test entries of `permissions.deny` of the probe project (Q2, Q3). */
export const DENY_RULES = ["Edit(/probe-deny/anchored/**)", "Edit(probe-deny/relative/**)", "Write(/probe-deny/write-rule/**)"];

/** Files the model tries to create with Write, and what each one's fate tells. */
export const DENY_TARGETS = [
  { path: "probe-deny/anchored/a.txt", rule: "Edit(/probe-deny/anchored/**)", question: "Q2" },
  { path: "sub/probe-deny/anchored/a.txt", rule: "Edit(/probe-deny/anchored/**)", question: "Q2" },
  { path: ".claude/probe-deny/anchored/a.txt", rule: "Edit(/probe-deny/anchored/**)", question: "Q2" },
  { path: "probe-deny/relative/a.txt", rule: "Edit(probe-deny/relative/**)", question: "Q2" },
  { path: "sub/probe-deny/relative/a.txt", rule: "Edit(probe-deny/relative/**)", question: "Q2" },
  { path: "probe-deny/write-rule/a.txt", rule: "Write(/probe-deny/write-rule/**)", question: "Q3" }
];

/** The fixtures of the contract: file name → the hook event and the tool call of the scenario it records. */
export const FIXTURES = [
  { file: "pre-edit.json", event: "PreToolUse", tool: "Edit" },
  { file: "post-edit.json", event: "PostToolUse", tool: "Edit" },
  { file: "pre-write.json", event: "PreToolUse", tool: "Write" },
  { file: "post-write.json", event: "PostToolUse", tool: "Write" },
  { file: "pre-notebook-edit.json", event: "PreToolUse", tool: "NotebookEdit" },
  { file: "post-notebook-edit.json", event: "PostToolUse", tool: "NotebookEdit" },
  { file: "pre-bash.json", event: "PreToolUse", tool: "Bash" },
  { file: "post-bash.json", event: "PostToolUse", tool: "Bash" }
];

/** The tool calls of the scenario the fixtures come from (not those of Q1–Q3). */
export const NOTES_FILE = "notes/a.txt";
export const NOTEBOOK_FILE = "nb.ipynb";
export const BASH_COMMAND = "echo probe-bash";

/** Where the probe keeps its files inside the probe project. */
export const PROBE_DIR = ".probe";

/** `x.y.z` of `claude --version` (`2.1.263 (Claude Code)`), or undefined. */
export function parseVersion(text) {
  const match = /\b(\d+\.\d+\.\d+)\b/.exec(String(text));
  return match ? match[1] : undefined;
}

/** The probe: the code words of Q1, fresh per setup so that an old session cannot answer. */
export function newProbe(random) {
  const word = () => `${random().toString(36).slice(2, 8)}`;
  return { trigger: CONTEXT_TRIGGER, preWord: `pre-${word()}`, postWord: `post-${word()}` };
}

/** `.claude/settings.json` of the probe project: the recorder on both events, the deny entries, `echo` allowed. */
export function probeSettings(recorderPath) {
  const group = { matcher: MATCHER, hooks: [{ type: "command", command: `node "${recorderPath}"` }] };
  return {
    permissions: { allow: ["Bash(echo:*)"], deny: [...DENY_RULES] },
    hooks: { PreToolUse: [group], PostToolUse: [structuredClone(group)] }
  };
}

/** A notebook with one code cell for the NotebookEdit call. */
export function notebook() {
  return {
    cells: [{ cell_type: "code", execution_count: null, id: "cell-1", metadata: {}, outputs: [], source: ["print(1)"] }],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5
  };
}

/**
 * What the recorder does with one hook input: the record file name (sortable: time, a sequence, event, tool, `ctx`
 * when it answered with a code word) and its stdout. Self-contained — its source is copied into the recorder.
 */
export function recordHook(input, probe, stamp) {
  let json;
  try {
    json = JSON.parse(input);
  } catch {
    json = undefined;
  }
  const object = json !== null && typeof json === "object" && !Array.isArray(json) ? json : {};
  const safe = (value) => (typeof value === "string" && /^[A-Za-z]+$/.test(value) ? value : "unknown");
  const event = safe(object.hook_event_name);
  const tool = safe(object.tool_name);
  const toolInput = object.tool_input !== null && typeof object.tool_input === "object" ? object.tool_input : {};
  const command = toolInput.command;
  const answers = tool === "Bash" && typeof command === "string" && command.includes(probe.trigger);
  const name = `${stamp}-${event}-${tool}${answers ? "-ctx" : ""}.json`;
  if (!answers) return { name, stdout: "" };
  const word = event === "PreToolUse" ? probe.preWord : probe.postWord;
  const output = { hookSpecificOutput: { hookEventName: event, additionalContext: `probe-hooks code word: ${word}` } };
  return { name, stdout: JSON.stringify(output) };
}

/** Source of `.probe/recorder.mjs`: stdin of the hook to `.probe/records/<name>`, the answer of `recordHook` to stdout. */
export function recorderSource(probe) {
  return [
    "// Recorder of scripts/dev/probe-hooks.js (task 8.2): writes the stdin of each hook to records/.",
    'import { mkdirSync, writeFileSync } from "node:fs";',
    'import path from "node:path";',
    'import { fileURLToPath } from "node:url";',
    "",
    `const probe = ${JSON.stringify(probe)};`,
    `const recordHook = ${recordHook.toString()};`,
    "",
    "const dir = path.dirname(fileURLToPath(import.meta.url));",
    'let input = "";',
    'process.stdin.setEncoding("utf8");',
    "for await (const chunk of process.stdin) input += chunk;",
    'const stamp = `${String(Date.now()).padStart(15, "0")}-${String(process.hrtime.bigint()).padStart(20, "0")}`;',
    "const { name, stdout } = recordHook(input, probe, stamp);",
    'mkdirSync(path.join(dir, "records"), { recursive: true });',
    'writeFileSync(path.join(dir, "records", name), input);',
    "if (stdout) process.stdout.write(stdout);",
    ""
  ].join("\n");
}

/** The prompt the maintainer pastes into Claude Code in the probe project. */
export function scenarioPrompt() {
  const targets = DENY_TARGETS.map((t) => `   - ${t.path}`).join("\n");
  return [
    "This is a probe of hooks. Do exactly these steps, one tool call each, in order; do not retry or work around a refusal:",
    `1. Use the Write tool to create ${NOTES_FILE} with the content: one`,
    `2. Use the Edit tool to replace "one" with "two" in ${NOTES_FILE}.`,
    `3. Use the NotebookEdit tool to replace the source of the first cell of ${NOTEBOOK_FILE} with: print(2)`,
    `4. Run the Bash command: ${BASH_COMMAND}`,
    `5. Run the Bash command: echo ${CONTEXT_TRIGGER}`,
    "   Then quote verbatim every line \"probe-hooks code word: …\" you received from hooks around that call (in system",
    "   reminders or hook context), and say for each whether it came before the command ran or after; if you received",
    "   none, say so.",
    "6. For each path below, try once to create it with the Write tool with the content: x",
    targets,
    "   Then list which of them were refused and quote each refusal message.",
    "7. Stop."
  ].join("\n");
}

/** Records `[{ name, text }]` parsed; a record that is not JSON is dropped. */
function parsed(records) {
  const out = [];
  for (const { name, text } of [...records].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    try {
      out.push({ name, json: JSON.parse(text) });
    } catch {
      // a hook input that is not JSON is not a fixture
    }
  }
  return out;
}

const slash = (p) => String(p).replace(/\\/g, "/");

/** True when the tool call of `json` is the one of the scenario the fixture of its tool records. */
function scenarioCall(json) {
  const input = json.tool_input ?? {};
  switch (json.tool_name) {
    case "Edit":
    case "Write":
      return slash(input.file_path).endsWith(NOTES_FILE);
    case "NotebookEdit":
      return slash(input.notebook_path).endsWith(NOTEBOOK_FILE);
    case "Bash":
      return input.command === BASH_COMMAND;
    default:
      return false;
  }
}

/** `transcript_path` with the home directory as `~`: the fixture keeps the shape, not the profile path. */
function redacted(json, home) {
  const out = { ...json };
  if (typeof out.transcript_path === "string" && home) {
    const at = slash(out.transcript_path).toLowerCase().indexOf(slash(home).toLowerCase());
    if (at === 0) out.transcript_path = `~${out.transcript_path.slice(home.length)}`;
  }
  return out;
}

/**
 * The fixtures of the contract from the records: for each of `FIXTURES` the first record of its event and tool from
 * the scenario call; `missing` names those the records lack.
 */
export function pickFixtures(records, home) {
  const all = parsed(records);
  const fixtures = [];
  const missing = [];
  for (const f of FIXTURES) {
    const hit = all.find(({ json }) => json.hook_event_name === f.event && json.tool_name === f.tool && scenarioCall(json));
    if (hit) fixtures.push({ file: f.file, text: `${JSON.stringify(redacted(hit.json, home), null, 2)}\n` });
    else missing.push(f.file);
  }
  return { fixtures, missing };
}

/** The Write calls of the records on a project path (`cwd`-relative or absolute), by event. */
function writesOf(all, target) {
  const seen = { pre: false, post: false };
  for (const { json } of all) {
    if (json.tool_name !== "Write") continue;
    const file = slash(json.tool_input?.file_path ?? "");
    const root = slash(json.cwd ?? "").replace(/\/$/, "");
    if (file !== target && file !== `${root}/${target}`) continue;
    if (json.hook_event_name === "PreToolUse") seen.pre = true;
    if (json.hook_event_name === "PostToolUse") seen.post = true;
  }
  return seen;
}

/**
 * The answers the records and the probe project give: Q1 — whether the recorder sent each code word (the model's
 * quote says whether it arrived); Q2, Q3 — per target whether the hooks saw the Write (a call denied by
 * `permissions.deny` may never reach them) and whether the file exists: `written` or `not written` (refused — or not
 * tried, which the model's answer to step 6 rules out).
 */
export function probeAnswers(records, exists, probe) {
  const all = parsed(records);
  const sent = (event) => records.some((r) => r.name.endsWith(`-${event}-Bash-ctx.json`));
  const targets = DENY_TARGETS.map((t) => {
    const seen = writesOf(all, t.path);
    const created = exists(t.path);
    return { ...t, pre: seen.pre, post: seen.post, exists: created, verdict: created ? "written" : "not written" };
  });
  return { q1: { preSent: sent("PreToolUse"), postSent: sent("PostToolUse"), preWord: probe.preWord, postWord: probe.postWord }, targets };
}

/** True when the target at `path` was denied (its file was not written). */
const denied = (answers, path) => answers.targets.find((t) => t.path === path)?.verdict === "not written";

/** What Q2 and Q3 are, read off the verdicts (all targets tried — step 6 of the scenario). */
export function readings(answers) {
  const anchored = denied(answers, "probe-deny/anchored/a.txt");
  const anchoredSub = denied(answers, "sub/probe-deny/anchored/a.txt");
  const anchoredSettings = denied(answers, ".claude/probe-deny/anchored/a.txt");
  const relative = denied(answers, "probe-deny/relative/a.txt");
  const relativeSub = denied(answers, "sub/probe-deny/relative/a.txt");
  let q2Anchor;
  if (anchored && !anchoredSub) q2Anchor = "Edit(/…) is anchored at the project root (the directory claude started in)";
  else if (anchored && anchoredSub) q2Anchor = "Edit(/…) matches at any depth — not anchored";
  else if (anchoredSettings) q2Anchor = "Edit(/…) is anchored at the directory of the settings file (.claude/)";
  else q2Anchor = "Edit(/…) denied none of the targets — anchored elsewhere (the filesystem root?) or ignored";
  let q2Relative;
  if (relative && relativeSub) q2Relative = "Edit(path) without / matches at any depth";
  else if (relative) q2Relative = "Edit(path) without / is relative to the project root, not at any depth";
  else q2Relative = "Edit(path) without / denied none of the targets";
  const q3 = denied(answers, "probe-deny/write-rule/a.txt")
    ? "Write(/…) acts: the Write was denied"
    : "Write(/…) does not act: the file was written";
  return { q2Anchor, q2Relative, q3 };
}

/** The report `collect` prints. */
export function formatReport({ version, fixtureDir, written, missing, answers }) {
  const lines = [`Claude Code ${version}`];
  if (written.length > 0) lines.push(`fixtures → ${fixtureDir}: ${written.join(", ")}`);
  if (missing.length > 0) lines.push(`missing records (scenario steps 1–4 not done?): ${missing.join(", ")}`);
  const { q1 } = answers;
  lines.push(
    "",
    "Q1 additionalContext of PreToolUse on allow reaches the model?",
    `   recorder sent PreToolUse word ${q1.preWord}: ${q1.preSent ? "yes" : "no (step 5 not done?)"}`,
    `   recorder sent PostToolUse word ${q1.postWord}: ${q1.postSent ? "yes" : "no (step 5 not done?)"}`,
    `   → the model quoted ${q1.preWord}: yes — it reaches; no (only ${q1.postWord}) — it does not: hints of pre go to post (design §7)`,
    "",
    "Q2 / Q3 Write of each target (valid when the model tried all six in step 6): hooks saw pre / post → verdict"
  );
  for (const t of answers.targets) {
    lines.push(`   ${t.path.padEnd(36)} ${t.rule.padEnd(34)} pre ${t.pre ? "yes" : "no "} post ${t.post ? "yes" : "no "} → ${t.verdict}`);
  }
  const r = readings(answers);
  lines.push(
    `   Q2 anchor:   ${r.q2Anchor}`,
    `   Q2 relative: ${r.q2Relative}`,
    `   Q3:          ${r.q3} (and note any warning Claude Code showed about Write(…) at start or in /permissions)`,
    "   pre yes on a denied target: PreToolUse runs before permissions.deny; pre no: the deny acts before the hooks"
  );
  return `${lines.join("\n")}\n`;
}
