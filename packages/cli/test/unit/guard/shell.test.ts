/**
 * The shell parse of `guard` (design §6, ADR-0017 п. 5, task 5.2): the
 * tokenizer (`core/shell.ts`) — quotes, `\`, operators, a newline, a heredoc as
 * data (I-167) —, simple commands with `VAR=…` dropped and `bash -c` parsed one level deep, the default prefix of
 * `run.command` and the prefix match.
 */
import { describe, expect, it } from "vitest";

import { reviewShellAnswer, SUBMIT_HINT } from "../../../src/core/guard/decide.js";
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

describe("shellWords: a heredoc is data of its command (I-167)", () => {
  it("drops the redirection and the body for <<DELIM, <<'DELIM', <<\"DELIM\" and << DELIM", () => {
    for (const redirection of ["<<EOF", "<<'EOF'", '<<"EOF"', "<< EOF", "<<E'O'F"]) {
      expect(shellWords(`cat ${redirection}\nrm -rf x; it's && a | b\nEOF\nls -l`), redirection).toEqual(["cat", "\n", "ls", "-l"]);
    }
    expect(shellWords("cat<<EOF\nrm x\nEOF")).toEqual(["cat", "\n"]);
  });

  it("<<- strips leading tabs of the body lines and of the delimiter line", () => {
    expect(shellWords("cat <<-EOF\n\trm x\n\t\tEOF\nls")).toEqual(["cat", "\n", "ls"]);
    // Without `-` a tab-indented delimiter line is body: the heredoc is never closed.
    expect(shellWords("cat <<EOF\n\tEOF")).toEqual(["cat", "\n", "EOF"]);
  });

  it("a heredoc in the middle of a && chain: the rest of its line stays commands, the body does not", () => {
    expect(shellWords("cat <<EOF && warrant run submit\nrm x; y\nEOF\nls")).toEqual([
      "cat", "&&", "warrant", "run", "submit", "\n", "ls"
    ]);
    expect(shellWords("cat <<A <<-B | wc\na\nA\n\tb\n\tB")).toEqual(["cat", "|", "wc", "\n"]);
  });

  it("a redirection before the command name does not shift its first word", () => {
    expect(simpleCommands(shellWords("<<EOF pytest -q\nx\nEOF"))).toEqual([["pytest", "-q"]]);
  });

  it("a delimiter line that never comes: the lines stay commands (fail-safe)", () => {
    expect(shellWords("warrant run submit <<'JSON'\n{\nrm -rf x")).toEqual([
      "warrant", "run", "submit", "\n", "{", "\n", "rm", "-rf", "x"
    ]);
    expect(shellWords("cat <<EOF")).toEqual(["cat"]);
  });

  it("a delimiter line ending in CR closes; <<< and << without a delimiter are words", () => {
    expect(shellWords("cat <<EOF\r\nrm x\r\nEOF\r\nls")).toEqual(["cat", "\n", "ls"]);
    expect(shellWords("cat <<<'a b'")).toEqual(["cat", "<<<a b"]);
    expect(shellWords("echo << ;ls")).toEqual(["echo", "<<", ";", "ls"]);
  });

  it("a heredoc inside bash -c is data too", () => {
    expect(leafCommands(["bash", "-c", "warrant run submit <<'J'\nrm x\nJ"])).toEqual([["warrant", "run", "submit"]]);
  });

  it("<< in a comment is no heredoc: the next lines stay commands; quotes and \\ in a comment are text, its words stay words", () => {
    expect(shellWords("warrant run submit # <<X\nrm -rf src\nX")).toEqual([
      "warrant", "run", "submit", "#", "<<X", "\n", "rm", "-rf", "src", "\n", "X"
    ]);
    expect(simpleCommands(shellWords("echo # it's \\\npytest\n'"))).toEqual([["echo", "#", "it's", "\\"], ["pytest"], [""]]);
    // `#` inside a word, quoted or escaped starts no comment.
    expect(shellWords("a#b <<X\nrm\nX")).toEqual(["a#b", "\n"]);
    expect(shellWords("echo '#' <<X\nrm\nX")).toEqual(["echo", "#", "\n"]);
    expect(shellWords("echo \\# <<X\nrm\nX")).toEqual(["echo", "#", "\n"]);
    expect(shellWords("cat <<X # c\nrm\nX\nls")).toEqual(["cat", "#", "c", "\n", "ls"]);
  });

  it("<< inside $((…)), ((…)), $[…], ${…} is no heredoc: the next lines stay commands", () => {
    for (const line of ["echo $((1<<X))", "((x<<X))", "(( (1+2) << X ))", "echo $[1<<X]", "echo ${x:-<<X}", "a=$((1<<X)) && ls"]) {
      const commands = simpleCommands(shellWords(`${line}\npytest\nX`));
      expect(commands.slice(-2), line).toEqual([["pytest"], ["X"]]);
    }
    // After the closing bracket, and for `$(…)` / `((…) )` (no arithmetic), a heredoc is one again.
    expect(shellWords("echo $((1)) <<X\nrm\nX")).toEqual(["echo", "$((1))", "\n"]);
    expect(shellWords("echo $(cat <<X\nrm\nX\n)")).toEqual(["echo", "$(cat", "\n", ")"]);
    expect(shellWords("((cat <<X\nit's\nX\n) )\npytest")).toEqual(["((cat", "\n", ")", ")", "\n", "pytest"]);
    // An unclosed one is no arithmetic: the heredoc is read as before.
    expect(shellWords("echo $((1 <<X\nrm\nX")).toEqual(["echo", "$((1", "\n"]);
  });

  it("# and $(( in a heredoc body do not change the parse: the body is data", () => {
    expect(shellWords("warrant run submit <<'JSON'\n# $((1<<Y)) ${z\n{\"a\": \"it's\"}\nJSON\nls")).toEqual(["warrant", "run", "submit", "\n", "ls"]);
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

  it("as written: VAR=… stays, only exactly bash -c / sh -c <string> is parsed", () => {
    expect(leafCommands(shellWords("X=1 warrant run submit"), true)).toEqual([["X=1", "warrant", "run", "submit"]]);
    expect(leafCommands(["sh", "-c", "a && b"], true)).toEqual([["a"], ["b"]]);
    for (const wrapper of [["bash", "-lc", "a"], ["/bin/bash", "-c", "a"], ["bash", "-c", "a", "x"], ["bash", "-e", "-c", "a"]]) {
      expect(leafCommands(wrapper, true), JSON.stringify(wrapper)).toEqual([wrapper]);
    }
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

  it("an envelope in a heredoc is data: allow; a command after the delimiter line is denied (I-167)", () => {
    const envelope = `{"statement": "it's; a && b | c", "run": "RUN-1"}`;
    expect(reviewShellAnswer(shellWords(`warrant run submit <<'JSON'\n${envelope}\nJSON`), run).decision).toBe("allow");
    const after = reviewShellAnswer(shellWords(`warrant run submit <<'JSON'\n${envelope}\nJSON\nrm -rf x`), run);
    expect(after.decision).toBe("deny");
    expect(after.reason).toContain("rm -rf x");
    expect(reviewShellAnswer(shellWords(`warrant run submit <<'JSON'\n${envelope}`), run).decision).toBe("deny");
  });

  it("only the strict form: exactly warrant run submit, --dry-run and --file <path> once each, trailing newlines", () => {
    for (const line of [
      "warrant run submit",
      "warrant run submit --file envelope.json",
      "warrant run submit --dry-run --file a/b.json",
      "warrant run submit --file 'C:\\r\\результат-1.json' --dry-run\n\n",
      "warrant run submit --dry-run --file a.json && warrant run submit --file a.json",
      "warrant run submit <<'JSON'\n{\"statement\": \"it's; a && b | c # d $((1<<2))\"}\nJSON"
    ]) {
      expect(reviewShellAnswer(shellWords(line), run).decision, line).toBe("allow");
    }
  });

  it("anything else is denied with the reason and hint as before: &, redirections, $(…), `…`, <(…), VAR=…, a comment, wrappers, options", () => {
    for (const line of [
      "warrant run submit & rm -rf src",
      "warrant run submit > openspec/changes/c/proposal.md",
      "warrant run submit --file $(rm -rf src)",
      "warrant run submit --file `rm -rf src`",
      "warrant run submit --file <(rm -rf src)",
      "warrant run submit --file 'a b.json'",
      "warrant run submit --file 'x;rm'",
      "NODE_OPTIONS=--import=x warrant run submit",
      "warrant run submit # <<X\nrm -rf src\nX",
      "warrant run submit # note",
      "warrant run submit --file",
      "warrant run submit --file -x.json",
      "warrant run submit --dry-run --dry-run",
      "warrant run submit --force",
      "warrant run submit < envelope.json",
      "bash -lc 'warrant run submit'",
      "/bin/bash -c 'warrant run submit'",
      "bash -c 'warrant run submit' x"
    ]) {
      const denied = reviewShellAnswer(shellWords(line), run);
      expect(denied.decision, line).toBe("deny");
      expect(denied.reason, line).toContain("a review Run runs only `warrant run submit`");
      expect(denied.hints, line).toEqual([SUBMIT_HINT]);
    }
    expect(reviewShellAnswer(shellWords("NODE_OPTIONS=--import=x warrant run submit"), run).reason).toContain("NODE_OPTIONS=--import=x");
    expect(reviewShellAnswer(shellWords("warrant run submit # <<X\nrm -rf src\nX"), run).reason).toContain("`warrant run submit # <<X`");
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
