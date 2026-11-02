import * as path from "path";
import { describe, expect, it } from "vitest";
import { AnalyzerCall } from "../../src/analyzerPass";
import { analyzerUsageFile, AnalyzerUsageRecord, usageJsonLines, usageLogLine, usageRecordsOf } from "../../src/analyzerUsage";

const AT_MS = Date.parse("2026-11-02T15:04:05.000Z");
const DIFF_CALL: AnalyzerCall = {
  model: "haiku",
  digestMode: "diff",
  digestBytes: 14_540,
  usage: { costUsd: 0.0123, inputTokens: 7812, outputTokens: 310, cacheReadTokens: 2048, cacheWriteTokens: 512 },
};
const RETRY_CALL: AnalyzerCall = { model: "sonnet", digestMode: "diff", digestBytes: 14_540, usage: { costUsd: 0.05 } };
const UNKNOWN_CALL: AnalyzerCall = { model: "sonnet", digestMode: "recheck", digestBytes: 2_000, usage: undefined };

describe("usageRecordsOf", () => {
  it("makes one record per call, in call order, with the pass fields", () => {
    const records = usageRecordsOf({ at: AT_MS, sessionId: "s1", requestedMode: "diff", passOutcome: "updated", calls: [DIFF_CALL, RETRY_CALL] });
    expect(records).toEqual([
      {
        at: "2026-11-02T15:04:05.000Z",
        sessionId: "s1",
        requestedMode: "diff",
        digestMode: "diff",
        model: "haiku",
        passOutcome: "updated",
        digestBytes: 14_540,
        costUsd: 0.0123,
        inputTokens: 7812,
        outputTokens: 310,
        cacheReadTokens: 2048,
        cacheWriteTokens: 512,
      },
      {
        at: "2026-11-02T15:04:05.000Z",
        sessionId: "s1",
        requestedMode: "diff",
        digestMode: "diff",
        model: "sonnet",
        passOutcome: "updated",
        digestBytes: 14_540,
        costUsd: 0.05,
      },
    ]);
  });

  it("omits every usage field when the call has no usage", () => {
    const [record] = usageRecordsOf({ at: AT_MS, sessionId: "s2", requestedMode: "diff", passOutcome: "failed", calls: [UNKNOWN_CALL] });
    expect(Object.keys(record).sort()).toEqual(["at", "digestBytes", "digestMode", "model", "passOutcome", "requestedMode", "sessionId"]);
    expect(record.digestMode).toBe("recheck");
    expect(record.passOutcome).toBe("failed");
  });

  it("makes no records for no calls", () => {
    expect(usageRecordsOf({ at: AT_MS, sessionId: "s3", requestedMode: "recheck", passOutcome: "failed", calls: [] })).toEqual([]);
  });
});

describe("usageJsonLines", () => {
  it("writes one JSON value per line that parses back to the records", () => {
    const records = usageRecordsOf({ at: AT_MS, sessionId: "s1", requestedMode: "diff", passOutcome: "updated", calls: [DIFF_CALL, UNKNOWN_CALL] });
    const text = usageJsonLines(records);
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.split("\n").slice(0, -1);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line) as AnalyzerUsageRecord)).toEqual(records);
  });

  it("writes nothing for no records", () => {
    expect(usageJsonLines([])).toBe("");
  });
});

describe("usageLogLine", () => {
  it("shows model, digest mode, size, tokens, and cost", () => {
    const [record] = usageRecordsOf({ at: AT_MS, sessionId: "s1", requestedMode: "diff", passOutcome: "updated", calls: [DIFF_CALL] });
    expect(usageLogLine(record)).toBe("haiku diff 14.2 KB in 10,372 out 310 $0.0123");
  });

  it("counts cache writes as input, since a cached prompt puts nearly all of it there", () => {
    const cachedCall: AnalyzerCall = {
      model: "haiku",
      digestMode: "diff",
      digestBytes: 16_316,
      usage: { costUsd: 0.018564, inputTokens: 3, outputTokens: 517, cacheReadTokens: 0, cacheWriteTokens: 7988 },
    };
    const [record] = usageRecordsOf({ at: AT_MS, sessionId: "s1", requestedMode: "diff", passOutcome: "updated", calls: [cachedCall] });
    expect(usageLogLine(record)).toBe("haiku diff 15.9 KB in 7,991 out 517 $0.0186");
  });

  it("says cost unknown when the call has no usage", () => {
    const [record] = usageRecordsOf({ at: AT_MS, sessionId: "s1", requestedMode: "diff", passOutcome: "failed", calls: [UNKNOWN_CALL] });
    expect(usageLogLine(record)).toBe("sonnet recheck 2.0 KB cost unknown");
  });

  it("shows the cost alone when token counts are missing", () => {
    const [record] = usageRecordsOf({ at: AT_MS, sessionId: "s1", requestedMode: "diff", passOutcome: "updated", calls: [RETRY_CALL] });
    expect(usageLogLine(record)).toBe("sonnet diff 14.2 KB $0.0500");
  });
});

describe("analyzerUsageFile", () => {
  it("lives in the overseer folder under the Claude home", () => {
    expect(analyzerUsageFile("/home/u/.claude")).toBe(path.join("/home/u/.claude", "overseer", "analyzer-usage.jsonl"));
  });
});
