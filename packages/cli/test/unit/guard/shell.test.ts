/**
 * The shell parse of `guard` (design §6, ADR-0017 п. 5, task 5.2): the
 * tokenizer (`core/shell.ts`) — quotes, `\`, operators, a newline —, simple commands with
 * `VAR=…` dropped and `bash -c` parsed one level deep, the default prefix of
 * `run.command` and the prefix match.
 */
import { describe, expect, it } from "vitest";

import { reviewShellAnswer } from "../../../src/core/guard/decide.js";
import { defaultPrefix, leafCommands, simpleCommands, startsWithPrefix } from "../../../src/core/guard/shell.js";
import type { Run } from "../../../src/core/run/types.js";
import { shellWords } from "../../../src/core/shell.js";

describe("shellWords", () => {
  it("splits at blanks; quotes join, single quotes are literal", () => {
    expect(shellWords("pytest  -q\ttests/")).toEqual(["pytest", "-q", "tests/"]);
    expect(shellWords(`echo 'a  b' "c d" e"f g"h`)).toEqual(["echo", "a  b", "c d", "ef gh"]);
    expect(shellWords(`echo '\\n $x "q"'`)).toEqual(["echo", '\\n $x "q"']);
    expect(shellWords(`echo "" ''`)).toEqual(["echo", "", ""]);
  });

  it("backslash: escapes outside quotes, only \" \\ $ ` and a newline inside double quotes", () => {
    expect(shellWords("echo a\\ b \\&\\& c")).toEqual(["echo", "a b", "&&", "c"]);
    expect(shellWords(`echo "a\\"b" "c\\d" "\\$x"`)).toEqual(["echo", 'a"b', "c\\d", "$x"]);
    expect(shellWords("pytest \\\n  -q")).toEqual(["pytest", "-q"]);
  });

  it("operators &&, ||, ;, | and a newline are words of their own, also without blanks", () => {
    expect(shellWords("cd src&&pytest||echo x;ls|wc\nnpm test")).toEqual([
      "cd", "src", "&&", "pytest", "||", "echo", "x", ";", "ls", "|", "wc", "\n", "npm", "test"
    ]);
  });

  it("an operator inside quotes stays part of the word", () => {
    expect(shellWords(`echo "a && b" 'c;d'`)).toEqual(["echo", "a && b", "c;d"]);
  });
});

describe("simpleCommands", () => {
  it("splits at the operators and drops empty commands", () => {
    expect(simpleCommands(shellWords("cd src && pytest tests/ ; ; ls | wc -l"))).toEqual([
      ["cd", "src"],
      ["pytest", "tests/"],
      ["ls"],
      ["wc", "-l"]
    ]);
  });

  it("VAR=1 before a command is skipped", () => {
    expect(simpleCommands(shellWords("VAR=1 CI=true pytest -q && A=b"))).toEqual([["pytest", "-q"]]);
  });

  it("bash -c / sh -c: the string is parsed one level deep (SCN-ENF-013)", () => {
    expect(simpleCommands(["bash", "-c", "cd src && pytest tests/"])).toEqual([
      ["bash", "-c", "cd src && pytest tests/"],
      ["cd", "src"],
      ["pytest", "tests/"]
    ]);
    expect(simpleCommands(shellWords(`sh -lc 'X=1 pytest'`))).toEqual([["sh", "-lc", "X=1 pytest"], ["pytest"]]);
    expect(simpleCommands(["/bin/bash", "-e", "-c", "npm test"])).toEqual([["/bin/bash", "-e", "-c", "npm test"], ["npm", "test"]]);
  });

  it("only one level: bash -c inside bash -c is not parsed again", () => {
    expect(simpleCommands(["bash", "-c", `bash -c "pytest"`])).toEqual([
      ["bash", "-c", `bash -c "pytest"`],
      ["bash", "-c", "pytest"]
    ]);
  });

  it("a script of bash without -c is not read", () => {
    expect(simpleCommands(["bash", "run-tests.sh"])).toEqual([["bash", "run-tests.sh"]]);
  });
});

describe("leafCommands", () => {
  it("a parsed bash -c stands for its commands, not for itself; one level deep", () => {
    expect(leafCommands(["bash", "-c", "cd src && pytest tests/"])).toEqual([["cd", "src"], ["pytest", "tests/"]]);
    expect(leafCommands(shellWords("X=1 warrant run submit --file r.json"))).toEqual([["warrant", "run", "submit", "--file", "r.json"]]);
    expect(leafCommands(["bash", "-c", `bash -c "pytest"`])).toEqual([["bash", "-c", "pytest"]]);
    expect(leafCommands(["bash", "-c", ""])).toEqual([]);
    expect(leafCommands(["bash", "run-tests.sh"])).toEqual([["bash", "run-tests.sh"]]);
  });
});

describe("reviewShellAnswer (REQ-ENF-004)", () => {
  const run = { id: "RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y", change: "add-search", operation: "review" } as Run;

  it("allow only when every command starts with warrant run submit (SCN-ENF-027)", () => {
    expect(reviewShellAnswer(["bash", "-c", "warrant run submit --file result.json"], run).decision).toBe("allow");
    expect(reviewShellAnswer(["warrant", "run", "submit"], run).decision).toBe("allow");
    const denied = reviewShellAnswer(["bash", "-c", "cat x && warrant run submit"], run);
    expect(denied.decision).toBe("deny");
    expect(denied.reason).toContain("cat x");
    expect(denied.hints.join(" ")).toContain("warrant run submit");
  });

  it("no command, no argv, a longer bash nesting and a lookalike are denied", () => {
    for (const argv of [undefined, [], ["bash", "-c", ""], ["bash", "-c", 'bash -c "warrant run submit"'], ["warrant", "run", "finish"], ["npx", "warrant", "run", "submit"]]) {
      expect(reviewShellAnswer(argv, run).decision, JSON.stringify(argv)).toBe("deny");
    }
  });
});

describe("defaultPrefix and startsWithPrefix", () => {
  it("the words of run.command before the first flag or placeholder", () => {
    expect(defaultPrefix(["pytest", "-q"])).toEqual(["pytest"]);
    expect(defaultPrefix(["npm", "test", "--", "--reporter=junit"])).toEqual(["npm", "test"]);
    expect(defaultPrefix(["openspec", "validate", "{change}", "--strict"])).toEqual(["openspec", "validate"]);
    expect(defaultPrefix(["-x"])).toEqual([]);
  });

  it("a command matches a non-empty prefix word by word", () => {
    expect(startsWithPrefix(["pytest", "tests/"], ["pytest"])).toBe(true);
    expect(startsWithPrefix(["npm", "test"], ["npm", "test"])).toBe(true);
    expect(startsWithPrefix(["npm"], ["npm", "test"])).toBe(false);
    expect(startsWithPrefix(["pytests"], ["pytest"])).toBe(false);
    expect(startsWithPrefix(["pytest"], [])).toBe(false);
  });
});
