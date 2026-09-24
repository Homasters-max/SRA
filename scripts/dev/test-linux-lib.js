/**
 * Plan of `scripts/dev/test-linux.js` (ADR-0033 п. 6, R6): the CI job `test (ubuntu-latest)` reproduced locally in
 * Docker. The committed HEAD travels as a git bundle (all refs — tags included, versions.test.ts needs them), not as a
 * mounted work tree: a Linux `npm ci` would overwrite the Windows node_modules, and a linked worktree's `.git` file
 * points at a Windows path. Uncommitted changes are not tested — like CI. Pure: returns the commands.
 */

export const IMAGE = "node:22";
export const OPENSPEC = "@fission-ai/openspec@1.13.1";

/** Shell script run in the container: clone the bundle, check out `sha`, install as CI does, `npm test`. */
export function containerScript(sha, openspec = OPENSPEC) {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error(`test-linux: not a commit sha: ${sha}`);
  return [
    "set -e",
    "git clone -q /bundle/repo.bundle /work",
    "cd /work",
    `git checkout -q ${sha}`,
    `npm i -g ${openspec} >/dev/null`,
    "npm ci",
    "npm test",
  ].join(" && ");
}

/** `{ bundle, docker }` — argv of `git` (create the bundle in `bundleDir`) and of `docker` (run the tests). */
export function linuxTestPlan({ sha, bundleDir, image = IMAGE, openspec = OPENSPEC }) {
  return {
    bundle: ["bundle", "create", `${bundleDir}/repo.bundle`, "--all"],
    docker: ["run", "--rm", "-v", `${bundleDir}:/bundle:ro`, image, "bash", "-lc", containerScript(sha, openspec)],
  };
}
