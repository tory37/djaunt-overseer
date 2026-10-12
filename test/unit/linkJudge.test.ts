import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { LinkCandidate } from "../../src/linkCandidates";
import { loadJudgeCache, saveJudgeCache } from "../../src/linkCache";
import {
  buildJudgeDigest,
  candidateFingerprint,
  ClaudeRunner,
  judgeArgs,
  JudgeSessionContext,
  judgeSessionLinks,
  needsJudging,
  parseJudgeOutput,
  resolveLinks,
} from "../../src/linkJudge";

const CONTEXT: JudgeSessionContext = {
  title: "Spanish SODA",
  gitBranch: "feat/proj-1068-spanish-soda",
  cwd: "/repo/web-app",
  firstPrompt: "work on PROJ-1068",
};

function candidate(overrides: Partial<LinkCandidate> & Pick<LinkCandidate, "kind" | "id">): LinkCandidate {
  return {
    url: undefined,
    title: undefined,
    signals: {},
    snippets: [],
    firstSeen: undefined,
    lastSeen: undefined,
    ...overrides,
  };
}

const CREATED_PR = candidate({ kind: "pr", id: "acme/web-app/pull/2384", title: "PROJ-1068: Spanish SODA", signals: { "pr-created": 1 } });
const REVIEWED_PR = candidate({ kind: "pr", id: "acme/api/pull/77", signals: { "pr-link-record": 2, "pr-read": 1 } });
const NOISE_PR = candidate({ kind: "pr", id: "other/docs/pull/5", signals: { mention: 4 }, snippets: ["see other/docs for an example"] });

function cliEnvelope(structuredOutput: unknown): string {
  return JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(structuredOutput), structured_output: structuredOutput });
}

describe("buildJudgeDigest", () => {
  it("lists session context and every link id with its signals", () => {
    const digest = buildJudgeDigest(CONTEXT, [NOISE_PR, CREATED_PR]);

    expect(digest.text).toContain("Branch: feat/proj-1068-spanish-soda");
    expect(digest.text).toContain('- id: pr:acme/web-app/pull/2384 "PROJ-1068: Spanish SODA"\n  signals: pr-created x1');
    expect(digest.text).toContain("> see other/docs for an example");
    expect(digest.includedKeys).toEqual(["pr:acme/web-app/pull/2384", "pr:other/docs/pull/5"]);
  });

  it("stays under 8 KB by listing links bare first, then adding snippets", () => {
    const longSnippet = "x".repeat(190);
    const manyMentions = Array.from({ length: 200 }, (_, index) =>
      candidate({ kind: "pr", id: `noise/repo/pull/${index}`, signals: { mention: 1 }, snippets: [longSnippet, longSnippet] }),
    );
    const digest = buildJudgeDigest(CONTEXT, [...manyMentions, CREATED_PR]);

    expect(Buffer.byteLength(digest.text)).toBeLessThanOrEqual(8 * 1024);
    expect(digest.includedKeys[0]).toBe("pr:acme/web-app/pull/2384");
    expect(digest.includedKeys.length).toBeLessThan(201);
    expect(digest.text).toMatch(/more links omitted for space/);
  });
});

describe("judgeArgs", () => {
  it("runs headless without tools, settings, or a saved transcript", () => {
    const claudeArgs = judgeArgs("haiku");

    expect(claudeArgs).toEqual(expect.arrayContaining(["-p", "--no-session-persistence", "--strict-mcp-config", "--json-schema"]));
    expect(claudeArgs[claudeArgs.indexOf("--model") + 1]).toBe("haiku");
    expect(claudeArgs[claudeArgs.indexOf("--tools") + 1]).toBe("");
    expect(JSON.parse(claudeArgs[claudeArgs.indexOf("--settings") + 1])).toEqual({ alwaysThinkingEnabled: false });
  });

  it("sends the digest on stdin, not as an argument", async () => {
    const calls: { claudeArgs: string[]; stdinText: string }[] = [];
    await judgeSessionLinks(CONTEXT, [CREATED_PR], "haiku", async (claudeArgs, stdinText) => {
      calls.push({ claudeArgs, stdinText });
      return cliEnvelope({ links: [] });
    });

    expect(calls[0].stdinText).toContain("pr:acme/web-app/pull/2384");
    expect(calls[0].claudeArgs.join(" ")).not.toContain("acme/web-app");
  });
});

describe("parseJudgeOutput", () => {
  const includedKeys = ["pr:acme/web-app/pull/2384", "pr:acme/api/pull/77"];

  it("keeps a parentId only when it names another included link", () => {
    const verdicts = parseJudgeOutput(
      cliEnvelope({
        links: [
          { id: "pr:acme/web-app/pull/2384", role: "owned", stillRelevant: true, label: "", parentId: "pr:acme/api/pull/77" },
          { id: "pr:acme/api/pull/77", role: "touched", stillRelevant: true, label: "", parentId: "ticket:NOPE-1" },
        ],
      }),
      includedKeys,
    );
    expect(verdicts["pr:acme/web-app/pull/2384"].parentKey).toBe("pr:acme/api/pull/77");
    expect(verdicts["pr:acme/api/pull/77"]).not.toHaveProperty("parentKey");
  });

  it("reads structured_output and keeps only known ids", () => {
    const verdicts = parseJudgeOutput(
      cliEnvelope({
        links: [
          { id: "pr:acme/web-app/pull/2384", role: "owned", stillRelevant: true, label: "Spanish SODA" },
          { id: "pr:acme/api/pull/77", role: "touched", stillRelevant: false, label: "" },
          { id: "pr:made/up/pull/1", role: "owned", stillRelevant: true, label: "x" },
        ],
      }),
      includedKeys,
    );

    expect(verdicts).toEqual({
      "pr:acme/web-app/pull/2384": { role: "owned", stillRelevant: true, label: "Spanish SODA" },
      "pr:acme/api/pull/77": { role: "touched", stillRelevant: false, label: undefined },
    });
  });

  it("falls back to the result text when structured_output is missing", () => {
    const stdout = JSON.stringify({ is_error: false, result: JSON.stringify({ links: [{ id: "pr:acme/api/pull/77", role: "irrelevant", stillRelevant: true, label: "" }] }) });
    expect(parseJudgeOutput(stdout, includedKeys)["pr:acme/api/pull/77"]?.role).toBe("irrelevant");
  });

  it("marks every listed link the judge left out, or gave an unknown role, as irrelevant", () => {
    const verdicts = parseJudgeOutput(cliEnvelope({ links: [{ id: "pr:acme/api/pull/77", role: "mine", stillRelevant: true, label: "" }] }), includedKeys);
    expect(verdicts).toEqual({
      "pr:acme/web-app/pull/2384": { role: "irrelevant", stillRelevant: true, label: undefined },
      "pr:acme/api/pull/77": { role: "irrelevant", stillRelevant: true, label: undefined },
    });
  });

  it("throws on an error envelope or a missing links array", () => {
    expect(() => parseJudgeOutput(JSON.stringify({ is_error: true, result: "rate limited" }), includedKeys)).toThrow(/rate limited/);
    expect(() => parseJudgeOutput(cliEnvelope({ nope: [] }), includedKeys)).toThrow(/no links array/);
    expect(() => parseJudgeOutput("not json", includedKeys)).toThrow();
  });
});

describe("needsJudging", () => {
  it("re-judges only when the link set, signal kinds, or model change", async () => {
    const runClaude: ClaudeRunner = async () => cliEnvelope({ links: [] });
    const judgeEntry = await judgeSessionLinks(CONTEXT, [CREATED_PR], "haiku", runClaude);
    const moreOfTheSameSignal = { ...CREATED_PR, signals: { "pr-created": 3 } };
    const newSignalKind = { ...CREATED_PR, signals: { "pr-created": 1, "pr-write": 1 } };

    expect(needsJudging([], undefined, "haiku")).toBe(false);
    expect(needsJudging([CREATED_PR], undefined, "haiku")).toBe(true);
    expect(needsJudging([moreOfTheSameSignal], judgeEntry, "haiku")).toBe(false);
    expect(needsJudging([newSignalKind], judgeEntry, "haiku")).toBe(true);
    expect(needsJudging([CREATED_PR, REVIEWED_PR], judgeEntry, "haiku")).toBe(true);
    expect(needsJudging([CREATED_PR, NOISE_PR], judgeEntry, "haiku")).toBe(false);
    expect(needsJudging([NOISE_PR], undefined, "haiku")).toBe(false);
    expect(needsJudging([CREATED_PR], judgeEntry, "sonnet")).toBe(true);
  });

  it("fingerprints the same set the same way in any order", () => {
    expect(candidateFingerprint([CREATED_PR, NOISE_PR])).toBe(candidateFingerprint([NOISE_PR, CREATED_PR]));
  });
});

describe("resolveLinks", () => {
  it("keeps passive mentions out of the digest and hides them whatever the verdict", async () => {
    let digestText = "";
    const runClaude: ClaudeRunner = async (_claudeArgs, stdinText) => {
      digestText = stdinText;
      return cliEnvelope({ links: [{ id: "pr:other/docs/pull/5", role: "owned", stillRelevant: true, label: "" }] });
    };
    const judgeEntry = await judgeSessionLinks(CONTEXT, [CREATED_PR, NOISE_PR], "haiku", runClaude);
    const noiseLink = resolveLinks([CREATED_PR, NOISE_PR], judgeEntry).find((link) => link.id === NOISE_PR.id);

    expect(digestText).not.toContain(NOISE_PR.id);
    expect(noiseLink?.role).toBe("irrelevant");
  });

  it("uses verdicts for judged links and signal roles for links judged later, owned first", async () => {
    const runClaude: ClaudeRunner = async () =>
      cliEnvelope({ links: [{ id: "pr:acme/web-app/pull/2384", role: "owned", stillRelevant: true, label: "" }] });
    const judgeEntry = await judgeSessionLinks(CONTEXT, [REVIEWED_PR, CREATED_PR], "haiku", runClaude);
    const resolvedLinks = resolveLinks([REVIEWED_PR, NOISE_PR, CREATED_PR], judgeEntry);

    expect(resolvedLinks.map((link) => [link.id, link.role, link.judged])).toEqual([
      ["acme/web-app/pull/2384", "owned", true],
      ["acme/api/pull/77", "irrelevant", true],
      ["other/docs/pull/5", "irrelevant", false],
    ]);
    expect(resolvedLinks[0].label).toBe("PROJ-1068: Spanish SODA");
  });

  it("never lets the judge demote a link the signals prove owned", async () => {
    const judgeEntry = await judgeSessionLinks(CONTEXT, [CREATED_PR], "haiku", async () => cliEnvelope({ links: [] }));
    expect(resolveLinks([CREATED_PR], judgeEntry)[0]).toMatchObject({ role: "owned", judged: true });
  });

  it("keeps working with no judge entry at all", () => {
    expect(resolveLinks([REVIEWED_PR], undefined)[0]).toMatchObject({ role: "touched", stillRelevant: true, judged: false });
  });
});

describe("judge cache", () => {
  it("round-trips verdicts through the cache file", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-judge-"));
    const cacheFile = path.join(workDir, "nested", "session-link-verdicts.json");
    const judgeEntry = await judgeSessionLinks(CONTEXT, [CREATED_PR], "haiku", async () =>
      cliEnvelope({ links: [{ id: "pr:acme/web-app/pull/2384", role: "owned", stillRelevant: true, label: "SODA" }] }),
    );

    await saveJudgeCache(cacheFile, { "session-1": judgeEntry });

    expect(await loadJudgeCache(cacheFile)).toEqual({ "session-1": judgeEntry });
    fs.rmSync(workDir, { recursive: true, force: true });
  });
});
