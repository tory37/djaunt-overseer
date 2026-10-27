import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { seedAnalysis } from "../../src/analysisSeed";
import { emptyAnalysis } from "../../src/analysisState";
import { AnalyzerPassInput, AnalyzerPassPlan, planAnalyzerPass, runAnalyzerPass } from "../../src/analyzerPass";
import { digestEventsOf } from "../../src/analyzerDigest";
import { EnrichedCandidate } from "../../src/candidateEnrichment";
import { ClaudeRunner } from "../../src/claudeRunner";
import { StatusOption } from "../../src/sessionStatuses";
import { readCompleteLines, readLineEndingAt } from "../../src/transcriptLines";
import { emptyWorkstreamEdits, withLinkMarkRemovals } from "../../src/workstreamEdits";

const STATUS_OPTIONS: StatusOption[] = [
  { id: "in-progress", name: "In Progress", asksReason: false, done: false },
  { id: "human-review", name: "Human Review", asksReason: false, done: false },
  { id: "done", name: "Done", asksReason: false, done: true },
];
const API_PR = "pr:amira/soda-api/pull/41";
const WEB_PR = "pr:amira/soda-web/pull/87";

function candidate(kind: EnrichedCandidate["kind"], id: string, extra: Partial<EnrichedCandidate>): EnrichedCandidate {
  return { kind, id, url: undefined, title: undefined, signals: {}, snippets: [], firstSeen: undefined, lastSeen: undefined, ...extra };
}

// The Spanish SODA E2E session: the ticket went to Ready for QA, QA found a bug, and the fix spanned two repos with no ticket.
const SODA_CANDIDATES: EnrichedCandidate[] = [
  candidate("ticket", "SOA-310", { signals: { "ticket-write": 2 }, status: "Ready for QA", title: "Spanish SODA E2E", lastSeenOffsetBytes: 1200 }),
  candidate("pr", "amira/soda-api/pull/41", {
    signals: { "pr-created": 1 },
    title: "Fix Spanish SODA score retry",
    repo: "amira/soda-api",
    branch: "fix/soda-retry",
    status: "Open",
    lastSeenOffsetBytes: 6000,
    promptBeforeLastSeen: "QA found the retry bug, fix it in both repos",
  }),
  candidate("pr", "amira/soda-web/pull/87", {
    signals: { "pr-created": 1 },
    title: "Show retry state for Spanish SODA",
    repo: "amira/soda-web",
    branch: "fix/soda-retry",
    status: "Open",
    lastSeenOffsetBytes: 8000,
    promptBeforeLastSeen: "QA found the retry bug, fix it in both repos",
  }),
];

const SODA_OPS = {
  ops: [
    { op: "create_workstream", ref: "new-1", title: "Fix SODA retry bug from QA" },
    { op: "assign_item", item: API_PR, workstream: "new-1" },
    { op: "assign_item", item: WEB_PR, workstream: "new-1" },
    { op: "tag_ticket", ticket: "SOA-310", workstream: "new-1" },
    { op: "set_where", lines: ["SOA-310 in Ready for QA", "Retry fix PRs open in api and web"] },
    { op: "set_session_status", status: "human-review", done: false },
  ],
};

const MODELS = { model: "haiku", recheckModel: "sonnet" };
const DIFF_PLAN: AnalyzerPassPlan = { digestMode: "diff", model: "haiku", retryModel: "sonnet" };
const RECHECK_PLAN: AnalyzerPassPlan = { digestMode: "recheck", model: "sonnet", retryModel: undefined };

function envelope(output: unknown): string {
  return JSON.stringify({ type: "result", is_error: false, structured_output: output });
}

function passInput(overrides: Partial<AnalyzerPassInput> = {}): AnalyzerPassInput {
  return {
    plan: DIFF_PLAN,
    session: { title: "Spanish SODA E2E", gitBranch: "fix/soda-retry", cwd: "/src/soda-api" },
    analysis: emptyAnalysis(),
    edits: emptyWorkstreamEdits(),
    candidates: SODA_CANDIDATES,
    events: digestEventsOf([JSON.stringify({ type: "user", message: { content: "QA found the retry bug, fix it in both repos" } })]),
    overlapPrompt: undefined,
    statusOptions: STATUS_OPTIONS,
    transcriptEndBytes: 9000,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

function modelOf(claudeArgs: string[]): string {
  return claudeArgs[claudeArgs.indexOf("--model") + 1];
}

describe("runAnalyzerPass", () => {
  it("groups the SODA bug-fix PRs under one workstream tagged with the QA ticket", async () => {
    const digests: string[] = [];
    const runClaude: ClaudeRunner = async (_claudeArgs, stdinText) => {
      digests.push(stdinText);
      return envelope(SODA_OPS);
    };
    const firstPass = await runAnalyzerPass(passInput(), runClaude);
    expect(digests[0]).toContain('- ticket:SOA-310 | title "Spanish SODA E2E" | status Ready for QA');
    expect(digests[0]).toContain(`- ${WEB_PR} | title "Show retry state for Spanish SODA" | repo amira/soda-web`);
    expect(firstPass.model).toBe("haiku");
    expect(firstPass.analysis).toEqual({
      ...emptyAnalysis(),
      workstreams: [{ id: "ws-1", title: "Fix SODA retry bug from QA", ticketKeys: ["SOA-310"], itemKeys: [API_PR, WEB_PR], done: false }],
      where: ["SOA-310 in Ready for QA", "Retry fix PRs open in api and web"],
      sessionStatus: "human-review",
      watermarkBytes: 9000,
      lastPassAt: 1_700_000_000_000,
      lastModel: "haiku",
      nextWorkstreamNumber: 2,
    });

    const secondPass = await runAnalyzerPass(passInput({ analysis: firstPass.analysis }), runClaude);
    expect(secondPass.analysis).toEqual(firstPass.analysis);
    expect(digests[1]).toContain('- ws-1 "Fix SODA retry bug from QA" tickets: SOA-310');
  });

  it("rechecks a session seeded with one-per-ticket notes and still groups the bug-fix PRs on their own", async () => {
    const seededAnalysis = seedAnalysis({
      declaredTickets: [
        { key: "SOA-300", note: "Epic: Spanish SODA. In Progress.", addedAt: 1 },
        { key: "SOA-310", note: "Story: Spanish SODA E2E. Ready for QA.", parentKey: "SOA-300", addedAt: 2 },
        { key: "SOA-311", note: "Story: SODA manifests. To Do.", parentKey: "SOA-300", addedAt: 3 },
      ],
      work: { commits: [], pullRequests: [], artifacts: [] },
      where: undefined,
      linkMarks: { "ticket:SOA-311": "removed" },
    });
    const digests: string[] = [];
    const runClaude: ClaudeRunner = async (_claudeArgs, stdinText) => {
      digests.push(stdinText);
      return envelope({ ops: [...SODA_OPS.ops, { op: "tag_ticket", ticket: "SOA-311", workstream: "new-1" }] });
    };
    // The analyzer folds the live link marks into the edits; the pass itself reads only the edits.
    const edits = withLinkMarkRemovals(emptyWorkstreamEdits(), { "ticket:SOA-311": "removed" });
    const passResult = await runAnalyzerPass(passInput({ plan: RECHECK_PLAN, analysis: seededAnalysis, edits }), runClaude);
    expect(digests[0]).toContain("Current workstreams:\n(none)");
    expect(digests[0]).toContain('- ticket:SOA-310 "Story: Spanish SODA E2E. Ready for QA." | parent SOA-300');
    expect(digests[0]).not.toContain("ticket:SOA-311 \"");
    expect(passResult.analysis.workstreams).toEqual([
      { id: "ws-1", title: "Fix SODA retry bug from QA", ticketKeys: ["SOA-310"], itemKeys: [API_PR, WEB_PR], done: false },
    ]);
  });

  it("retries a diff on the recheck model when the reply fails the schema", async () => {
    const askedModels: string[] = [];
    const runClaude: ClaudeRunner = async (claudeArgs) => {
      askedModels.push(modelOf(claudeArgs));
      return modelOf(claudeArgs) === "haiku" ? envelope({ ops: [{ op: "bogus" }] }) : envelope(SODA_OPS);
    };
    const passResult = await runAnalyzerPass(passInput(), runClaude);
    expect(askedModels).toEqual(["haiku", "sonnet"]);
    expect(passResult.model).toBe("sonnet");
    expect(passResult.analysis.lastModel).toBe("sonnet");
    expect(passResult.analysis.workstreams).toHaveLength(1);
  });

  it("throws after the retry fails too, and never retries a recheck", async () => {
    const askedModels: string[] = [];
    const runClaude: ClaudeRunner = async (claudeArgs) => {
      askedModels.push(modelOf(claudeArgs));
      return "garbage";
    };
    await expect(runAnalyzerPass(passInput(), runClaude)).rejects.toThrow(/failed the schema/);
    await expect(runAnalyzerPass(passInput({ plan: RECHECK_PLAN }), runClaude)).rejects.toThrow(/failed the schema/);
    expect(askedModels).toEqual(["haiku", "sonnet", "sonnet"]);
  });
});

describe("recheck drop guard in runAnalyzerPass", () => {
  const OLD_PR = "pr:amira/soda-api/pull/30";
  const OLD_COMMIT = "commit:abc1234";
  const OLD_ARTIFACT = "artifact:soda-notes";
  const FIRST_PASS_PLAN: AnalyzerPassPlan = { digestMode: "recheck", model: "haiku", retryModel: "sonnet" };
  const sortedAnalysis = {
    ...emptyAnalysis(),
    workstreams: [
      { id: "ws-1", title: "Fix SODA retry bug from QA", ticketKeys: ["SOA-310"], itemKeys: [API_PR, WEB_PR], done: false },
      { id: "ws-2", title: "Old SODA scoring", ticketKeys: [], itemKeys: [OLD_PR], done: false },
      { id: "ws-3", title: "SODA cleanup", ticketKeys: [], itemKeys: [OLD_COMMIT], done: false },
      { id: "ws-4", title: "SODA notes", ticketKeys: [], itemKeys: [OLD_ARTIFACT], done: false },
    ],
    lastPassAt: 1,
    watermarkBytes: 5000,
    nextWorkstreamNumber: 5,
  };
  const FULL_RECHECK_OPS = {
    ops: [
      ...SODA_OPS.ops,
      { op: "create_workstream", ref: "new-2", title: "Old SODA scoring" },
      { op: "assign_item", item: OLD_PR, workstream: "new-2" },
      { op: "assign_item", item: OLD_COMMIT, workstream: "new-2" },
      { op: "assign_item", item: OLD_ARTIFACT, workstream: "new-2" },
    ],
  };

  it("passes a first pass through, since nothing was sorted before", async () => {
    const passResult = await runAnalyzerPass(passInput({ plan: RECHECK_PLAN }), async () => envelope(SODA_OPS));
    expect(passResult.analysis.workstreams).toHaveLength(1);
  });

  it("keeps a recheck that sorts every item again", async () => {
    const passResult = await runAnalyzerPass(passInput({ plan: RECHECK_PLAN, analysis: sortedAnalysis }), async () => envelope(FULL_RECHECK_OPS));
    expect(passResult.analysis.workstreams.flatMap((workstream) => workstream.itemKeys)).toEqual([API_PR, WEB_PR, OLD_PR, OLD_COMMIT, OLD_ARTIFACT]);
  });

  it("fails a recheck that drops most workstreams and never retries it", async () => {
    const askedModels: string[] = [];
    const runClaude: ClaudeRunner = async (claudeArgs) => {
      askedModels.push(modelOf(claudeArgs));
      return envelope(SODA_OPS);
    };
    await expect(runAnalyzerPass(passInput({ plan: RECHECK_PLAN, analysis: sortedAnalysis }), runClaude)).rejects.toThrow(
      "recheck dropped 3 of 6 items; kept the previous grouping",
    );
    expect(askedModels).toEqual(["sonnet"]);
  });

  it("retries a dropping recheck from the diff model on the recheck model", async () => {
    const askedModels: string[] = [];
    const runClaude: ClaudeRunner = async (claudeArgs) => {
      askedModels.push(modelOf(claudeArgs));
      return modelOf(claudeArgs) === "haiku" ? envelope(SODA_OPS) : envelope(FULL_RECHECK_OPS);
    };
    const passResult = await runAnalyzerPass(passInput({ plan: FIRST_PASS_PLAN, analysis: sortedAnalysis }), runClaude);
    expect(askedModels).toEqual(["haiku", "sonnet"]);
    expect(passResult.model).toBe("sonnet");
    expect(passResult.analysis.workstreams.flatMap((workstream) => workstream.itemKeys)).toHaveLength(5);
  });

  it("fails when the retry drops items too", async () => {
    await expect(runAnalyzerPass(passInput({ plan: FIRST_PASS_PLAN, analysis: sortedAnalysis }), async () => envelope(SODA_OPS))).rejects.toThrow(
      "recheck dropped 3 of 6 items",
    );
  });

  it("leaves diff passes alone", async () => {
    const unsortOps = [OLD_PR, OLD_COMMIT, OLD_ARTIFACT].map((item) => ({ op: "assign_item", item, workstream: "" }));
    const passResult = await runAnalyzerPass(passInput({ plan: DIFF_PLAN, analysis: sortedAnalysis }), async () => envelope({ ops: unsortOps }));
    expect(passResult.analysis.workstreams.flatMap((workstream) => workstream.itemKeys)).toEqual([API_PR, WEB_PR]);
  });
});

describe("planAnalyzerPass", () => {
  const analyzedBefore = { ...emptyAnalysis(), lastPassAt: 1, watermarkBytes: 5000 };

  it("gives a session's first auto or Update now pass a recheck digest on the diff model", () => {
    expect(planAnalyzerPass("diff", emptyAnalysis(), MODELS)).toEqual({ digestMode: "recheck", model: "haiku", retryModel: "sonnet" });
    expect(planAnalyzerPass("diff", { ...emptyAnalysis(), watermarkBytes: 5000 }, MODELS).digestMode).toBe("recheck");
  });

  it("gives a later pass a diff digest", () => {
    expect(planAnalyzerPass("diff", analyzedBefore, MODELS)).toEqual(DIFF_PLAN);
  });

  it("keeps a diff digest for a /clear copy that has workstreams but no watermark", () => {
    const copiedAnalysis = {
      ...analyzedBefore,
      watermarkBytes: 0,
      workstreams: [{ id: "ws-1", title: "Fix SODA retry bug", ticketKeys: [], itemKeys: [API_PR], done: false }],
    };
    expect(planAnalyzerPass("diff", copiedAnalysis, MODELS).digestMode).toBe("diff");
  });

  it("keeps the recheck model for the Recheck button, first pass or not", () => {
    expect(planAnalyzerPass("recheck", emptyAnalysis(), MODELS)).toEqual(RECHECK_PLAN);
    expect(planAnalyzerPass("recheck", analyzedBefore, MODELS)).toEqual(RECHECK_PLAN);
  });

  it("runs a first pass on haiku with the whole-transcript digest", async () => {
    const asked: { model: string; digest: string }[] = [];
    const runClaude: ClaudeRunner = async (claudeArgs, stdinText) => {
      asked.push({ model: modelOf(claudeArgs), digest: stdinText });
      return envelope(SODA_OPS);
    };
    await runAnalyzerPass(passInput({ plan: planAnalyzerPass("diff", emptyAnalysis(), MODELS) }), runClaude);
    expect(asked).toHaveLength(1);
    expect(asked[0].model).toBe("haiku");
    expect(asked[0].digest).toContain("Pass: recheck");
    expect(asked[0].digest).toContain("Whole transcript, oldest first (times are UTC):");
  });
});

describe("transcript lines", () => {
  it("reads one earlier line back from its end offset", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "overseer-lines-"));
    const file = path.join(dir, "t.jsonl");
    fs.writeFileSync(file, "first line\nsecond line\nthird");
    try {
      const lines = [];
      for await (const line of readCompleteLines(file, 0)) {
        lines.push(line);
      }
      expect(lines).toEqual([
        { line: "first line", endOffsetBytes: 11 },
        { line: "second line", endOffsetBytes: 23 },
      ]);
      expect(await readLineEndingAt(file, 23, 1024)).toBe("second line");
      expect(await readLineEndingAt(file, 11, 1024)).toBe("first line");
      expect(await readLineEndingAt(file, 23, 5)).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
