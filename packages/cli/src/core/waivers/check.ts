/**
 * Semantics of `.warrant/waivers/*.json`: check (11) of `validate` and the
 * `targets[]` half of the two-step validation (REQ-KRN-021, D-13, P-16).
 *
 * The kernel schema has already accepted the file (check (1)); what is left is
 * what one file cannot know: whether the Change and the gate exist, whether the
 * gate may be waived at all, and whether the approver, if any, holds a role.
 * Owner: `core/waivers` (ADR-0030 п. 1, R2; A-7), moved from `core/validate/waivers.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { CliError } from "../errors.js";
import { reportPath, walkFiles } from "../fs.js";
import { isPlainObject } from "../json.js";
import type { LoadResult } from "../packs/types.js";
import type { RecordFile } from "../record/read.js";
import { roleMembers } from "../roles.js";
import { validateDocument } from "../schemas/loader.js";
import { WAIVERS_DIR } from "./read.js";
import { approverLogin } from "./status.js";

export interface WaiverCheck {
  errors: CliError[];
  /** `WAIVER_EXPIRED` lines for stderr: a report, not a finding (SCN-KRN-099). */
  warnings: string[];
}

/**
 * Check (11). `today` is the UTC calendar date `YYYY-MM-DD`; an `ACTIVE` waiver
 * whose `expires_at` is before it is expired.
 */
export function checkWaivers(
  root: string,
  loaded: LoadResult,
  records: ReadonlyMap<string, RecordFile>,
  today: string
): WaiverCheck {
  const errors: CliError[] = [];
  const warnings: string[] = [];
  const gates = new Map(loaded.objects.filter((o) => o.kind === "gate").map((o) => [o.id, o]));
  const members = roleMembers(loaded.config);

  for (const absolute of walkFiles(path.join(root, WAIVERS_DIR))) {
    if (!absolute.toLowerCase().endsWith(".json")) continue;
    const reported = reportPath(absolute, root);
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(absolute, "utf8"));
    } catch {
      continue; // check (1) reports it
    }
    if (!isPlainObject(json) || json["$schema"] !== "warrant://waiver/1" || !validateDocument(json).ok) continue;

    const invalid = (reason: string, pointer: string): void => {
      errors.push({ code: "WAIVER_INVALID", message: `${String(json["id"])}: ${reason}`, path: `${reported}#${pointer}` });
    };

    const change = String(json["change"]);
    if (!records.has(change)) invalid(`change "${change}" has no record in .warrant/changes/`, "/change");

    const gateId = String(json["gate"]);
    const gate = gates.get(gateId);
    if (gate === undefined) {
      invalid(`gate "${gateId}" is not declared by any enabled pack or by .warrant/local/`, "/gate");
    } else if (!isPlainObject(gate.json) || gate.json["waivable"] !== true) {
      invalid(`gate "${gateId}" is not waivable (${gate.path})`, "/gate");
    }

    // A PROPOSED waiver has no approver yet (REQ-KRN-019); the schema demands
    // one in every other state, so the field is compared only when present.
    if (json["approved_by"] !== undefined && !members.has(approverLogin(json))) {
      invalid(`approved_by "${String(json["approved_by"])}" is not listed in roles of .warrant/warrant.json`, "/approved_by");
    }

    // D-13: the form of `targets[]` comes from the pack of the gate; no gate
    // declares one in phase 3, so any target is of an unknown form.
    const targets = json["targets"];
    if (Array.isArray(targets) && targets.length > 0) {
      errors.push({
        code: "PACK_FORM_UNKNOWN",
        message: `${String(json["id"])}: gate "${gateId}" declares no form for targets[]`,
        path: `${reported}#/targets`
      });
    }

    const expires = json["expires_at"];
    if (json["waiver_state"] === "ACTIVE" && typeof expires === "string" && expires < today) {
      warnings.push(`validate: WAIVER_EXPIRED ${reported}: ${String(json["id"])} expired on ${expires}\n`);
    }
  }

  return { errors, warnings };
}
