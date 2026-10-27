import { describe, expect, it } from "vitest";
import { emptyAnalysis, SessionAnalysis } from "../../src/analysisState";
import {
  AnalyzerDigestInput,
  buildAnalyzerDigest,
  compactTimestamp,
  DIFF_DIGEST_BYTES,
  digestEventsOf,
  RECHECK_DIGEST_BYTES,
} from "../../src/analyzerDigest";
import { EnrichedCandidate } from "../../src/candidateEnrichment";
import { emptyWorkstreamEdits } from "../../src/workstreamEdits";

function userLine(content: unknown): string {
  return JSON.stringify({ type: "user", message: { content } });
}

function assistantLine(content: unknown[]): string {
  return JSON.stringify({ type: "assistant", message: { content } });
}

function candidate(kind: EnrichedCandidate["kind"], id: string, lastSeenOffsetBytes: number, extra: Partial<EnrichedCandidate> = {}): EnrichedCandidate {
  return {
    kind,
    id,
    url: undefined,
    title: undefined,
    signals: { "pr-created": 1 },
    snippets: [],
    firstSeen: undefined,
    lastSeen: undefined,
    lastSeenOffsetBytes,
    ...extra,
  };
}

function digestInput(overrides: Partial<AnalyzerDigestInput> = {}): AnalyzerDigestInput {
  return {
    mode: "diff",
    session: { title: "SODA E2E", gitBranch: "main", cwd: "/repo" },
    analysis: emptyAnalysis(),
    edits: emptyWorkstreamEdits(),
    candidates: [],
    events: [],
    overlapPrompt: undefined,
    statusOptions: [{ id: "done", name: "Done", asksReason: false, done: true }],
    transcriptEndBytes: 5000,
    ...overrides,
  };
}

describe("digestEventsOf", () => {
  it("keeps prompts, short assistant text, one-line tool calls, and evidence results", () => {
    const events = digestEventsOf([
      userLine("fix the retry bug <system-reminder>noise</system-reminder>"),
      assistantLine([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/repo/a.ts" } }]),
      userLine([{ type: "tool_result", tool_use_id: "t1", content: "file body that should not show" }]),
      assistantLine([{ type: "tool_use", id: "t2", name: "Bash", input: { command: 'git commit -m "Fix retry"' } }]),
      userLine([{ type: "tool_result", tool_use_id: "t2", content: "[main abc1234] Fix retry" }]),
      assistantLine([{ type: "text", text: "Committed." }]),
      JSON.stringify({ type: "user", isMeta: true, message: { content: "skill body" } }),
      "not json",
    ]);
    expect(events.map((event) => [event.text, event.isEvidence])).toEqual([
      ["User: fix the retry bug", false],
      ["Ran: Read /repo/a.ts", false],
      ['Ran: git commit -m "Fix retry"', true],
      ["Result: [main abc1234] Fix retry", true],
      ["Claude: Committed.", false],
    ]);
  });
});

describe("compactTimestamp", () => {
  it("gives date plus hh:mm in UTC and nothing for a value that is not a time", () => {
    expect(compactTimestamp("2026-10-26T14:56:31.123Z")).toBe("2026-10-26 14:56");
    expect(compactTimestamp("not a time")).toBeUndefined();
    expect(compactTimestamp(42)).toBeUndefined();
    expect(compactTimestamp(undefined)).toBeUndefined();
  });
});

describe("buildAnalyzerDigest", () => {
  it("keeps old user prompts ahead of evidence, so the timeline survives a long session", () => {
    const evidence = Array.from({ length: 200 }, (_, index) =>
      assistantLine([{ type: "tool_use", id: `e${index}`, name: "Bash", input: { command: `gh pr view ${index} ${"z".repeat(200)}` } }]),
    );
    const readyForQa = JSON.stringify({ type: "user", message: { content: "move the tickets to ready for qa" }, timestamp: "2026-10-23T19:38:00Z" });
    const digest = buildAnalyzerDigest(digestInput({ events: digestEventsOf([readyForQa, ...evidence]) }));
    expect(digest.text).toContain("User [2026-10-23 19:38]: move the tickets to ready for qa");
  });

  it("returns the transcript end as the new watermark", () => {
    expect(buildAnalyzerDigest(digestInput({ transcriptEndBytes: 1234 })).watermarkBytes).toBe(1234);
  });

  it("caps a diff at 16 KB and a recheck at 64 KB, keeping evidence first", () => {
    const chatter = Array.from({ length: 2000 }, (_, index) => userLine(`message ${index} ${"x".repeat(300)}`));
    const lines = [assistantLine([{ type: "tool_use", id: "c1", name: "Bash", input: { command: "gh pr create --title Fix" } }]), ...chatter];
    const events = digestEventsOf(lines);
    const diffDigest = buildAnalyzerDigest(digestInput({ events }));
    const recheckDigest = buildAnalyzerDigest(digestInput({ events, mode: "recheck" }));
    expect(Buffer.byteLength(diffDigest.text)).toBeLessThanOrEqual(DIFF_DIGEST_BYTES);
    expect(Buffer.byteLength(recheckDigest.text)).toBeLessThanOrEqual(RECHECK_DIGEST_BYTES);
    expect(Buffer.byteLength(recheckDigest.text)).toBeGreaterThan(DIFF_DIGEST_BYTES);
    expect(diffDigest.text).toContain("Ran: gh pr create --title Fix");
    expect(diffDigest.text).toContain("message 1999");
    expect(diffDigest.text).not.toContain("message 0 ");
  });

  it("caps the item list and still leaves room for the transcript", () => {
    const candidates = Array.from({ length: 400 }, (_, index) =>
      candidate("commit", `c${String(index).padStart(6, "0")}`, 4000, { title: `commit ${index} ${"y".repeat(80)}` }),
    );
    const digest = buildAnalyzerDigest(digestInput({ candidates, events: digestEventsOf([userLine("the latest ask")]) }));
    expect(Buffer.byteLength(digest.text)).toBeLessThanOrEqual(DIFF_DIGEST_BYTES);
    expect(digest.itemKeys.length).toBeGreaterThan(0);
    expect(digest.itemKeys.length).toBeLessThan(400);
    expect(digest.text).toMatch(/more items omitted/);
    expect(digest.text).toContain("User: the latest ask");
  });

  it("shows new and unsorted items on a diff, every item on a recheck, and never removed or passive ones", () => {
    const analysis: SessionAnalysis = {
      ...emptyAnalysis(),
      watermarkBytes: 1000,
      workstreams: [{ id: "ws-1", title: "Old fix", ticketKeys: ["SOA-1"], itemKeys: ["pr:a/b/pull/1"], done: false }],
    };
    const candidates = [
      candidate("pr", "a/b/pull/1", 500, { title: "Old PR" }),
      candidate("pr", "a/b/pull/2", 2000, { title: "New PR", repo: "a/b", status: "Open" }),
      candidate("pr", "a/b/pull/3", 400, { title: "Unsorted PR" }),
      candidate("ticket", "SOA-1", 300),
      candidate("pr", "a/b/pull/4", 3000, { title: "Removed PR" }),
      candidate("pr", "x/y/pull/5", 3000, { signals: { mention: 2 } }),
    ];
    const edits = { ...emptyWorkstreamEdits(), removedItems: ["pr:a/b/pull/4"] };
    const diffDigest = buildAnalyzerDigest(digestInput({ analysis, candidates, edits }));
    expect(diffDigest.itemKeys).toEqual(["pr:a/b/pull/3", "pr:a/b/pull/2"]);
    expect(diffDigest.text).toContain('- ws-1 "Old fix" tickets: SOA-1');
    expect(diffDigest.text).toContain('  - pr:a/b/pull/1 "Old PR"');
    expect(diffDigest.text).toContain('- pr:a/b/pull/2 | title "New PR" | repo a/b | status Open');
    expect(diffDigest.text).toContain("Removed by the user, never assign or tag: pr:a/b/pull/4");
    const recheckDigest = buildAnalyzerDigest(digestInput({ analysis, candidates, edits, mode: "recheck" }));
    expect([...recheckDigest.itemKeys].sort()).toEqual(["pr:a/b/pull/1", "pr:a/b/pull/2", "pr:a/b/pull/3", "ticket:SOA-1"]);
  });

  it("marks user locks as fixed and lists the allowed statuses", () => {
    const analysis: SessionAnalysis = {
      ...emptyAnalysis(),
      workstreams: [{ id: "ws-1", title: "Mine", ticketKeys: [], itemKeys: ["pr:a/b/pull/1"], done: false }],
    };
    const edits = { ...emptyWorkstreamEdits(), workstreamTitles: { "ws-1": "Mine" }, pinnedItems: { "pr:a/b/pull/1": "ws-1" }, sessionStatus: "done" };
    const digest = buildAnalyzerDigest(digestInput({ analysis, edits }));
    expect(digest.text).toContain('- ws-1 "Mine" [title fixed by user]');
    expect(digest.text).toContain("  - pr:a/b/pull/1 [fixed by user]");
    expect(digest.text).toContain("Session status: (none), done: no [fixed by user]");
    expect(digest.text).toContain('- done "Done" (means done)');
  });

  it("gives each artifact its title, description, and user prompt as separate fields", () => {
    const testPlan = candidate("artifact", "plan-1", 4000, {
      signals: { "artifact-published": 1 },
      title: "Spanish SODA Local E2E",
      description: "Local-stack end-to-end test plan for Spanish SODA.",
      promptBeforeFirstSeen: "lets run a final validation end to end",
      promptBeforeLastSeen: "lets run a final validation end to end",
    });
    const digest = buildAnalyzerDigest(digestInput({ candidates: [testPlan] }));
    expect(digest.text).toContain(
      '- artifact:plan-1 | title "Spanish SODA Local E2E"\n' +
        "  description: Local-stack end-to-end test plan for Spanish SODA.\n" +
        "  user prompt when first seen: lets run a final validation end to end",
    );
  });

  it("shows seed facts as background, always shows kept items, and lets the model place known items", () => {
    const analysis: SessionAnalysis = {
      ...emptyAnalysis(),
      seedFacts: {
        knownItems: [{ itemKey: "ticket:SOA-1", note: "Story: retry bug", parentKey: "SOA-0" }, { itemKey: "commit:abc1234" }],
        keptItemKeys: ["pr:x/y/pull/5"],
        removedItemKeys: [],
      },
    };
    const candidates = [candidate("pr", "x/y/pull/5", 3000, { signals: { mention: 2 } })];
    const digest = buildAnalyzerDigest(digestInput({ analysis, candidates }));
    expect(digest.text).toContain('Background facts from earlier notes, not workstreams:\n- ticket:SOA-1 "Story: retry bug" | parent SOA-0\n- commit:abc1234');
    expect(digest.text).toContain("Kept by the user, always place them: pr:x/y/pull/5");
    expect(digest.text).toContain("- pr:x/y/pull/5 | kept by user");
    expect(digest.itemKeys).toEqual(["pr:x/y/pull/5", "ticket:SOA-1", "commit:abc1234"]);
  });

  it("includes the overlap prompt on a diff", () => {
    const digest = buildAnalyzerDigest(digestInput({ overlapPrompt: "should we fix both repos?" }));
    expect(digest.text).toContain("The last user prompt before this diff, for context:\nUser: should we fix both repos?");
  });
});
