import { defineConfig } from "vitest/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Tests are run from the repository root (`npm test`), so pin the root here.
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    include: ["test/**/*.test.ts"],    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
