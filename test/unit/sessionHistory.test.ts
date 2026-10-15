import { describe, expect, it } from "vitest";
import { SessionMeta } from "../../src/indexer";
import { deletionCandidates, HistoryQuery, historyRow, HistoryRowContext, matchingSessionIds, newestFirst } from "../../src/sessionHistory";

function sessionMeta(sessionId: string, overrides: Partial<SessionMeta>): SessionMeta {
  return {
    sessionId,
    transcriptFile: `/tmp/${sessionId}.jsonl`,
    startCwd: "/src/web",
    resumeCwd: "/src/web",
    gitBranch: undefined,
    firstPrompt: undefined,
    customTitle: undefined,
    agentName: undefined,
    aiTitle: undefined,
    prUrl: undefined,
    lastPrompt: undefined,
    recap: undefined,
    homeRepo: "/src/web",
    otherReposTouched: [],
    commitHashes: [],
    lastActivityMs: 0,
    sizeBytes: 0,
    ...overrides,
  };
}

const PLAIN_CONTEXT: HistoryRowContext = { label: undefined, isPinned: false, liveState: undefined, status: undefined };

function query(overrides: Partial<HistoryQuery>): HistoryQuery {
  return { searchText: "", scope: "all", repoName: undefined, olderThanDays: undefined, nowMs: 0, ...overrides };
}

describe("session history", () => {
  const rows = [
    historyRow(sessionMeta("a", { aiTitle: "Fix login bug", lastPrompt: "add a retry", lastActivityMs: 10 }), PLAIN_CONTEXT),
    historyRow(sessionMeta("b", { firstPrompt: "draft release notes", otherReposTouched: ["/src/api"], lastActivityMs: 30 }), {
      ...PLAIN_CONTEXT,
      isPinned: true,
    }),
    historyRow(sessionMeta("c", { resumeCwd: "/src/api", homeRepo: "/src/api", gitBranch: "feat/retry", lastActivityMs: 20 }), {
      ...PLAIN_CONTEXT,
      label: "Renamed",
      liveState: "busy",
    }),
  ];

  it("titles a row by its label first", () => {
    expect(rows.map((row) => row.title)).toEqual(["Fix login bug", "draft release notes", "Renamed"]);
  });

  it("needs every term to match some field, in any case", () => {
    expect(matchingSessionIds(rows, query({ searchText: "RETRY" }))).toEqual(["a", "c"]);
    expect(matchingSessionIds(rows, query({ searchText: "retry login" }))).toEqual(["a"]);
  });

  it("matches repo: against every repo a session touched", () => {
    expect(matchingSessionIds(rows, query({ searchText: "repo:api" }))).toEqual(["b", "c"]);
    expect(matchingSessionIds(rows, query({ searchText: "repo:api notes" }))).toEqual(["b"]);
  });

  it("filters by scope and by exact repo name", () => {
    expect(matchingSessionIds(rows, query({ scope: "pinned" }))).toEqual(["b"]);
    expect(matchingSessionIds(rows, query({ scope: "live" }))).toEqual(["c"]);
    expect(matchingSessionIds(rows, query({ repoName: "web" }))).toEqual(["a", "b"]);
  });

  it("keeps only sessions idle longer than the cutoff", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    expect(matchingSessionIds(rows, query({ olderThanDays: 1, nowMs: dayMs + 25 }))).toEqual(["a", "c"]);
  });

  it("never offers a live session for deletion, and spares pinned ones only in a purge", () => {
    expect(deletionCandidates(rows, ["a", "b", "c", "gone"], true)).toEqual({ deletableIds: ["a"], pinnedIds: ["b"], liveIds: ["c"] });
    expect(deletionCandidates(rows, ["b"], false).deletableIds).toEqual(["b"]);
  });

  it("sorts newest first", () => {
    expect(newestFirst(rows).map((row) => row.sessionId)).toEqual(["b", "c", "a"]);
  });
});
