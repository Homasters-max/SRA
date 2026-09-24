/**
 * `warrant waive` (REQ-KRN-031, 05 section 7, design §8): the writer of
 * `.warrant/waivers/<WAV>.json`. Three modes, chosen by flags:
 *
 * 1. `warrant waive <change> <gate> --reason <text> --risk <LOW|MEDIUM|HIGH>
 *    --control <text>… --owner human:<login> --expires <YYYY-MM-DD>` proposes
 *    a waiver: `PROPOSED`, no `approved_by`, never `targets[]` (phase 5), id
 *    `WAV-<UTC year>-NNN` next after the highest of that year. The Change must
 *    have a live record, the gate must be declared by a loaded pack (or
 *    `.warrant/local/`) with `waivable: true`. An agent may do this.
 * 2. `warrant waive --activate <WAV> --by <login>`: `PROPOSED -> ACTIVE`,
 *    `approved_by: human:<login>` — the human act of 05 section 7.
 * 3. `warrant waive --revoke <WAV> --by <login>`: `PROPOSED | ACTIVE -> REVOKED`.
 *
 * For 2 and 3 the login must be in `roles.maintainer` (`ROLE_REQUIRED`); like
 * `transition --by`, it is a claim until `warrant ci` (phase 4). Everything is
 * checked before the one write, through `writeJsonFile`; the written file must
 * match `warrant://waiver/1`.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeJsonFile } from "../core/canon/format-json.js";
import type { Ctx } from "../core/ctx.js";
import { EXIT, WarrantError, type CliError } from "../core/errors.js";
import { allocateWaiver } from "../core/ids/allocate.js";
import { isPlainObject } from "../core/json.js";
import { loadPacks } from "../core/packs/loader.js";
import { readChangeRecord } from "../core/record/read.js";
import { assertNotFrozen } from "../core/record/write.js";
import { RISK_LEVELS } from "../core/resolve/types.js";
import type { Json } from "../core/schemas/loader.js";
import { validateFile } from "../core/schemas/semantic.js";
import { roleMembers, WAIVERS_DIR } from "../core/validate/waivers.js";
import { failures, success, type CommandResult } from "../io/output.js";
import { requireConfigPath } from "./context.js";

export interface WaiveOptions {
  reason?: string | undefined;
  risk?: string | undefined;
  control?: string[] | undefined;
  owner?: string | undefined;
  expires?: string | undefined;
  activate?: string | undefined;
  revoke?: string | undefined;
  by?: string | undefined;
}

/** Role whose members activate and revoke waivers (05 section 7). */
export const WAIVER_ROLE = "maintainer";

const LOGIN_RE = /^[A-Za-z0-9._-]+$/;
const OWNER_RE = /^human:[A-Za-z0-9._-]+$/;
const WAIVER_ID_RE = /^WAV-[0-9]{4}-[0-9]{3}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const CREATE_FLAGS = ["reason", "risk", "control", "owner", "expires"] as const;

function waiverRel(id: string): string {
  return `.warrant/waivers/${id}.json`;
}

/** True for a real calendar date `YYYY-MM-DD`. */
function isCalendarDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (m === null) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Writes a waiver after checking it against its schema: a command never writes an invalid file. */
function writeWaiver(root: string, waiver: Record<string, unknown>): void {
  const rel = waiverRel(String(waiver["id"]));
  const checked = validateFile(waiver as Json, rel);
  if (!checked.ok) {
    const first = checked.errors[0] as CliError;
    throw new WarrantError("INTERNAL", `the waiver would not match its schema: ${first.message}`, { path: first.path ?? rel });
  }
  mkdirSync(path.join(root, WAIVERS_DIR), { recursive: true });
  writeJsonFile(path.join(root, WAIVERS_DIR, `${String(waiver["id"])}.json`), waiver as Json);
}

export function runWaive(ctx: Ctx, args: string[], opts: WaiveOptions = {}): CommandResult {
  const { root } = ctx;
  requireConfigPath(root);
  const modes = (["activate", "revoke"] as const).filter((m) => opts[m] !== undefined);
  if (modes.length > 1) throw new WarrantError("USAGE", "--activate and --revoke exclude each other");
  const mode = modes[0];
  if (mode === undefined) return create(ctx, args, opts);

  const createFlags = CREATE_FLAGS.filter((f) => (f === "control" ? (opts.control ?? []).length > 0 : opts[f] !== undefined));
  if (args.length > 0 || createFlags.length > 0) {
    const extra = [...args, ...createFlags.map((f) => `--${f}`)].join(", ");
    throw new WarrantError("USAGE", `--${mode} <WAV> --by <login> takes nothing else (got ${extra})`);
  }
  return changeState(mode, opts[mode] as string, opts.by, root);
}

function create(ctx: Ctx, args: string[], opts: WaiveOptions): CommandResult {
  const { root } = ctx;
  if (opts.by !== undefined) throw new WarrantError("USAGE", "--by applies to --activate and --revoke; a waiver is proposed without it");
  if (args.length !== 2) {
    throw new WarrantError(
      "USAGE",
      "usage: warrant waive <change> <gate> --reason <text> --risk <LOW|MEDIUM|HIGH> --control <text>... --owner human:<login> --expires <YYYY-MM-DD>"
    );
  }
  const [change, gateId] = args as [string, string];
  const reason = opts.reason?.trim() ?? "";
  if (reason === "") throw new WarrantError("USAGE", "--reason <text> is required: why the gate cannot be satisfied");
  if (opts.risk === undefined || !(RISK_LEVELS as readonly string[]).includes(opts.risk)) {
    throw new WarrantError("USAGE", `--risk must be one of ${RISK_LEVELS.join(", ")}`);
  }
  const controls = (opts.control ?? []).map((c) => c.trim());
  if (controls.length === 0 || controls.some((c) => c === "")) {
    throw new WarrantError("USAGE", "--control <text> is required at least once: the compensating controls of the accepted risk");
  }
  if (opts.owner === undefined || !OWNER_RE.test(opts.owner)) {
    throw new WarrantError("USAGE", "--owner must be human:<login>, the person accountable for the accepted risk");
  }
  const today = ctx.clock.today();
  if (opts.expires === undefined || !isCalendarDate(opts.expires)) {
    throw new WarrantError("USAGE", "--expires must be a date YYYY-MM-DD");
  }
  if (opts.expires < today) throw new WarrantError("USAGE", `--expires ${opts.expires} is before today (${today}, UTC)`);

  const record = readChangeRecord(root, change);
  assertNotFrozen(record, change);

  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) return failures(loaded.errors, EXIT.CONFIG, {}, change);
  const gate = loaded.objects.find((o) => o.kind === "gate" && o.id === gateId);
  if (gate === undefined) {
    throw new WarrantError("WAIVER_INVALID", `gate "${gateId}" is not declared by any enabled pack or by .warrant/local/`);
  }
  if (!isPlainObject(gate.json) || gate.json["waivable"] !== true) {
    throw new WarrantError("WAIVER_INVALID", `gate "${gateId}" is not waivable (${gate.path})`, { path: gate.path });
  }

  const id = allocateWaiver(root, Number.parseInt(today.slice(0, 4), 10));
  const waiver: Record<string, unknown> = {
    $schema: "warrant://waiver/1",
    id,
    change,
    gate: gateId,
    reason,
    risk: opts.risk,
    compensating_controls: controls,
    owner: opts.owner,
    expires_at: opts.expires,
    waiver_state: "PROPOSED"
  };
  writeWaiver(root, waiver);
  return success({ path: waiverRel(id), waiver }, change);
}

/** Source states of each mode; the target state and whether the approver is written. */
const MOVES = {
  activate: { from: ["PROPOSED"], to: "ACTIVE" },
  revoke: { from: ["PROPOSED", "ACTIVE"], to: "REVOKED" }
} as const;

function changeState(mode: keyof typeof MOVES, id: string, by: string | undefined, root: string): CommandResult {
  if (by === undefined || by === "") throw new WarrantError("USAGE", `--${mode} needs --by <login> of a maintainer`);
  if (!LOGIN_RE.test(by)) throw new WarrantError("USAGE", `--by ${JSON.stringify(by)} is not a login ([A-Za-z0-9._-]+)`);

  const rel = waiverRel(id);
  const absolute = path.join(root, WAIVERS_DIR, `${id}.json`);
  if (!WAIVER_ID_RE.test(id) || !existsSync(absolute)) {
    throw new WarrantError("WAIVER_INVALID", `no waiver ${JSON.stringify(id)} in .warrant/waivers/`, { path: rel });
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (cause) {
    throw new WarrantError("WAIVER_INVALID", `${id}: invalid JSON: ${(cause as Error).message}`, { path: rel });
  }
  if (!isPlainObject(json) || json["$schema"] !== "warrant://waiver/1") {
    throw new WarrantError("WAIVER_INVALID", `${rel} is not a warrant://waiver/1 document`, { path: rel });
  }
  const checked = validateFile(json as Json, rel);
  if (!checked.ok) {
    const first = checked.errors[0] as CliError;
    throw new WarrantError("WAIVER_INVALID", `${id}: ${first.message}; fix it before changing its state`, { path: first.path ?? rel });
  }
  if (json["id"] !== id) {
    throw new WarrantError("WAIVER_INVALID", `${rel} holds id ${JSON.stringify(json["id"])}, not ${id}`, { path: `${rel}#/id` });
  }

  const loaded = loadPacks(root);
  if (loaded.errors.length > 0) return failures(loaded.errors, EXIT.CONFIG, {});
  if (!roleMembers(loaded.config, [WAIVER_ROLE]).has(by)) {
    throw new WarrantError("ROLE_REQUIRED", `${by} is not listed in roles "${WAIVER_ROLE}" of .warrant/warrant.json, required to ${mode} a waiver`, {
      path: ".warrant/warrant.json"
    });
  }

  const move = MOVES[mode];
  const state = String(json["waiver_state"]);
  if (!(move.from as readonly string[]).includes(state)) {
    throw new WarrantError("STATE_INVALID", `${id} is ${state}: --${mode} moves a waiver from ${move.from.join(" or ")} to ${move.to}`, {
      path: `${rel}#/waiver_state`
    });
  }

  const waiver: Record<string, unknown> = { ...json, waiver_state: move.to };
  // ACTIVE names its approver; a PROPOSED waiver revoked before approval
  // names the maintainer who closed it (the schema wants approved_by outside PROPOSED).
  if (mode === "activate" || waiver["approved_by"] === undefined) waiver["approved_by"] = `human:${by}`;
  writeWaiver(root, waiver);
  return success({ path: rel, waiver }, String(json["change"]));
}
