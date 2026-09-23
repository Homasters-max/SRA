/** The parsers a check may name in `parser` (design §5). */
import { parseJunitDir } from "./junit.js";
import { parseOpenspecValidate } from "./openspec-validate.js";
import type { Parser } from "./types.js";

export type { ParseInput, ParseResult, Parser } from "./types.js";

const PARSERS: readonly Parser[] = [
  {
    name: "junit",
    kind: "test-report",
    readsStdout: false,
    parse: ({ outDir }) => parseJunitDir(outDir)
  },
  {
    name: "openspec-validate",
    kind: "spec-report",
    readsStdout: true,
    stdoutFile: "stdout.json",
    parse: ({ stdout }) => parseOpenspecValidate(stdout)
  }
];

export function findParser(name: unknown): Parser | undefined {
  return PARSERS.find((parser) => parser.name === name);
}

export function parserNames(): string[] {
  return PARSERS.map((parser) => parser.name);
}
