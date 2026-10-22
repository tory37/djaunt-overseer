import { describe, expect, it } from "vitest";
import {
  declaredTicketsFile,
  formatTicketList,
  hasUserTicketMarks,
  isSafeSessionId,
  mergeDeclaredTickets,
  normalizeTicketKey,
  readDeclaredTickets,
  readUserTicketMarks,
  userTicketMarksFromLinkMarks,
  withDeclaredTicket,
  withoutDeclaredTicket,
  workingTicketKeys,
} from "../../src/agentTickets";

const NO_MARKS = { pinned: [], removed: [] };

describe("readDeclaredTickets", () => {
  it("keeps a valid parent and drops a bad or self parent", () => {
    const entries = [
      { key: "PROJ-2", parentKey: "PROJ-1", addedAt: 1 },
      { key: "PROJ-3", parentKey: "nope", addedAt: 1 },
      { key: "PROJ-4", parentKey: "PROJ-4", addedAt: 1 },
    ];
    expect(readDeclaredTickets(entries)).toEqual([
      { key: "PROJ-2", parentKey: "PROJ-1", addedAt: 1 },
      { key: "PROJ-3", addedAt: 1 },
      { key: "PROJ-4", addedAt: 1 },
    ]);
  });

  it("keeps valid entries and skips the rest", () => {
    const entries = [
      { key: "PROJ-1", note: "fixing login", addedAt: 5 },
      { key: "PROJ-2" },
      { key: "not a key", addedAt: 1 },
      { key: "UTF-8", addedAt: 1 },
      "PROJ-3",
      null,
    ];
    expect(readDeclaredTickets(entries)).toEqual([
      { key: "PROJ-1", note: "fixing login", addedAt: 5 },
      { key: "PROJ-2", addedAt: 0 },
    ]);
  });

  it.each([undefined, {}, "PROJ-1", 7])("returns nothing for %o", (entries) => {
    expect(readDeclaredTickets(entries)).toEqual([]);
  });
});

describe("readUserTicketMarks", () => {
  it("keeps only ticket keys", () => {
    expect(readUserTicketMarks({ pinned: ["PROJ-1", 3, "nope"], removed: ["PROJ-2"] })).toEqual({
      pinned: ["PROJ-1"],
      removed: ["PROJ-2"],
    });
  });

  it("returns empty marks for a missing file", () => {
    expect(readUserTicketMarks({})).toEqual(NO_MARKS);
  });
});

describe("declaring tickets", () => {
  it("adds a ticket once and keeps its first time when declared again", () => {
    const once = withDeclaredTicket([], "PROJ-1", "fixing login", 10);
    const twice = withDeclaredTicket(once, "PROJ-1", undefined, 20);
    expect(twice).toEqual([{ key: "PROJ-1", note: "fixing login", addedAt: 10 }]);
  });

  it("replaces the note when declared again with a new one", () => {
    const tickets = withDeclaredTicket([{ key: "PROJ-1", note: "old", addedAt: 10 }], "PROJ-1", "new", 20);
    expect(tickets).toEqual([{ key: "PROJ-1", note: "new", addedAt: 10 }]);
  });

  it("removes only the named ticket", () => {
    const tickets = [
      { key: "PROJ-1", addedAt: 1 },
      { key: "PROJ-2", addedAt: 2 },
    ];
    expect(withoutDeclaredTicket(tickets, "PROJ-1")).toEqual([{ key: "PROJ-2", addedAt: 2 }]);
  });
});

describe("workingTicketKeys", () => {
  it("lets a user removal beat an agent declaration", () => {
    const tickets = [{ key: "PROJ-1", addedAt: 1 }];
    expect(workingTicketKeys(tickets, { pinned: [], removed: ["PROJ-1"] })).toEqual([]);
  });

  it("includes tickets the user pinned but the agent never declared", () => {
    const tickets = [{ key: "PROJ-1", addedAt: 1 }];
    expect(workingTicketKeys(tickets, { pinned: ["PROJ-9"], removed: [] })).toEqual(["PROJ-9", "PROJ-1"]);
  });
});

describe("formatTicketList", () => {
  it("says so when nothing is declared", () => {
    expect(formatTicketList([], NO_MARKS)).toBe("No tickets declared for this session.");
  });

  it("shows notes, pins, and removals", () => {
    const tickets = [
      { key: "PROJ-1", note: "fixing login", addedAt: 1 },
      { key: "PROJ-2", addedAt: 2 },
    ];
    expect(formatTicketList(tickets, { pinned: ["PROJ-1"], removed: ["PROJ-2"] })).toBe(
      [
        "Working on:",
        "  PROJ-1  (fixing login; pinned by the user)",
        "Removed by the user (do not declare again):",
        "  PROJ-2",
      ].join("\n"),
    );
  });
});

describe("keys and paths", () => {
  it.each([
    ["proj-12", "PROJ-12"],
    [" PROJ-12 ", "PROJ-12"],
    ["PROJ", undefined],
    ["UTF-8", undefined],
  ])("normalizes %s", (rawKey, expectedKey) => {
    expect(normalizeTicketKey(rawKey)).toBe(expectedKey);
  });

  it.each([
    ["0b1e7a6c-1f7e-4a5e-9d7e-2b8c3f1a9e10", true],
    ["../etc/passwd", false],
    ["a/b", false],
    ["", false],
  ])("checks session id %s", (sessionId, isSafe) => {
    expect(isSafeSessionId(sessionId)).toBe(isSafe);
  });

  it("puts declarations under the overseer folder", () => {
    expect(declaredTicketsFile("/home/me/.claude", "abc")).toBe("/home/me/.claude/overseer/declared/abc.json");
  });
});

describe("copying a session's tickets", () => {
  it("adds missing tickets and keeps the target's own entries", () => {
    const targetTickets = [{ key: "PROJ-1", note: "new note", addedAt: 20 }];
    const incomingTickets = [
      { key: "PROJ-1", note: "old note", addedAt: 10 },
      { key: "PROJ-2", addedAt: 11 },
    ];
    expect(mergeDeclaredTickets(targetTickets, incomingTickets)).toEqual([
      { key: "PROJ-1", note: "new note", addedAt: 20 },
      { key: "PROJ-2", addedAt: 11 },
    ]);
  });

  it("reads ticket marks out of link marks", () => {
    const userMarks = userTicketMarksFromLinkMarks({
      "ticket:PROJ-1": "pinned",
      "ticket:PROJ-2": "removed",
      "pr:https://github.com/o/r/pull/1": "pinned",
      "ticket:UTF-8": "pinned",
    });
    expect(userMarks).toEqual({ pinned: ["PROJ-1"], removed: ["PROJ-2"] });
    expect(hasUserTicketMarks(userMarks)).toBe(true);
    expect(hasUserTicketMarks(userTicketMarksFromLinkMarks({ "pr:1": "pinned" }))).toBe(false);
  });
});
