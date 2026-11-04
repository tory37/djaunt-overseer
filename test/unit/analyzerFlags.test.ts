import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  AnalyzerDecision,
  AnalyzerFlagInput,
  analyzerFlagRecordOf,
  analyzerFlagsFile,
  flagJsonLine,
  MAX_RECENT_DECISIONS,
  recentUsageOf,
  withDecision,
} from "../../src/analyzerFlags";
import { DEFAULT_ANALYZER_GATE_SETTINGS } from "../../src/analyzerGates";
import { emptyAnalysis, SessionAnalysis } from "../../src/analysisState";
import { AnalyzerUsageRecord } from "../../src/analyzerUsage";

const AT_MS = Date.parse("2026-11-03T10:00:00.000Z");
const LAST_PASS_MS = Date.parse("2026-11-03T09:40:00.000Z");

function decision(reason: string): AnalyzerDecision {
  return { at: "2026-11-03T09:00:00.000Z", trigger: "auto", verdict: "skip", reason };
}

function usageRecord(sessionId: string, costUsd: number): AnalyzerUsageRecord {
  return {
    at: "2026-11-03T09:40:00.000Z",
    sessionId,
    requestedMode: "diff",
    digestMode: "diff",
    model: "haiku",
    passOutcome: "updated",
    digestBytes: 12_000,
    costUsd,
  };
}

const ANALYSIS: SessionAnalysis = {
  ...emptyAnalysis(),
  workstreams: [
    { id: "ws-1", title: "Fix login retry", ticketKeys: ["ABC-12"], itemKeys: ["pr:acme/app/pull/7", "commit:abc1234"], done: false },
    { id: "ws-2", title: "Release 0.0.20", ticketKeys: [], itemKeys: [], done: true },
  ],
  where: ["PR 7 waits on review"],
  watermarkBytes: 40_960,
  lastPassAt: LAST_PASS_MS,
  lastModel: "haiku",
};

const FULL_INPUT: AnalyzerFlagInput = {
  at: AT_MS,
  sessionId: "s1",
  title: "Login retry",
  note: "PR 7 merged but the work still shows open",
  liveStatus: "idle",
  shownTitle: { text: "Login retry", source: "analyzer" },
  isTitleLocked: false,
  status: { name: "In review", isDerived: true },
  analysis: ANALYSIS,
  transcriptBytes: 61_440,
  gate: { run: false, reason: "cooldown, 120s left", newBytes: 20_480, newUserPromptCount: 2, hasNewCandidate: true },
  settings: DEFAULT_ANALYZER_GATE_SETTINGS,
  models: { model: "haiku", recheckModel: "sonnet" },
  recentDecisions: [{ at: "2026-11-03T09:58:00.000Z", trigger: "auto", verdict: "skip", reason: "cooldown, 120s left" }],
  recentUsage: [usageRecord("s1", 0.012)],
};

describe("withDecision", () => {
  it("appends the decision as the newest", () => {
    expect(withDecision([decision("a")], decision("b")).map((entry) => entry.reason)).toEqual(["a", "b"]);
  });

  it("drops the oldest once the ring is full", () => {
    const fullRing = Array.from({ length: MAX_RECENT_DECISIONS }, (_, index) => decision(`d${index}`));
    const nextRing = withDecision(fullRing, decision("new"));
    expect(nextRing).toHaveLength(MAX_RECENT_DECISIONS);
    expect(nextRing[0].reason).toBe("d1");
    expect(nextRing[MAX_RECENT_DECISIONS - 1].reason).toBe("new");
  });

  it("leaves the old ring unchanged", () => {
    const oldRing = [decision("a")];
    withDecision(oldRing, decision("b"));
    expect(oldRing).toHaveLength(1);
  });
});

describe("recentUsageOf", () => {
  it("keeps the last 5 rows for the session, oldest first", () => {
    const rows = [1, 2, 3, 4, 5, 6].map((count) => usageRecord("s1", count / 100));
    const text = [...rows.slice(0, 3), usageRecord("other", 9), ...rows.slice(3)].map((row) => JSON.stringify(row)).join("\n");
    expect(recentUsageOf(`${text}\n`, "s1").map((row) => row.costUsd)).toEqual([0.02, 0.03, 0.04, 0.05, 0.06]);
  });

  it("skips lines that don't parse or aren't objects", () => {
    const text = ['"sessionId":"s1"}', "not json", "42", "null", JSON.stringify(usageRecord("s1", 0.5))].join("\n");
    expect(recentUsageOf(text, "s1").map((row) => row.costUsd)).toEqual([0.5]);
  });

  it("finds nothing in an empty file", () => {
    expect(recentUsageOf("", "s1")).toEqual([]);
  });
});

describe("analyzerFlagRecordOf", () => {
  it("flattens the shown data, analysis, gate, and settings into one record", () => {
    expect(analyzerFlagRecordOf(FULL_INPUT)).toEqual({
      at: "2026-11-03T10:00:00.000Z",
      sessionId: "s1",
      title: "Login retry",
      note: "PR 7 merged but the work still shows open",
      liveStatus: "idle",
      shown: {
        title: { text: "Login retry", source: "analyzer", isLocked: false },
        status: { name: "In review", isDerived: true },
        now: ["PR 7 waits on review"],
        workstreams: [
          { id: "ws-1", title: "Fix login retry", done: false, itemKeys: ["pr:acme/app/pull/7", "commit:abc1234"], ticketKeys: ["ABC-12"] },
          { id: "ws-2", title: "Release 0.0.20", done: true, itemKeys: [], ticketKeys: [] },
        ],
      },
      analysis: { lastPassAt: "2026-11-03T09:40:00.000Z", lastModel: "haiku", watermarkBytes: 40_960, transcriptBytes: 61_440 },
      gate: { run: false, reason: "cooldown, 120s left", newBytes: 20_480, newUserPromptCount: 2, hasNewCandidate: true },
      settings: { ...DEFAULT_ANALYZER_GATE_SETTINGS, model: "haiku", recheckModel: "sonnet" },
      recentDecisions: FULL_INPUT.recentDecisions,
      recentUsage: FULL_INPUT.recentUsage,
    });
  });

  it("omits what is missing and says none for a session not running", () => {
    const record = analyzerFlagRecordOf({
      at: AT_MS,
      sessionId: "s2",
      title: "New session",
      settings: DEFAULT_ANALYZER_GATE_SETTINGS,
      models: { model: "haiku", recheckModel: "sonnet" },
      recentDecisions: [],
    });
    expect(record).toEqual({
      at: "2026-11-03T10:00:00.000Z",
      sessionId: "s2",
      title: "New session",
      liveStatus: "none",
      shown: { now: [], workstreams: [] },
      settings: { ...DEFAULT_ANALYZER_GATE_SETTINGS, model: "haiku", recheckModel: "sonnet" },
      recentDecisions: [],
    });
  });

  it("records a locked title as locked", () => {
    const record = analyzerFlagRecordOf({ ...FULL_INPUT, shownTitle: { text: "PROJ-7", source: "locked" }, isTitleLocked: true });
    expect(record.shown.title).toEqual({ text: "PROJ-7", source: "locked", isLocked: true });
  });

  it("drops an empty note", () => {
    expect(analyzerFlagRecordOf({ ...FULL_INPUT, note: "  " }).note).toBeUndefined();
  });

  it("omits lastPassAt and lastModel when no pass has run", () => {
    const record = analyzerFlagRecordOf({ ...FULL_INPUT, analysis: emptyAnalysis(), transcriptBytes: undefined });
    expect(record.analysis).toEqual({ watermarkBytes: 0 });
  });
});

describe("flagJsonLine", () => {
  it("writes one line that parses back to the record", () => {
    const record = analyzerFlagRecordOf(FULL_INPUT);
    const line = flagJsonLine(record);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(line)).toEqual(record);
  });
});

describe("analyzerFlagsFile", () => {
  it("lives in the overseer folder under the Claude home", () => {
    expect(analyzerFlagsFile("/home/u/.claude")).toBe(path.join("/home/u/.claude", "overseer", "analyzer-flags.jsonl"));
  });
});
