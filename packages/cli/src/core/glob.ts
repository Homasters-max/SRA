/**
 * Glob semantics of project paths (A-16): the one owner of `pathMatcher` and
 * the only importer of `picomatch` (ADR-0035). A local copy of `pathMatcher` is
 * an error of the `helper` rule, an import of `picomatch` elsewhere — of the
 * `package` rule of `test/unit/meta/architecture.test.ts`.
 */
import picomatch from "picomatch";

/**
 * A predicate "the project path matches at least one of `patterns`".
 * `dot: true` — otherwise `.warrant/**` would match nothing (05 §4).
 */
export function pathMatcher(patterns: readonly string[]): (path: string) => boolean {
  return picomatch([...patterns], { dot: true });
}
