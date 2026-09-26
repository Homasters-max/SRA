/**
 * A Run started in the test process (A-26): `run start` with no
 * `WARRANT_STATE_DIR`, so `<state>` is `.warrant` of the project; the test
 * fails on any error of the start.
 */
import { expect } from "vitest";

import { runStart, type RunStartOptions } from "../../../src/commands/run.js";
import { invoke } from "./invoke.js";
import type { ProjectBuilder } from "./project-builder.js";

/** The id of the active Run of `change`, started with `opts` (an `implement` Run by default). */
export async function started(p: ProjectBuilder, change = "add-search", opts: RunStartOptions = { operation: "implement" }): Promise<string> {
  const run = await invoke(() => runStart(p.ctx, change, opts, {}));
  expect(run.errors).toEqual([]);
  return run.data["run"] as string;
}
