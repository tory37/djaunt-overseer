import { describe, expect, it } from "vitest";
import { buildGroups, GroupingInput } from "../../src/grouping";
import { SessionMeta } from "../../src/indexer";
import { autoGroupRef, UNGROUPED_REF, userGroupRef } from "../../src/registry";

function sessionMeta(sessionId: string, overrides: Partial<SessionMeta>): SessionMeta {
  return {
    sessionId,
    transcriptFile: `/tmp/${sessionId}.jsonl`,
    startCwd: "/repo",
    resumeCwd: "/repo",
    gitBranch: undefined,
    firstPrompt: undefined,
    customTitle: undefined,
    agentName: undefined,
    aiTitle: undefined,
    prUrl: undefined,
    homeRepo: "/repo",
    otherReposTouched: [],
    lastActivityMs: 0,
    sizeBytes: 0,
    ...overrides,
  };
}

function groupingInput(sessions: SessionMeta[], overrides: Partial<GroupingInput> = {}): GroupingInput {
  return {
    pinnedSessionIds: sessions.map((session) => session.sessionId),
    sessionsById: new Map(sessions.map((session) => [session.sessionId, session])),
    userGroups: [],
    assignments: {},
    labels: {},
    pendingSessions: {},
    groupOrder: [],
    sessionOrder: [],
    ...overrides,
  };
}

function summarize(input: GroupingInput): Array<[string, string[]]> {
  return buildGroups(input).map((group) => [group.label, group.sessions.map((pinned) => pinned.sessionId)]);
}

describe("buildGroups", () => {
  it("groups by ticket key and puts keyless sessions in Ungrouped last", () => {
    const sessions = [
      sessionMeta("a", { customTitle: "PROJ-1 triage", lastActivityMs: 10 }),
      sessionMeta("b", { gitBranch: "fix/proj-1-followup", lastActivityMs: 30 }),
      sessionMeta("c", { customTitle: "random chat", lastActivityMs: 50 }),
      sessionMeta("d", { customTitle: "CR-9 fix", lastActivityMs: 20 }),
    ];

    expect(summarize(groupingInput(sessions))).toEqual([
      ["PROJ-1", ["b", "a"]],
      ["CR-9", ["d"]],
      ["Ungrouped", ["c"]],
    ]);
  });

  it("puts user groups first, including empty ones", () => {
    const sessions = [sessionMeta("a", { customTitle: "CR-9 fix" })];

    const input = groupingInput(sessions, {
      userGroups: [
        { id: "g1", name: "Waiting on review" },
        { id: "g2", name: "Empty" },
      ],
      assignments: { a: userGroupRef("g1") },
    });

    expect(summarize(input)).toEqual([
      ["Waiting on review", ["a"]],
      ["Empty", []],
    ]);
  });

  it("lets an explicit assignment override the ticket key", () => {
    const sessions = [sessionMeta("a", { customTitle: "CR-9 fix" }), sessionMeta("b", { customTitle: "chat" })];

    const input = groupingInput(sessions, {
      assignments: { a: UNGROUPED_REF, b: autoGroupRef("CR-9") },
    });

    expect(summarize(input)).toEqual([
      ["CR-9", ["b"]],
      ["Ungrouped", ["a"]],
    ]);
  });

  it("falls back to the ticket key when the assigned user group was deleted", () => {
    const sessions = [sessionMeta("a", { customTitle: "CR-9 fix" })];

    const input = groupingInput(sessions, { assignments: { a: userGroupRef("gone") } });

    expect(summarize(input)).toEqual([["CR-9", ["a"]]]);
  });

  it("groups by the ticket key in a user-set label before the transcript title", () => {
    const sessions = [sessionMeta("a", { customTitle: "CR-9 fix" })];

    const input = groupingInput(sessions, { labels: { a: "PROJ-77 renamed" } });

    expect(summarize(input)).toEqual([["PROJ-77", ["a"]]]);
  });

  it("files a brand-new session by its label before Claude writes a transcript", () => {
    const input = groupingInput([], {
      pinnedSessionIds: ["new"],
      labels: { new: "CR-5 spike" },
      pendingSessions: { new: { cwd: "/repo", createdAtMs: 1 } },
    });

    expect(summarize(input)).toEqual([["CR-5", ["new"]]]);
  });

  it("keeps pinned sessions missing from the index under Ungrouped", () => {
    const input = groupingInput([], { pinnedSessionIds: ["missing"] });

    expect(summarize(input)).toEqual([["Ungrouped", ["missing"]]]);
  });

  it("applies a saved group order and a saved session order", () => {
    const sessions = [
      sessionMeta("a", { customTitle: "PROJ-1 triage", lastActivityMs: 10 }),
      sessionMeta("b", { customTitle: "PROJ-1 notes", lastActivityMs: 30 }),
      sessionMeta("c", { customTitle: "CR-9 fix", lastActivityMs: 50 }),
      sessionMeta("d", { customTitle: "chat", lastActivityMs: 40 }),
    ];

    const input = groupingInput(sessions, {
      groupOrder: [UNGROUPED_REF, autoGroupRef("PROJ-1"), autoGroupRef("CR-9")],
      sessionOrder: ["a", "b"],
    });

    expect(summarize(input)).toEqual([
      ["Ungrouped", ["d"]],
      ["PROJ-1", ["a", "b"]],
      ["CR-9", ["c"]],
    ]);
  });

  it("puts a group missing from the saved order on top", () => {
    const sessions = [
      sessionMeta("a", { customTitle: "PROJ-1 triage" }),
      sessionMeta("c", { customTitle: "CR-9 fix" }),
    ];

    const input = groupingInput(sessions, { groupOrder: [autoGroupRef("PROJ-1")] });

    expect(summarize(input).map(([label]) => label)).toEqual(["CR-9", "PROJ-1"]);
  });

  it("files a keyless session under its linked owned ticket, but a title key still wins", () => {
    const sessions = [
      sessionMeta("a", { customTitle: "random chat" }),
      sessionMeta("b", { customTitle: "PROJ-1 triage" }),
    ];
    const input = groupingInput(sessions, { linkedTicketKeys: { a: "PROJ-7", b: "PROJ-7" } });

    expect(summarize(input)).toEqual(
      expect.arrayContaining([
        ["PROJ-1", ["b"]],
        ["PROJ-7", ["a"]],
      ]),
    );
  });
});
