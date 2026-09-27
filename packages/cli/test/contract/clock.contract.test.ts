/**
 * `systemClock` against the time zone of a real process (BL-64, REQ-KRN-034,
 * design §6, I-195): `localToday()` is the date `openspec archive` names its
 * directory by — the local date of the process — and `today()` stays the UTC
 * date. The time zone is fixed when a process starts, so each case runs the
 * built clock (`dist/core/ports/clock.js`) in a child `node` with its own
 * `TZ` and a `Date` pinned to one moment; `unit` starts no process (ADR-0025
 * п. 7a), hence this level.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { CLI_ROOT } from "../helpers/cli.js";

const CLOCK = pathToFileURL(path.join(CLI_ROOT, "dist", "core", "ports", "clock.js")).href;

/** `today()` and `localToday()` of `systemClock` in a process of time zone `tz` at the moment `at`. */
function datesAt(tz: string, at: string): Promise<{ utc: string; local: string }> {
  const script = [
    `const fixed = Date.parse(${JSON.stringify(at)});`,
    "const Real = Date;",
    "globalThis.Date = class extends Real { constructor(...a) { super(...(a.length === 0 ? [fixed] : a)); } static now() { return fixed; } };",
    `const { systemClock } = await import(${JSON.stringify(CLOCK)});`,
    "process.stdout.write(JSON.stringify({ utc: systemClock.today(), local: systemClock.localToday() }));"
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ: tz } });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`node exited ${String(code)}: ${stderr}`));
      else resolve(JSON.parse(stdout) as { utc: string; local: string });
    });
  });
}

describe("ClockPort: systemClock in the time zone of the process (BL-64)", () => {
  it("UTC+3 late in the evening: the local date is the next day, the UTC date stays (SCN-KRN-147)", async () => {
    expect(await datesAt("Etc/GMT-3", "2026-09-26T22:54:00Z")).toEqual({ utc: "2026-09-26", local: "2026-09-27" });
  });

  it("UTC: both dates agree", async () => {
    expect(await datesAt("UTC", "2026-09-26T22:54:00Z")).toEqual({ utc: "2026-09-26", local: "2026-09-26" });
  });

  it("UTC-5 early in the morning: the local date is the day before", async () => {
    expect(await datesAt("Etc/GMT+5", "2026-09-27T02:00:00Z")).toEqual({ utc: "2026-09-27", local: "2026-09-26" });
  });
});
