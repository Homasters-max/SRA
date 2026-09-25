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
 *
 * The subagent (phase-4b task 6.2, ADR-0034 п. 10): `.claude/agents/probe-agent.md` carries its own hook `PreToolUse`
 * on `Bash` in the frontmatter — the recorder with the argument `agent`, which answers `deny` to the marker command.
 * The subagent runs a plain command, a heredoc and the marker; the answers:
 *
 *   A1 is the frontmatter hook called on the subagent's Bash (and does the hook of settings.json see those calls);
 *   A2 does its `deny` reach: the marker command writes a file, so a file left after the scenario means it ran;
 *   A3 how the hook input of a subagent call differs from that of the main session (`agent_id`, `agent_type`, …).
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

/** The probe subagent: its name and file in the probe project. */
export const AGENT_NAME = "probe-agent";
export const AGENT_FILE = `.claude/agents/${AGENT_NAME}.md`;

/** The three Bash calls of the subagent, each found in the records by its word. */
export const AGENT_BASH_WORD = "probe-agent-bash";
export const AGENT_BASH_COMMAND = `echo ${AGENT_BASH_WORD}`;
export const AGENT_HEREDOC_WORD = "probe-agent-heredoc";
export const AGENT_HEREDOC_COMMAND = `cat <<'JSON'\n{"probe": "${AGENT_HEREDOC_WORD}", "text": "it's; a && b | c"}\nJSON`;
export const AGENT_DENY_MARKER = "probe-agent-deny";
/** Written by the marker command: present after the scenario — the command ran, the deny did not act. */
export const AGENT_DENY_FILE = "probe-agent-deny.txt";
export const AGENT_DENY_COMMAND = `echo ${AGENT_DENY_MARKER} > ${AGENT_DENY_FILE}`;

/** Fixtures of the subagent: `PreToolUse` of its Bash calls, from the frontmatter hook (`agent`) or settings.json (`session`). */
export const AGENT_FIXTURES = [
  { file: "agent-pre-bash.json", word: AGENT_BASH_WORD, source: "agent" },
  { file: "agent-pre-bash-heredoc.json", word: AGENT_HEREDOC_WORD, source: "agent" },
  { file: "agent-pre-bash-deny.json", word: AGENT_DENY_MARKER, source: "agent" },
  { file: "agent-session-pre-bash.json", word: AGENT_BASH_WORD, source: "session" }
];

/** `x.y.z` of `claude --version` (`2.1.263 (Claude Code)`), or undefined. */
export function parseVersion(text) {
  const match = /\b(\d+\.\d+\.\d+)\b/.exec(String(text));
  return match ? match[1] : undefined;
}

/** The probe: the code words of Q1 and of the subagent's deny, fresh per setup so that an old session cannot answer. */
export function newProbe(random) {
  const word = () => `${random().toString(36).slice(2, 8)}`;
  return {
    trigger: CONTEXT_TRIGGER,
    preWord: `pre-${word()}`,
    postWord: `post-${word()}`,
    denyMarker: AGENT_DENY_MARKER,
    denyWord: `deny-${word()}`
  };
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
 * What the recorder does with one hook input: the record file name (sortable: time, a sequence, `agent` when the
 * hook of the subagent's frontmatter called it, event, tool, `ctx` / `deny` when it answered) and its stdout: a code
 * word for the trigger of Q1 (hook of settings.json), `deny` for the marker command (hook of the subagent).
 * Self-contained — its source is copied into the recorder.
 */
export function recordHook(input, probe, stamp, source) {
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
  const agent = source === "agent";
  const bash = tool === "Bash" && typeof command === "string";
  const denies = agent && bash && event === "PreToolUse" && typeof probe.denyMarker === "string" && command.includes(probe.denyMarker);
  const answers = !agent && bash && command.includes(probe.trigger);
  const name = `${stamp}${agent ? "-agent" : ""}-${event}-${tool}${answers ? "-ctx" : ""}${denies ? "-deny" : ""}.json`;
  if (denies) {
    const reason = `probe-hooks agent deny: ${probe.denyWord}`;
    return { name, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: "deny", permissionDecisionReason: reason } }) };
  }
  if (!answers) return { name, stdout: "" };
  const word = event === "PreToolUse" ? probe.preWord : probe.postWord;
  const output = { hookSpecificOutput: { hookEventName: event, additionalContext: `probe-hooks code word: ${word}` } };
  return { name, stdout: JSON.stringify(output) };
}

/** Source of `.probe/recorder.mjs`: stdin of the hook to `.probe/records/<name>`, the answer of `recordHook` to stdout. */
export function recorderSource(probe) {
  return [
    "// Recorder of scripts/dev/probe-hooks.js: writes the stdin of each hook to records/; argument `agent` — the subagent's hook.",
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
    "const { name, stdout } = recordHook(input, probe, stamp, process.argv[2]);",
    'mkdirSync(path.join(dir, "records"), { recursive: true });',
    'writeFileSync(path.join(dir, "records", name), input);',
    "if (stdout) process.stdout.write(stdout);",
    ""
  ].join("\n");
}

/**
 * `.claude/agents/probe-agent.md`: read-only tools and Bash, the recorder as `PreToolUse` hook on `Bash` in the
 * frontmatter (the shape the generator of `warrant-reviewer` uses, design phase-4b §6), the three calls as its body.
 */
export function agentFile(recorderPath) {
  const command = `node "${recorderPath}" agent`.replace(/'/g, "''");
  return [
    "---",
    `name: ${AGENT_NAME}`,
    "description: Probe of a PreToolUse hook in the frontmatter of a subagent (scripts/dev/probe-hooks.js). Use only when asked to run the probe agent.",
    "tools: Read, Grep, Glob, Bash",
    "hooks:",
    "  PreToolUse:",
    '    - matcher: "Bash"',
    "      hooks:",
    "        - type: command",
    `          command: '${command}'`,
    "---",
    "",
    "You are a probe of hooks. Do exactly these steps, one Bash call each, in order. Do not retry, rephrase or work",
    "around a refusal, and use no other tool.",
    "",
    `1. Run the Bash command: ${AGENT_BASH_COMMAND}`,
    "2. Run this Bash command exactly as written, as one call (a heredoc over three lines):",
    "",
    "```bash",
    AGENT_HEREDOC_COMMAND,
    "```",
    "",
    `3. Run the Bash command: ${AGENT_DENY_COMMAND}`,
    "",
    "Then report for each step: whether the command ran, its output, and verbatim every refusal or hook message you",
    'received (quote every line that contains "probe-hooks").',
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
    `7. Use the Agent tool to run the subagent ${AGENT_NAME} with the prompt: Run the probe.`,
    "   Relay its report verbatim, then say whether a line \"probe-hooks agent deny: …\" reached it and whether the",
    `   file ${AGENT_DENY_FILE} exists now (check with the Read tool; do not create it).`,
    "8. Stop."
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

/** True when the record was written by the hook of the subagent's frontmatter (`recordHook` with `agent`). */
const fromAgent = (name) => name.includes("-agent-");

/** The first parsed record of a Bash call whose command contains `word`, by hook (`agent` or not) and event. */
function bashRecord(all, agent, event, word) {
  return all.find(
    ({ name, json }) =>
      fromAgent(name) === agent &&
      json.hook_event_name === event &&
      json.tool_name === "Bash" &&
      String(json.tool_input?.command ?? "").includes(word)
  )?.json;
}

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

/**
 * `json` with the home directory as `~` in every string value at any depth (`transcript_path`, `scratchpad_dir`, …):
 * the fixture keeps the shape, not the profile path. The home matches with either slash and in any case (the drive
 * letter and the profile name differ in case between the fields Claude Code writes).
 */
export function redacted(json, home) {
  const parts = slash(home ?? "")
    .replace(/\/+$/, "")
    .split("/")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (parts.join("") === "") return json;
  const pattern = new RegExp(`${parts.join("[\\\\/]")}(?=$|[\\\\/])`, "gi");
  const walk = (value) => {
    if (typeof value === "string") return value.replace(pattern, "~");
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    return value;
  };
  return walk(json);
}

/**
 * The fixtures of the contract from the records: for each of `FIXTURES` the first record of its event and tool from
 * the scenario call; `missing` names those the records lack.
 */
export function pickFixtures(records, home) {
  const all = parsed(records).filter(({ name }) => !fromAgent(name));
  const fixtures = [];
  const missing = [];
  for (const f of FIXTURES) {
    const hit = all.find(({ json }) => json.hook_event_name === f.event && json.tool_name === f.tool && scenarioCall(json));
    if (hit) fixtures.push({ file: f.file, text: `${JSON.stringify(redacted(hit.json, home), null, 2)}\n` });
    else missing.push(f.file);
  }
  return { fixtures, missing };
}

/**
 * The fixtures of the subagent from the records (`AGENT_FIXTURES`); `absent` names those the records lack — an answer
 * of the probe (the frontmatter hook was not called), not a failure of `collect`.
 */
export function pickAgentFixtures(records, home) {
  const all = parsed(records);
  const fixtures = [];
  const absent = [];
  for (const f of AGENT_FIXTURES) {
    const hit = bashRecord(all, f.source === "agent", "PreToolUse", f.word);
    if (hit) fixtures.push({ file: f.file, text: `${JSON.stringify(redacted(hit, home), null, 2)}\n` });
    else absent.push(f.file);
  }
  return { fixtures, absent };
}

/** Top-level keys of two hook inputs compared; `agentFields` — the keys of `other` named `agent…` with their values. */
function inputDiff(main, other) {
  if (main === undefined || other === undefined) return undefined;
  const a = Object.keys(main);
  const b = Object.keys(other);
  return {
    onlyOther: b.filter((k) => !a.includes(k)).sort(),
    onlyMain: a.filter((k) => !b.includes(k)).sort(),
    agentFields: Object.fromEntries(b.filter((k) => /^agent/i.test(k)).sort().map((k) => [k, other[k]]))
  };
}

/**
 * The answers about the subagent: per call whether the frontmatter hook and the hook of settings.json saw it (A1);
 * whether the deny of the marker command acted — the recorder answered deny, and the command neither wrote
 * `AGENT_DENY_FILE` nor reached `PostToolUse` (A2); the input of a subagent call against the main session's Bash
 * of step 4 (A3); the heredoc command as Claude Code passed it.
 */
export function agentAnswers(records, exists) {
  const all = parsed(records);
  const steps = [
    ["plain", AGENT_BASH_WORD],
    ["heredoc", AGENT_HEREDOC_WORD],
    ["marker", AGENT_DENY_MARKER]
  ].map(([step, word]) => ({
    step,
    frontmatterPre: bashRecord(all, true, "PreToolUse", word) !== undefined,
    sessionPre: bashRecord(all, false, "PreToolUse", word) !== undefined,
    sessionPost: bashRecord(all, false, "PostToolUse", word) !== undefined
  }));
  const marker = steps[2];
  const answeredDeny = records.some((r) => fromAgent(r.name) && r.name.endsWith("-PreToolUse-Bash-deny.json"));
  const ran = exists(AGENT_DENY_FILE);
  let deny;
  if (!marker.frontmatterPre && !marker.sessionPre && !ran) deny = "not tried: no hook saw the marker command (step 7 not done?)";
  else if (!answeredDeny) deny = "no deny sent: the frontmatter hook was not called on the marker command";
  else if (ran || marker.sessionPost) deny = `deny did NOT act: the marker command ran (${ran ? `${AGENT_DENY_FILE} written` : "PostToolUse seen"})`;
  else deny = "deny acted: the marker command did not run";
  const main = all.find(
    ({ name, json }) => !fromAgent(name) && json.hook_event_name === "PreToolUse" && json.tool_name === "Bash" && json.tool_input?.command === BASH_COMMAND
  )?.json;
  const heredoc = bashRecord(all, true, "PreToolUse", AGENT_HEREDOC_WORD) ?? bashRecord(all, false, "PreToolUse", AGENT_HEREDOC_WORD);
  return {
    steps,
    deny,
    frontmatterVsMain: inputDiff(main, bashRecord(all, true, "PreToolUse", AGENT_BASH_WORD)),
    sessionVsMain: inputDiff(main, bashRecord(all, false, "PreToolUse", AGENT_BASH_WORD)),
    heredocCommand: heredoc?.tool_input?.command
  };
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

/** Lines of the report about the subagent (`agent`: `{ absent, answers }` of `pickAgentFixtures`, `agentAnswers`). */
function agentLines({ absent, answers }, denyWord) {
  const yes = (flag) => (flag ? "yes" : "no ");
  const diff = (d) =>
    d === undefined
      ? "— (a record is missing)"
      : `only in the subagent's: [${d.onlyOther.join(", ")}]; only in the main session's: [${d.onlyMain.join(", ")}]; agent fields: ${JSON.stringify(d.agentFields)}`;
  const lines = [
    "",
    `Subagent ${AGENT_NAME} (hook PreToolUse on Bash in its frontmatter)`,
    ...(absent.length > 0 ? [`   absent agent fixtures: ${absent.join(", ")}`] : []),
    "A1 is the frontmatter hook called on the subagent's Bash? (and the hook of settings.json)"
  ];
  for (const s of answers.steps) {
    lines.push(`   ${s.step.padEnd(8)} frontmatter pre ${yes(s.frontmatterPre)}   settings.json pre ${yes(s.sessionPre)} post ${yes(s.sessionPost)}`);
  }
  lines.push(
    "A2 does the deny of the frontmatter hook reach?",
    `   ${answers.deny}`,
    `   → the subagent's report (step 7) quotes "probe-hooks agent deny: ${denyWord}": yes — the reason reaches the model`,
    "A3 input of a subagent call vs the main session's Bash (step 4):",
    `   frontmatter hook:   ${diff(answers.frontmatterVsMain)}`,
    `   settings.json hook: ${diff(answers.sessionVsMain)}`,
    `   heredoc command as passed: ${answers.heredocCommand === undefined ? "— (not recorded)" : JSON.stringify(answers.heredocCommand)}`
  );
  return lines;
}

/** The report `collect` prints; `agent` — the part of the subagent, `denyWord` — its code word. */
export function formatReport({ version, fixtureDir, written, missing, answers, agent, denyWord }) {
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
  if (agent !== undefined) lines.push(...agentLines(agent, denyWord ?? "—"));
  return `${lines.join("\n")}\n`;
}
