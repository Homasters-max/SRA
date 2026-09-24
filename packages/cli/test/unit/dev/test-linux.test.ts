/**
 * `npm run test:linux` (ADR-0033 п. 6, R6): `scripts/dev/test-linux-lib.js` plans a git bundle of all refs and a
 * Docker run that clones it, checks out the commit and runs `npm test` as the CI job on ubuntu does.
 */
import { describe, expect, it } from "vitest";

import { containerScript, IMAGE, linuxTestPlan, OPENSPEC } from "../../../../../scripts/dev/test-linux-lib.js";

describe("test-linux — ADR-0033 п. 6", () => {
  it("bundles all refs and runs the tests of the commit in node:22 with OpenSpec 1.13.1", () => {
    const plan = linuxTestPlan({ sha: "abc1234", bundleDir: "C:/tmp/w" });
    expect(plan.bundle).toEqual(["bundle", "create", "C:/tmp/w/repo.bundle", "--all"]);
    expect(plan.docker.slice(0, 5)).toEqual(["run", "--rm", "-v", "C:/tmp/w:/bundle:ro", IMAGE]);
    expect(plan.docker.slice(5, 7)).toEqual(["bash", "-lc"]);
    const script = plan.docker[7]!;
    expect(script.split(" && ")).toEqual([
      "set -e",
      "git clone -q /bundle/repo.bundle /work",
      "cd /work",
      "git checkout -q abc1234",
      `npm i -g ${OPENSPEC} >/dev/null`,
      "npm ci",
      "npm test",
    ]);
  });

  it("refuses anything but a commit sha in the container script", () => {
    expect(() => containerScript("abc; rm -rf /")).toThrow(/not a commit sha/);
    expect(() => containerScript("HEAD")).toThrow(/not a commit sha/);
  });
});
