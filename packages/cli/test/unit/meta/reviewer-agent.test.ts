/**
 * The subagent `warrant-reviewer` of this repository (design phase-4b §6, N24, task 6.4): `.claude/agents/warrant-reviewer.md`
 * is the output of the generator of `sync` for the `warrant.json` of the repository with `frontends: ["claude"]`. The
 * repository keeps no `frontends` — guard of the main session is not on here (ADR-0034 п. 4) — so `sync` does not write
 * the file; its committed copy is held byte for byte here. After a change of the generator or of the review skill:
 *
 *   npm run build
 *   node --input-type=module -e "const {loadPacks}=await import('./packages/cli/dist/core/packs/loader.js');const {planSync}=await import('./packages/cli/dist/core/sync/plan.js');const l=loadPacks(process.cwd());process.stdout.write(planSync({root:process.cwd(),loaded:{...l,config:{...l.config,frontends:['claude']}},openspecVersion:null}).files.find((f)=>f.path==='.claude/agents/warrant-reviewer.md').bytes)" > .claude/agents/warrant-reviewer.md
 *
 * Level `unit`: reads files, starts no process.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadPacks } from "../../../src/core/packs/loader.js";
import { CLAUDE_REVIEWER_REL } from "../../../src/core/sync/claude.js";
import { planSync } from "../../../src/core/sync/plan.js";
import { REPO_ROOT } from "../../helpers/cli.js";

const loaded = loadPacks(REPO_ROOT);

describe(".claude/agents/warrant-reviewer.md — the generator's output for this repository (design phase-4b §6)", () => {
  it("the policy of the repository loads and turns on no frontend (ADR-0034 п. 4)", () => {
    expect(loaded.errors).toEqual([]);
    expect(loaded.config.frontends).toEqual([]);
  });

  it("the committed file equals the planned file of sync with frontends [\"claude\"], byte for byte", () => {
    const plan = planSync({ root: REPO_ROOT, loaded: { ...loaded, config: { ...loaded.config, frontends: ["claude"] } }, openspecVersion: null });
    expect(plan.errors).toEqual([]);
    const planned = plan.files.find((file) => file.path === CLAUDE_REVIEWER_REL);
    expect(planned, CLAUDE_REVIEWER_REL).toBeDefined();
    const committed = readFileSync(path.join(REPO_ROOT, ...CLAUDE_REVIEWER_REL.split("/")));
    expect(committed.toString("utf8")).toBe(planned?.bytes.toString("utf8"));
    expect(committed.equals(planned?.bytes ?? Buffer.alloc(0))).toBe(true);
  });
});
