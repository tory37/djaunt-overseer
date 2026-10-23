import { describe, expect, it } from "vitest";
import { DeclaredTicket } from "../../src/agentTickets";
import { EMPTY_SESSION_WORK, SessionWork } from "../../src/agentWork";
import { PopulateResult } from "../../src/populateDigest";
import { mergePopulateResult, PopulateMergeInput } from "../../src/populateMerge";

const PR_URL = "https://github.com/o/r/pull/7";
const NEW_PR_URL = "https://github.com/o/r/pull/8";
const ARTIFACT_URL = "https://claude.ai/artifact/abc-1";

const SAVED_TICKETS: DeclaredTicket[] = [{ key: "PROJ-1", note: "no PR yet", addedAt: 1 }];
const SAVED_WORK: SessionWork = {
  commits: [{ hash: "abc1234", note: "fix", addedAt: 1 }],
  pullRequests: [{ url: PR_URL, note: "draft", parentKey: "PROJ-1", addedAt: 1 }],
  artifacts: [],
};
const HAIKU_RESULT: PopulateResult = {
  tickets: [
    { id: "PROJ-1", note: "PR 7 open", parentKey: "EPIC-1" },
    { id: "PROJ-2", note: "scaling" },
    { id: "PROJ-9", note: "removed by the user" },
  ],
  commits: [{ id: "abc1234" }, { id: "def5678", note: "scale" }],
  pullRequests: [{ id: PR_URL, note: "merged" }, { id: NEW_PR_URL, parentKey: "PROJ-2" }],
  artifacts: [{ id: ARTIFACT_URL, note: "report", parentKey: NEW_PR_URL }],
};

function merge(overrides: Partial<PopulateMergeInput> = {}) {
  return mergePopulateResult({
    savedTickets: SAVED_TICKETS,
    savedWork: SAVED_WORK,
    populateResult: HAIKU_RESULT,
    removedTicketKeys: ["PROJ-9"],
    isRecheck: true,
    now: 50,
    ...overrides,
  });
}

describe("mergePopulateResult", () => {
  it("adds missing items and never re-adds a ticket the user removed", () => {
    const { tickets, work, summary } = merge();
    expect(tickets.map((ticket) => ticket.key)).toEqual(["PROJ-1", "PROJ-2"]);
    expect(work.commits.map((commit) => commit.hash)).toEqual(["abc1234", "def5678"]);
    expect(work.pullRequests[1]).toEqual({ url: NEW_PR_URL, parentKey: "PROJ-2", addedAt: 50 });
    expect(work.artifacts).toEqual([{ url: ARTIFACT_URL, note: "report", parentKey: NEW_PR_URL, addedAt: 50 }]);
    expect(work.populatedAt).toBe(50);
    expect(summary.added).toEqual({ tickets: ["PROJ-2"], pullRequests: [NEW_PR_URL], commits: ["def5678"], artifacts: [ARTIFACT_URL] });
  });

  it("refreshes notes and parents on a recheck, and an empty note or parent never clobbers", () => {
    const { tickets, work, summary } = merge();
    expect(tickets[0]).toEqual({ key: "PROJ-1", note: "PR 7 open", parentKey: "EPIC-1", addedAt: 1 });
    expect(work.pullRequests[0]).toEqual({ url: PR_URL, note: "merged", parentKey: "PROJ-1", addedAt: 1 });
    expect(work.commits[0]).toEqual({ hash: "abc1234", note: "fix", addedAt: 1 });
    expect(summary.notesUpdated).toBe(2);
  });

  it("leaves existing entries alone on a first populate", () => {
    const { tickets, work, summary } = merge({ isRecheck: false });
    expect(tickets[0]).toEqual(SAVED_TICKETS[0]);
    expect(work.pullRequests[0]).toEqual(SAVED_WORK.pullRequests[0]);
    expect(summary.notesUpdated).toBe(0);
    expect(summary.added.tickets).toEqual(["PROJ-2"]);
  });

  it("never removes an entry Haiku didn't return", () => {
    const emptyResult: PopulateResult = { tickets: [], commits: [], pullRequests: [], artifacts: [] };
    const { tickets, work, summary } = merge({ populateResult: emptyResult });
    expect(tickets).toEqual(SAVED_TICKETS);
    expect(work).toEqual({ ...SAVED_WORK, populatedAt: 50 });
    expect(summary).toEqual({ added: { tickets: [], pullRequests: [], commits: [], artifacts: [] }, notesUpdated: 0 });
  });

  it("treats a commit at another abbreviation length as existing and keeps the longer hash", () => {
    const longerResult: PopulateResult = { tickets: [], commits: [{ id: "abc12345", note: "fix v2" }], pullRequests: [], artifacts: [] };
    const { work, summary } = merge({ populateResult: longerResult });
    expect(work.commits).toEqual([{ hash: "abc12345", note: "fix v2", addedAt: 1 }]);
    expect(summary.added.commits).toEqual([]);
    expect(summary.notesUpdated).toBe(1);
  });

  it("counts nothing when a recheck returns the same notes", () => {
    const sameResult: PopulateResult = { tickets: [{ id: "PROJ-1", note: "no PR yet" }], commits: [], pullRequests: [], artifacts: [] };
    expect(merge({ populateResult: sameResult, savedWork: EMPTY_SESSION_WORK }).summary.notesUpdated).toBe(0);
  });
});
