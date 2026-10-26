import { describe, expect, it } from "vitest";
import {
  cleanWhereLines,
  DONE_HISTORY_MS,
  formatWhereShow,
  pruneTrackerEntries,
  readSessionWhere,
  renderTracker,
  TrackerEntry,
  withWhereDone,
  withWhereLines,
} from "../../src/agentTracker";

const HOUR_MS = 60 * 60 * 1000;
const NOW = 100 * 24 * HOUR_MS;

function entry(sessionId: string, fields: Partial<TrackerEntry>, where: TrackerEntry["where"]): TrackerEntry {
  return { sessionId, name: sessionId, ...fields, where };
}

describe("cleanWhereLines", () => {
  it("strips newlines, trims, drops empty and non-string lines, and caps count and length", () => {
    expect(cleanWhereLines(["  a\nb  ", "", "   ", 7, "c", "d", "e"])).toEqual(["a b", "c", "d"]);
    expect(cleanWhereLines(["x".repeat(150)])).toEqual(["x".repeat(100)]);
  });
});

describe("readSessionWhere", () => {
  it("needs an updatedAt and cleans the lines", () => {
    expect(readSessionWhere({ lines: ["one", 2, "two\n"], updatedAt: 5, doneAt: 6 })).toEqual({ lines: ["one", "two"], updatedAt: 5, doneAt: 6 });
    expect(readSessionWhere({ lines: "nope", updatedAt: 5, doneAt: "x" })).toEqual({ lines: [], updatedAt: 5 });
    expect(readSessionWhere({ lines: ["one"] })).toBeUndefined();
    expect(readSessionWhere(null)).toBeUndefined();
    expect(readSessionWhere({})).toBeUndefined();
  });
});

describe("where updates", () => {
  it("replaces lines and clears done", () => {
    expect(withWhereLines(["new"], 9)).toEqual({ lines: ["new"], updatedAt: 9 });
  });

  it("marks done and keeps the lines, or starts empty", () => {
    expect(withWhereDone({ lines: ["a"], updatedAt: 1 }, 9)).toEqual({ lines: ["a"], updatedAt: 9, doneAt: 9 });
    expect(withWhereDone(undefined, 9)).toEqual({ lines: [], updatedAt: 9, doneAt: 9 });
  });

  it("formats the show text", () => {
    expect(formatWhereShow(undefined)).toBe("No tracker lines set for this session.");
    expect(formatWhereShow({ lines: ["a", "b"], updatedAt: 1 })).toBe("Where this session is:\n  a\n  b");
    expect(formatWhereShow({ lines: [], updatedAt: 1, doneAt: 1 })).toBe("Where this session is (done):\n  none");
  });
});

describe("pruneTrackerEntries", () => {
  it("drops done entries older than 7 days and keeps the rest", () => {
    const entries = [
      entry("old-done", {}, { lines: [], updatedAt: 0, doneAt: NOW - DONE_HISTORY_MS - 1 }),
      entry("recent-done", {}, { lines: [], updatedAt: 0, doneAt: NOW - DONE_HISTORY_MS }),
      entry("old-active", {}, { lines: [], updatedAt: 0 }),
    ];
    expect(pruneTrackerEntries(entries, NOW).map((kept) => kept.sessionId)).toEqual(["recent-done", "old-active"]);
  });
});

describe("renderTracker", () => {
  it("lists active entries newest first and struck done entries", () => {
    const entries = [
      entry("older", { name: "Older work", repo: "repo-a" }, { lines: ["waiting on CI"], updatedAt: NOW - 3 * HOUR_MS }),
      entry(
        "newer",
        { name: "Fix\nlogin", repo: "repo-b", branch: "fix/login", statusName: "In Progress" },
        { lines: ["writing tests", "then PR"], updatedAt: NOW - 5 * 60 * 1000 },
      ),
      entry("finished", { name: "Shipped", repo: "repo-c" }, { lines: ["merged"], updatedAt: 0, doneAt: NOW - 24 * HOUR_MS }),
      entry("ancient", { name: "Gone" }, { lines: [], updatedAt: 0, doneAt: 0 }),
    ];
    expect(renderTracker(entries, NOW)).toBe(
      [
        "# Overseer tracker",
        "",
        "## Active",
        "",
        "- **Fix login** · repo-b · `fix/login` · In Progress · 5m ago",
        "  - writing tests",
        "  - then PR",
        "- **Older work** · repo-a · 3h ago",
        "  - waiting on CI",
        "",
        "## Done",
        "",
        "- ~~**Shipped**~~ · repo-c · done 1d ago",
        "  - ~~merged~~",
        "",
      ].join("\n"),
    );
  });

  it("says none for empty sections", () => {
    expect(renderTracker([], NOW)).toBe("# Overseer tracker\n\n## Active\n\n_None._\n\n## Done\n\n_None._\n");
  });
});
