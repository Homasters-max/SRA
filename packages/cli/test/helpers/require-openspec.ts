/**
 * `globalSetup` of the `contract` and `e2e` projects (ADR-0025 п. 5, design
 * §7): they run the real `openspec`, and only the version pinned by ADR-0015.
 * Without it, or with another version, the run FAILS with a message saying
 * which version to install — it is not skipped, which would hide an unchecked
 * contract.
 */
import { OPENSPEC_VERSION, openspecSync } from "./openspec.js";

/** Why `found` (what `openspec --version` printed, null when it did not run) is not the required version; null when it is. */
export function openspecVersionProblem(found: string | null): string | null {
  const version = found === null ? null : (/\d+\.\d+\.\d+\S*/.exec(found)?.[0] ?? null);
  if (version === OPENSPEC_VERSION) return null;
  const seen = version === null ? "no `openspec` on PATH" : `openspec ${version} on PATH`;
  return (
    `the contract and e2e tests need openspec ${OPENSPEC_VERSION} (ADR-0015, ADR-0025 п. 5), found ${seen}; ` +
    `install it with \`npm i -g @fission-ai/openspec@${OPENSPEC_VERSION}\``
  );
}

export default function setup(): void {
  const run = openspecSync(["--version"], process.cwd());
  const problem = openspecVersionProblem(run.ok ? run.stdout : null);
  if (problem !== null) throw new Error(problem);
}
