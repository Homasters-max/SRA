import { defineConfig } from "vitest/config";
import { availableParallelism } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test levels (ADR-0025 п. 1, 8): directory = level = vitest project.
 *
 * - `unit`, `app` — no processes (setup file `forbid-spawn.ts`), 5 s per test,
 *   `threads` pool with the default number of workers;
 * - `contract`, `e2e` — processes allowed, 60 s per test, `forks` pool capped at
 *   `HEAVY_FORKS`: vitest 3.2 has no per-project worker limit, so the cap is set
 *   on the pool the heavy levels alone use (I-119); both need openspec 1.13.1
 *   on PATH (`globalSetup` `require-openspec.ts`): without it the run fails, it
 *   is not skipped (ADR-0025 п. 5).
 */
export const LEVELS = ["unit", "app", "contract", "e2e"] as const;

const HEAVY_FORKS = Math.max(1, Math.min(4, availableParallelism() - 1));

const FORBID_SPAWN = "test/helpers/forbid-spawn.ts";

const REQUIRE_OPENSPEC = "test/helpers/require-openspec.ts";

const light = (name: "unit" | "app") => ({
  extends: true as const,
  test: {
    name,
    include: [`test/${name}/**/*.test.ts`],
    pool: "threads" as const,
    setupFiles: [FORBID_SPAWN],
    testTimeout: 5_000,
    hookTimeout: 5_000
  }
});

const heavy = (name: "contract" | "e2e") => ({
  extends: true as const,
  test: {
    name,
    include: [`test/${name}/**/*.test.ts`],
    pool: "forks" as const,
    globalSetup: [REQUIRE_OPENSPEC],
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
});

// Tests are run from the repository root (`npm test`), so pin the root here.
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    poolOptions: { forks: { maxForks: HEAVY_FORKS, minForks: 1 } },
    projects: [light("unit"), light("app"), heavy("contract"), heavy("e2e")]
  }
});
